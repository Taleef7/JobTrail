"""#76: models/manifest.json, the model catalog the apps read (#79 mobile, #89 web).

Usage (from ml/):
  uv run python scripts/build_manifest.py memory configs/<run>.yaml ...  # peak RAM per GGUF
  uv run python scripts/build_manifest.py manifest   # from models/release.yaml
  uv run python scripts/build_manifest.py check      # CI: the published files match

`memory` starts llama-server on each config's GGUF (the runner's settings), sends the
longest test note and records the server's peak resident memory, mapped weights included,
in results/models/memory.json. Run it on an idle machine; it is the manifest's peakRamMB,
one process on a desktop OS, so an app still needs headroom on top of it.

`manifest` takes each release model's file, sha256 and size from its eval config, its test
scores from results/summary.json and its memory from results/models/memory.json.

`check` asks Hugging Face for each manifest URL without downloading it (retrying 429 and
5xx): the redirect carries the file's size and sha256
(X-Linked-Size, X-Linked-ETag), which must match.
"""

from __future__ import annotations

import argparse
import json
import math
import platform
import sys
import time
from pathlib import Path

import httpx
import yaml

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from jobtrail_ml import extract  # noqa: E402
from jobtrail_ml.runs import ROOT, load_config, read_jsonl, write_json  # noqa: E402

MANIFEST = ROOT / "models" / "manifest.json"
MEMORY = ROOT / "results" / "models" / "memory.json"
RELEASE = ROOT / "models" / "release.yaml"
SUMMARY = ROOT / "results" / "summary.json"


def peak_rss_mb(pid: int) -> int:
    """The process's peak resident memory: peak working set on Windows, VmHWM on Linux."""
    import psutil

    info = psutil.Process(pid).memory_info()
    peak = getattr(info, "peak_wset", None)
    if peak is None and Path(f"/proc/{pid}/status").exists():
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmHWM:"):
                peak = int(line.split()[1]) * 1024
    return math.ceil((peak or info.rss) / 2**20)


def cmd_memory(args) -> int:
    from jobtrail_ml.llamacpp import LlamaClient, LlamaServer, ensure_model

    note = max(read_jsonl(ROOT / "data" / "test.jsonl"), key=lambda g: len(g["note"]))
    out = json.loads(MEMORY.read_text(encoding="utf-8")) if MEMORY.exists() else {}
    for path in args.configs:
        cfg = load_config(path)
        m = cfg["model"]
        model = ensure_model(ROOT / m["file"], m.get("url"), m["sha256"])
        schema = extract.schema(cfg["format"]) if cfg["grammar"] else None
        log = ROOT / "results" / "models" / f"{cfg['name']}.server.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        msgs = extract.messages(note["note"], cfg["prompt"], cfg["format"])
        with LlamaServer(model, cfg["server"], cfg["sampling"]["seed"], log) as server:
            c = LlamaClient(server.url).chat(msgs, schema=schema, sampling=cfg["sampling"],
                chat_template_kwargs=cfg["server"]["chat_template_kwargs"])  # fmt: skip
            mb = peak_rss_mb(server.proc.pid)
        log.unlink()
        out[m["sha256"]] = {"file": Path(m["file"]).name, "peakRamMB": mb,
                            "ctx": cfg["server"]["ctx"], "noteId": note["id"],
                            "promptTokens": c.usage["promptTokens"],
                            "outputTokens": c.usage["outputTokens"],
                            "os": f"{platform.system()} {platform.release()}"}  # fmt: skip
        print(f"{cfg['name']}: {mb} MB")
    write_json(MEMORY, dict(sorted(out.items(), key=lambda kv: kv[1]["file"])))
    return 0


def test_run(name: str, runs: list[dict]) -> dict:
    """The complete test run of an eval config (run IDs start with the config name)."""
    hits = [r for r in runs if r["split"] == "test" and r["run"].startswith(f"{name}-test-")]
    if len(hits) != 1:
        raise SystemExit(f"{name}: expected one test run in summary.json, found {len(hits)}")
    return hits[0]


def build() -> dict:
    """The manifest from models/release.yaml, the eval configs, summary.json and memory.json."""
    rel = yaml.safe_load(RELEASE.read_text(encoding="utf-8"))
    runs = json.loads(SUMMARY.read_text(encoding="utf-8"))["runs"]
    memory = json.loads(MEMORY.read_text(encoding="utf-8"))
    models = []
    for item in rel["models"]:
        cfg = load_config(ML / "configs" / f"{item['config']}.yaml")
        m, r = cfg["model"], test_run(item["config"], runs)
        file = Path(m["file"]).name
        url = f"https://huggingface.co/{rel['repo']}/resolve/{rel['revision']}/{file}"
        if m.get("url") != url:
            raise SystemExit(f"{item['config']}: model.url is not {url}")
        held = r["templates"]["heldOut"]
        models.append({
            "id": item["id"], "displayName": item["displayName"], "quant": item["quant"],
            "url": url,
            "file": file, "sha256": m["sha256"], "bytes": m["bytes"],
            "peakRamMB": memory[m["sha256"]]["peakRamMB"],
            "base": rel["base"], "license": rel["license"],
            "prompt": cfg["prompt"], "format": cfg["format"], "grammar": cfg["grammar"],
            "eval": {
                "split": "test", "n": r["n"], "run": r["run"],
                "zeroEditRate": r["metrics"]["zeroEditRate"],
                "heldOutTemplates": {"n": held["n"], "zeroEdit": held["zeroEdit"]},
                "p50WallMs": r["metrics"]["p50WallMs"], "measuredOn": rel["measuredOn"],
            },
        })  # fmt: skip
    return {"schemaVersion": 1, "issue": 76, "models": models}


def cmd_manifest(_args) -> int:
    manifest = build()
    write_json(MANIFEST, manifest)
    print(f"{len(manifest['models'])} models -> {MANIFEST}")
    return 0


def head(client: httpx.Client, url: str, tries: int = 4, wait: float = 2.0) -> httpx.Response:
    """HEAD the URL, retrying Hugging Face's 429 and 5xx with backoff."""
    for attempt in range(tries):
        r = client.head(url)
        if r.status_code != 429 and r.status_code < 500 or attempt == tries - 1:
            return r
        time.sleep(wait * 2**attempt)
    return r


def check(manifest: dict, client: httpx.Client, wait: float = 2.0) -> list[str]:
    """Problems with the published files; empty when every URL serves the listed file."""
    problems = []
    for m in manifest["models"]:
        r = head(client, m["url"], wait=wait)
        size, etag = r.headers.get("x-linked-size"), r.headers.get("x-linked-etag", "")
        if r.status_code not in (200, 302) or size is None:
            problems.append(f"{m['id']}: HTTP {r.status_code} without X-Linked-Size")
            continue
        if int(size) != m["bytes"]:
            problems.append(f"{m['id']}: published size {size}, manifest {m['bytes']}")
        if etag.strip('"') != m["sha256"]:
            problems.append(f"{m['id']}: published sha256 {etag.strip(chr(34))}, "
                            f"manifest {m['sha256']}")  # fmt: skip
    return problems


def cmd_check(_args) -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    transport = httpx.HTTPTransport(retries=3)
    with httpx.Client(timeout=30, follow_redirects=False, transport=transport) as client:
        problems = check(manifest, client)
    for p in problems:
        print(p)
    print(f"{len(manifest['models'])} models, {len(problems)} problems")
    return 1 if problems else 0


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(required=True)
    p = sub.add_parser("memory")
    p.add_argument("configs", nargs="+", type=Path)
    p.set_defaults(fn=cmd_memory)
    sub.add_parser("manifest").set_defaults(fn=cmd_manifest)
    sub.add_parser("check").set_defaults(fn=cmd_check)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
