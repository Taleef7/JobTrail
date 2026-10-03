"""#71 step 2: freeze the eval sets from the drafts and one decision per draft.

Usage (from ml/):
  uv run python scripts/freeze_eval.py [DECISIONS.jsonl] [--out-dir DIR]

DECISIONS defaults to data/review/adjudication/decisions.jsonl (the cross-family model
adjudication; the owner declined manual review). Writes, under DIR (default data/):
  test.jsonl, dev.jsonl            frozen gold records, each with `verified` and `review`
  review/stats.json                outcomes by reason, fields edited, clean-draft change rate
  FROZEN.md                        SHA-256 of each frozen file; CI fails if one changes
Refuses to run unless every draft has exactly one decision for its current note and key.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from jobtrail_ml.freeze import apply_decisions, check_frozen, review_stats  # noqa: E402
from jobtrail_ml.review import SPLITS  # noqa: E402

ROOT = ML.parent
DATA = ROOT / "data"
FROZEN_FILES = ("test.jsonl", "dev.jsonl")


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def frozen_md(out: Path, counts: dict[str, int], today: str) -> str:
    rows = "\n".join(
        f"| `data/{name}` | {counts[name]} | `{sha256(out / name)}` |" for name in FROZEN_FILES
    )
    return f"""# Frozen eval data

Frozen on {today} by `ml/scripts/freeze_eval.py` (#71).
`ml/tests/test_frozen.py` runs in CI and fails if any file below changes.
These files are **never edited**: additions (e.g. the spoken-note slice, #92)
go into a new versioned file whose hash is appended here.

| File | Records | SHA-256 |
| --- | ---: | --- |
{rows}
"""


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("decisions", type=Path, nargs="?",
                    default=DATA / "review" / "adjudication" / "decisions.jsonl")  # fmt: skip
    ap.add_argument("--out-dir", type=Path, default=DATA)
    ap.add_argument("--refreeze", action="store_true", help="overwrite an existing freeze")
    args = ap.parse_args()

    drafts = [d for s in SPLITS for d in read_jsonl(DATA / "drafts" / f"{s}.jsonl")]
    decisions = read_jsonl(args.decisions)
    frozen = apply_decisions(drafts, decisions)
    stats = review_stats(drafts, decisions)
    stats["rejected_notes"] = frozen["rejected"]
    stats["counts"] = {s: len(frozen[s]) for s in SPLITS}

    out = args.out_dir
    if (out / "FROZEN.md").exists() and not args.refreeze:
        raise SystemExit(f"{out} is already frozen (FROZEN.md exists). To check the freeze, run "
                         "with --out-dir <scratch folder> and compare hashes; --refreeze only "
                         "before the freeze is merged.")  # fmt: skip
    for s in SPLITS:
        write_jsonl(out / f"{s}.jsonl", frozen[s])
    (out / "review").mkdir(parents=True, exist_ok=True)
    (out / "review" / "stats.json").write_text(
        json.dumps(stats, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
    )
    counts = {f"{s}.jsonl": len(frozen[s]) for s in SPLITS}
    today = max(x["reviewedAt"] for x in decisions)[:10]  # reproducible, unlike now()
    (out / "FROZEN.md").write_text(frozen_md(out, counts, today), encoding="utf-8", newline="\n")
    problems = check_frozen(out)
    if problems:
        raise SystemExit("freeze self-check failed: " + "; ".join(problems))
    print(json.dumps({k: v for k, v in stats.items() if k != "rejected_notes"}, indent=2))
    print(f"→ {out}: test {counts['test.jsonl']}, dev {counts['dev.jsonl']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
