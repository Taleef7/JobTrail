"""#72: (re)score a finished run with the core scorer.

Usage (from ml/):  uv run python scripts/score_run.py ../results/runs/<run id>
Writes <run dir>/report.json; the runners call the same function when a run completes.
"""

import json
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from jobtrail_ml.runs import score_run  # noqa: E402


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    report = score_run(Path(sys.argv[1]).resolve())
    print(json.dumps({k: report["overall"][k] for k in
                      ("n", "zeroEditRate", "schemaValidRate", "hallucinationRate")}))  # fmt: skip
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
