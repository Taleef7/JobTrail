"""Calls the core scorer (packages/core, the single source of every metric) from Python."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCORE_CLI = ROOT / "packages" / "core" / "src" / "cli" / "score.ts"


def node() -> str:
    path = shutil.which("node")
    if not path:
        raise RuntimeError("node (>= 24) not found on PATH; the scorer runs on Node")
    return path


def score(gold: Path, pred: Path, out: Path, run: str) -> dict:
    """`pnpm score` on two JSONL files; returns the report it wrote."""
    proc = subprocess.run(
        [node(), str(SCORE_CLI), "--gold", str(gold), "--pred", str(pred),
         "--out", str(out), "--run", run],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=False,
    )  # fmt: skip
    if proc.returncode != 0:
        raise RuntimeError(f"scorer failed ({proc.returncode}): {proc.stderr.strip()[-500:]}")
    return json.loads(out.read_text(encoding="utf-8"))


def zero_edit(pairs: list[tuple[dict, dict]]) -> list[bool]:
    """For each (gold, predicted) pair of schema-v2 records, the scorer's zeroEdit verdict."""
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        golds = [{"id": f"p{i}", "note": "", "gold": g, "source": "pair", "tags": []}
                 for i, (g, _) in enumerate(pairs)]  # fmt: skip
        preds = [{"id": f"p{i}", "raw": json.dumps(p)} for i, (_, p) in enumerate(pairs)]
        for name, rows in (("gold.jsonl", golds), ("pred.jsonl", preds)):
            (d / name).write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
        report = score(d / "gold.jsonl", d / "pred.jsonl", d / "report.json", "agreement")
    by_id = {r["id"]: r["zeroEdit"] for r in report["records"]}
    return [by_id[f"p{i}"] for i in range(len(pairs))]
