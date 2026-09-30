"""#71: build data/review/queue.jsonl for the labeling tool (apps/web /label/).

Usage (from ml/):
  uv run python scripts/review_queue.py

Reads the drafts (data/drafts/{test,dev}.jsonl) and the model panel's verdicts
(data/review/panel/{split}-{model}.jsonl), then writes the queue: every flagged or
panel-questioned draft plus a seeded audit of AUDIT_N clean drafts.
"""

import json
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from jobtrail_ml.review import MODELS, SPLITS, build_queue, queue_summary  # noqa: E402

ROOT = ML.parent
DRAFTS = ROOT / "data" / "drafts"
REVIEW = ROOT / "data" / "review"
AUDIT_N = 30
SEED = 71


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def load_panel() -> dict[str, dict[str, dict]]:
    panel: dict[str, dict[str, dict]] = {m: {} for m in MODELS}
    for split in SPLITS:
        for model in MODELS:
            path = REVIEW / "panel" / f"{split}-{model}.jsonl"
            for v in read_jsonl(path):
                if not isinstance(v.get("ok"), bool) or not isinstance(v.get("problems"), list):
                    raise ValueError(f"{path}: bad verdict {v.get('id')}")
                if v["id"] in panel[model]:
                    raise ValueError(f"{path}: duplicate verdict {v['id']}")
                panel[model][v["id"]] = v
    return panel


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    drafts = [d for s in SPLITS for d in read_jsonl(DRAFTS / f"{s}.jsonl")]
    queue = build_queue(drafts, load_panel(), audit_n=AUDIT_N, seed=SEED)
    out = REVIEW / "queue.jsonl"
    with out.open("w", encoding="utf-8", newline="\n") as f:
        f.writelines(json.dumps(item, ensure_ascii=False) + "\n" for item in queue)
    print(json.dumps(queue_summary(drafts, queue), indent=2))
    print(f"→ {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
