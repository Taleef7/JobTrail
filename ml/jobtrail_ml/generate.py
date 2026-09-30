"""Checkpointed draft generation (#70): plans -> notes (writer) -> blind extraction
(checker) -> fidelity flags -> one JSONL line per draft. Batched because the free
tier allows 20 requests per model per day. Append-only, so an interrupted run
(daily quota, crash) resumes where it stopped; notes a batch reply omits are
simply left for the next run."""

from __future__ import annotations

import json
import zlib
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from .fidelity import crosscheck_flags, note_flags
from .gemini import GeminiClient, GeminiError, QuotaExhausted, Result
from .prompts import (
    CHECKER_BATCH_SYSTEM,
    WRITER_BATCH_SCHEMA,
    WRITER_SYSTEM,
    checker_batch_input,
    checker_batch_schema,
    writer_batch_prompt,
)


@dataclass(frozen=True)
class RunConfig:
    writer_model: str
    checker_model: str
    writer_temperature: float
    checker_temperature: float
    thinking_level: str | None
    seed: int
    schema: dict[str, Any]
    batch_size: int = 15


def read_done_ids(path: Path) -> set[str]:
    """Ids already drafted. A truncated last line (crash mid-write) is dropped."""
    if not path.exists():
        return set()
    lines = path.read_text(encoding="utf-8").splitlines()
    ids = set()
    for i, line in enumerate(lines):
        try:
            ids.add(json.loads(line)["id"])
        except (json.JSONDecodeError, KeyError) as e:
            if i != len(lines) - 1:
                raise ValueError(f"{path}:{i + 1}: corrupt line in the middle of the file") from e
            path.write_text("".join(f"{x}\n" for x in lines[:-1]), encoding="utf-8")
    return ids


def _append(path: Path, obj: dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def _by_id(text: str, key: str, field: str) -> dict[str, Any]:
    """{id: value} from a batch reply; unparseable replies and duplicate ids yield nothing."""
    try:
        rows = json.loads(text)[key]
    except (json.JSONDecodeError, KeyError, TypeError):
        return {}
    out: dict[str, Any] = {}
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and "id" in row and field in row:
            out[row["id"]] = None if row["id"] in out else row[field]
    return {k: v for k, v in out.items() if v is not None}


def run_generation(
    plans: list[dict[str, Any]],
    styles: dict[str, str],
    out_dir: Path,
    client: GeminiClient,
    cfg: RunConfig,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    validator = Draft202012Validator(cfg.schema)
    checker_schema = checker_batch_schema(cfg.schema)
    done = {s: read_done_ids(out_dir / f"{s}.jsonl") for s in {p["split"] for p in plans}}
    todo = [p for p in plans if p["id"] not in done[p["split"]]]
    tokens = {"prompt": 0, "output": 0, "thoughts": 0, "total": 0}
    written, missing, stopped, quota = 0, [], False, None

    def log(ids: list[str], role: str, model: str, r: Result) -> None:
        u = r.usage
        tokens["prompt"] += u.get("promptTokenCount", 0)
        tokens["output"] += u.get("candidatesTokenCount", 0)
        tokens["thoughts"] += u.get("thoughtsTokenCount", 0)
        tokens["total"] += u.get("totalTokenCount", 0)
        _append(out_dir / "usage.jsonl", {
            "ids": ids, "role": role, "model": model, "modelVersion": r.model_version,
            "promptTokens": u.get("promptTokenCount", 0),
            "outputTokens": u.get("candidatesTokenCount", 0),
            "thoughtsTokens": u.get("thoughtsTokenCount", 0),
            "totalTokens": u.get("totalTokenCount", 0),
            "at": datetime.now(UTC).isoformat(timespec="seconds"),
        })  # fmt: skip

    for start in range(0, len(todo), cfg.batch_size):
        batch = todo[start : start + cfg.batch_size]
        ids = [p["id"] for p in batch]
        seed = zlib.crc32(f"{cfg.seed}:{','.join(ids)}".encode()) & 0x7FFFFFFF
        try:
            w = client.generate(cfg.writer_model, WRITER_SYSTEM, writer_batch_prompt(batch, styles),
                                temperature=cfg.writer_temperature, seed=seed,
                                json_schema=WRITER_BATCH_SCHEMA,
                                thinking_level=cfg.thinking_level)  # fmt: skip
            log(ids, "writer", cfg.writer_model, w)
            notes = {i: n.strip() for i, n in _by_id(w.text, "notes", "note").items() if i in ids}
            got = [p for p in batch if notes.get(p["id"])]
            missing += [p["id"] for p in batch if not notes.get(p["id"])]
            if not got:
                continue
            c = client.generate(cfg.checker_model, CHECKER_BATCH_SYSTEM,
                                checker_batch_input([(p["id"], notes[p["id"]]) for p in got]),
                                temperature=cfg.checker_temperature, json_schema=checker_schema,
                                thinking_level=cfg.thinking_level)  # fmt: skip
            log([p["id"] for p in got], "checker", cfg.checker_model, c)
        except QuotaExhausted as e:
            stopped, quota = "daily quota", str(e)
            break
        except GeminiError as e:
            stopped = f"error: {e}"
            break
        checked_all = _by_id(c.text, "results", "record")
        batch_no = start // cfg.batch_size + 1
        for plan in got:
            note = notes[plan["id"]]
            checked = checked_all.get(plan["id"])
            if checked is not None and not validator.is_valid(checked):
                checked = None
            _append(out_dir / f"{plan['split']}.jsonl", {
                "id": plan["id"],
                "note": note,
                "gold": plan["record"],
                "source": "synthetic",
                "tags": plan["tags"],
                "verified": False,
                "meta": {
                    "split": plan["split"], "trade": plan["trade"], "style": plan["style"],
                    "plan": plan["meta"],
                    "writer": {"model": cfg.writer_model, "modelVersion": w.model_version,
                               "batch": batch_no},
                    "checker": {"model": cfg.checker_model, "modelVersion": c.model_version},
                    "checked": checked,
                    "flags": note_flags(plan, note) + crosscheck_flags(plan["record"], checked),
                },
            })  # fmt: skip
            written += 1
    return {
        "written": written,
        "missing": missing,
        "stopped": stopped,
        "quota": quota,
        "tokens": tokens,
    }
