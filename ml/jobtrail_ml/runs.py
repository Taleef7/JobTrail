"""Batch extraction runs (#72): config, deterministic run IDs, resumable output, scoring.

A run is one model + prompt variant + decoding setup over one gold file. Its ID is
`<name>-<gold>-<hash8>`, where the hash covers everything that can change a prediction:
the config's settings, the model file's SHA-256 (or the cloud model id), the prompt
text, the grammar schema and the gold file. Same inputs, same ID; any change, new ID.

results/runs/<id>/
  config.json        the resolved config; itself a valid --config to reproduce the run
  predictions.jsonl  one line per note, appended as it goes (a rerun resumes)
  run.json           environment (runtime build, host), token usage, cost, status
  gold.jsonl         only when --limit took a subset: the gold the run is scored on
  report.json        the core scorer's report, written once every note has a prediction
"""

from __future__ import annotations

import copy
import hashlib
import json
import platform
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from . import extract
from .generate import read_done_ids
from .scorer import score

ML = Path(__file__).resolve().parents[1]
ROOT = ML.parent
RESULTS = ROOT / "results" / "runs"

PROVIDERS = ("llamacpp", "gemini")
DEFAULTS: dict[str, Any] = {
    "prompt": "zero-shot",
    "format": "full",
    "grammar": True,
    "limit": None,
    "sampling": {"temperature": 0.0, "seed": 42, "max_tokens": 512},
}
LLAMACPP_SERVER = {"ctx": 4096, "gpu_layers": 0, "threads": None, "chat_template_kwargs": {}}
GEMINI_CLOUD = {"thinking_level": None, "rpm": 8.0, "key_env": "GEMINI_API_KEY", "pricing": None}
# Settings that don't change what the model writes stay out of the run ID.
# The model file and gold are identified by their SHA-256, not their path or URL.
NOT_IDENTITY = {
    "name",
    "gold",
    "model.file",
    "model.url",
    "cloud.rpm",
    "cloud.key_env",
    "cloud.pricing",
    "server.threads",
}


class ConfigError(ValueError):
    pass


def _merge(defaults: dict, given: dict) -> dict:
    out = copy.deepcopy(defaults)
    for k, v in given.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load_config(path: Path, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    raw = {k: v for k, v in raw.items() if k != "identity"}  # a saved config.json
    return resolve(_merge(raw, overrides or {}))


KEYS = (
    "name",
    "provider",
    "model",
    "prompt",
    "format",
    "grammar",
    "gold",
    "limit",
    "sampling",
    "server",
    "cloud",
)


def resolve(raw: dict[str, Any]) -> dict[str, Any]:
    unknown = sorted(set(raw) - set(KEYS))
    if unknown:
        raise ConfigError(f"unknown config key(s): {', '.join(unknown)}")
    for key in ("name", "provider", "model", "gold"):
        if not raw.get(key):
            raise ConfigError(f"config needs {key!r}")
    if raw["provider"] not in PROVIDERS:
        raise ConfigError(f"provider must be one of {PROVIDERS}, got {raw['provider']!r}")
    cfg = _merge(DEFAULTS, raw)
    if cfg["prompt"] not in extract.VARIANTS:
        raise ConfigError(f"prompt must be one of {extract.VARIANTS}, got {cfg['prompt']!r}")
    if cfg["format"] not in extract.FORMATS:
        raise ConfigError(f"format must be one of {extract.FORMATS}, got {cfg['format']!r}")
    if cfg["prompt"] == "fine-tuned-short" and cfg["format"] != "compact":
        raise ConfigError("fine-tuned-short prompts expect compact output (format: compact)")
    if cfg["limit"] is not None and (not isinstance(cfg["limit"], int) or cfg["limit"] < 1):
        raise ConfigError(f"limit must be a positive integer or null, got {cfg['limit']!r}")
    if cfg["provider"] == "llamacpp":
        if not {"file", "sha256"} <= set(cfg["model"]):
            raise ConfigError("llamacpp model needs file and sha256 (and url to download it)")
        cfg["server"] = _merge(LLAMACPP_SERVER, cfg.get("server") or {})
    else:
        if not cfg["model"].get("id"):
            raise ConfigError("gemini model needs id")
        if cfg["prompt"] == "few-shot":
            raise ConfigError("the cloud runner sends one system + one user turn; no few-shot")
        if "max_tokens" not in (raw.get("sampling") or {}):
            cfg["sampling"]["max_tokens"] = None  # thinking counts against the cap
        cfg["cloud"] = _merge(GEMINI_CLOUD, cfg.get("cloud") or {})
    return {k: cfg[k] for k in KEYS if k in cfg}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _drop(cfg: dict[str, Any], dotted: set[str], prefix: str = "") -> dict[str, Any]:
    out = {}
    for k, v in cfg.items():
        key = f"{prefix}{k}"
        if key in dotted:
            continue
        out[k] = _drop(v, dotted, f"{key}.") if isinstance(v, dict) else v
    return out


def identity(cfg: dict[str, Any]) -> dict[str, Any]:
    """Everything that can change a prediction, hashed into the run ID."""
    ident = {
        "settings": _drop(cfg, NOT_IDENTITY),
        "prompt_sha256": extract.prompt_fingerprint(cfg["prompt"], cfg["format"]),
        "gold_sha256": sha256_file(ROOT / cfg["gold"]),
    }
    if cfg["grammar"]:
        ident["schema_sha256"] = sha256_file(extract.SCHEMAS[cfg["format"]])
    return ident


def run_id(cfg: dict[str, Any]) -> str:
    digest = hashlib.sha256(json.dumps(identity(cfg), sort_keys=True).encode()).hexdigest()
    return f"{cfg['name']}-{Path(cfg['gold']).stem}-{digest[:8]}"


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


def write_json(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8",
                    newline="\n")  # fmt: skip


class Run:
    """A run folder: open (or resume) it, append predictions, finish and score it."""

    def __init__(self, cfg: dict[str, Any], out_dir: Path = RESULTS):
        self.cfg = cfg
        self.id = run_id(cfg)
        self.dir = out_dir / self.id
        gold_all = read_jsonl(ROOT / cfg["gold"])
        self.gold = gold_all[: cfg["limit"]] if cfg["limit"] else gold_all
        self.pred_path = self.dir / "predictions.jsonl"
        self.done = read_done_ids(self.pred_path)  # drops a line cut off by a crash

    def open(self, env: dict[str, Any]) -> None:
        """Create the folder, or resume it if it was made in the same environment."""
        self.dir.mkdir(parents=True, exist_ok=True)
        meta_path = self.dir / "run.json"
        if meta_path.exists():
            before = json.loads(meta_path.read_text(encoding="utf-8"))["env"]
            changed = {k for k in ("runtime",) if before.get(k) != env.get(k)}
            if changed and self.done:
                raise RuntimeError(
                    f"{self.dir.name} was started with {before.get('runtime')}, now "
                    f"{env.get('runtime')}; delete the folder to start over"
                )
        write_json(self.dir / "config.json", {**self.cfg, "identity": identity(self.cfg)})
        if self.cfg["limit"]:
            (self.dir / "gold.jsonl").write_text(
                "".join(json.dumps(g, ensure_ascii=False) + "\n" for g in self.gold),
                encoding="utf-8", newline="\n",
            )  # fmt: skip
        self.meta = {
            "id": self.id,
            "env": env,
            "started": datetime.now(UTC).isoformat(timespec="seconds"),
            "status": "running",
        }
        write_json(meta_path, self.meta)

    def todo(self) -> list[dict]:
        return [g for g in self.gold if g["id"] not in self.done]

    def append(self, line: dict[str, Any]) -> None:
        with self.pred_path.open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
        self.done.add(line["id"])

    @property
    def complete(self) -> bool:
        return all(g["id"] in self.done for g in self.gold)

    def finish(self, status: str, extra: dict[str, Any] | None = None, score_it: bool = True):
        preds = read_jsonl(self.pred_path)
        self.meta.update({
            "status": "complete" if self.complete else status,
            "finished": datetime.now(UTC).isoformat(timespec="seconds"),
            "predictions": len(preds),
            "usage": usage_totals(preds),
            **(extra or {}),
        })  # fmt: skip
        write_json(self.dir / "run.json", self.meta)
        if self.complete and score_it:
            return score_run(self.dir)
        return None


def usage_totals(preds: list[dict]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for p in preds:
        for k, v in (p.get("usage") or {}).items():
            totals[k] = totals.get(k, 0) + v
    return totals


def gold_path(run_dir: Path) -> Path:
    cfg = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))
    subset = run_dir / "gold.jsonl"
    return subset if subset.exists() else ROOT / cfg["gold"]


def score_run(run_dir: Path) -> dict:
    """Score a finished run with the core scorer; refuses a run with notes still missing."""
    gold = read_jsonl(gold_path(run_dir))
    done = {p["id"] for p in read_jsonl(run_dir / "predictions.jsonl")}
    missing = [g["id"] for g in gold if g["id"] not in done]
    if missing:
        raise RuntimeError(f"{run_dir.name}: {len(missing)} notes have no prediction yet "
                           f"(e.g. {missing[0]}); rerun to resume")  # fmt: skip
    return score(gold_path(run_dir), run_dir / "predictions.jsonl", run_dir / "report.json",
                 run_dir.name)  # fmt: skip


def cost(usage: dict[str, int], pricing: dict[str, Any] | None, n: int) -> list[dict]:
    """USD at each published paid-tier rate; thinking tokens bill as output."""
    if not pricing:
        return []
    out = []
    for rate in pricing["rates"]:
        usd = (usage.get("promptTokens", 0) * rate["input_per_mtok"]
               + (usage.get("outputTokens", 0) + usage.get("thoughtsTokens", 0))
               * rate["output_per_mtok"]) / 1e6  # fmt: skip
        out.append({"rate": rate["label"], "usd": round(usd, 6),
                    "usdPerNote": round(usd / n, 8) if n else None})  # fmt: skip
    return out


def gemini_usage(meta: dict[str, Any]) -> dict[str, int]:
    """Gemini's usageMetadata as the run's token counts (thinking is billed as output)."""
    return {"promptTokens": meta.get("promptTokenCount", 0),
            "outputTokens": meta.get("candidatesTokenCount", 0),
            "thoughtsTokens": meta.get("thoughtsTokenCount", 0)}  # fmt: skip


def host() -> dict[str, str]:
    return {"os": platform.platform(), "machine": platform.machine(),
            "cpu": platform.processor(), "python": platform.python_version()}  # fmt: skip
