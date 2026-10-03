"""#73 error analysis: sample a run's failures (records that aren't zero-edit) for reading.

Usage (from ml/):
  uv run python scripts/failures.py ../results/runs/<run id> --n 30 [--seed 73] --out FILE

Each line: id, tags, note, gold, the prediction (parsed record, or the raw text when it
doesn't parse) and what the scorer marked wrong, field by field. Sampling is seeded, so
the same command gives the same cases.
"""

import argparse
import json
import random
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from jobtrail_ml.runs import gold_path, read_jsonl, score_run  # noqa: E402


def wrong_fields(rec: dict) -> list[str]:
    """The scorer's per-record verdict as a list of what to fix."""
    if rec["parse"] != "ok":
        return [f"output: {rec['parse']} failure"]
    out = [f"{k}: wrong" for k, ok in rec["scalars"].items() if not ok]
    for k, c in rec["lists"].items():
        if c["fp"] or c["fn"]:
            out.append(f"{k}: {c['fp']} extra, {c['fn']} missing")
    m = rec["materials"]
    if m["fp"] or m["fn"]:
        out.append(f"materials: {m['fp']} extra, {m['fn']} missing")
    if m["quantityCorrect"] < m["tp"]:
        out.append(f"materials: {m['tp'] - m['quantityCorrect']} wrong quantity")
    if m["unitCorrect"] < m["tp"]:
        out.append(f"materials: {m['tp'] - m['unitCorrect']} wrong unit")
    return out


def parsed(raw: str):
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return raw


def failures(run_dir: Path) -> list[dict]:
    report_path = run_dir / "report.json"
    report = (
        json.loads(report_path.read_text("utf-8")) if report_path.exists() else score_run(run_dir)
    )
    gold = {g["id"]: g for g in read_jsonl(gold_path(run_dir))}
    preds = {p["id"]: p for p in read_jsonl(run_dir / "predictions.jsonl")}
    out = []
    for rec in report["records"]:
        if rec["zeroEdit"]:
            continue
        g, p = gold[rec["id"]], preds.get(rec["id"])
        out.append({"id": rec["id"], "run": run_dir.name, "tags": g["tags"], "note": g["note"],
                    "gold": g["gold"], "predicted": parsed(p["raw"]) if p else None,
                    "wrong": wrong_fields(rec)})  # fmt: skip
    return out


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir", type=Path)
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--seed", type=int, default=73)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    cases = failures(args.run_dir.resolve())
    picked = sorted(random.Random(args.seed).sample(cases, min(args.n, len(cases))),
                    key=lambda c: c["id"])  # fmt: skip
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("".join(json.dumps(c, ensure_ascii=False) + "\n" for c in picked),
                        encoding="utf-8", newline="\n")  # fmt: skip
    print(f"{len(cases)} failures in {args.run_dir.name}; sampled {len(picked)} -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
