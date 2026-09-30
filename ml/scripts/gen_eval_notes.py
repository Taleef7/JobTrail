"""#70: draft eval notes (test + dev) from the scenario matrix, record-first.

Usage (from ml/):
  uv run python scripts/gen_eval_notes.py plan            # deterministic plan + manifest
  uv run python scripts/gen_eval_notes.py run [--limit N] [--rpm R]
  uv run python scripts/gen_eval_notes.py report          # data/drafts/coverage.md

`run` needs GEMINI_API_KEY (env or ml/.env), resumes from data/drafts/*.jsonl, drafts
the test split first, and stops cleanly on the daily free-tier quota.
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from jobtrail_ml.fidelity import crosscheck_flags, note_flags  # noqa: E402
from jobtrail_ml.gemini import GeminiClient  # noqa: E402
from jobtrail_ml.generate import RunConfig, run_generation  # noqa: E402
from jobtrail_ml.report import coverage_markdown  # noqa: E402
from jobtrail_ml.sampler import load_scenarios, plan_splits  # noqa: E402

ROOT = ML.parent
SCENARIOS = ROOT / "data" / "scenarios.yaml"
SCHEMA = ROOT / "packages" / "core" / "schema" / "schema.v2.json"
OUT = ROOT / "data" / "drafts"

SEED = 70
COUNTS = {"test": 165, "dev": 110}
MIN_TEST_PER_TAG = 12
# Free tier: 20 requests per model per day (GenerateRequestsPerDayPerProjectPerModel-FreeTier),
# hence batches. gemini-3.8-flash is kept out of generation so it can be the cloud
# ceiling in #73 without grading its own prose.
WRITER, CHECKER = "gemini-3.6-flash", "gemini-3.1-flash-lite"
BATCH_SIZE = 20
WRITER_TEMPERATURE, CHECKER_TEMPERATURE, THINKING = 1.0, 0.0, "low"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    text = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    path.write_text(text, encoding="utf-8", newline="\n")


def make_plans() -> list[dict]:
    return plan_splits(load_scenarios(SCENARIOS), seed=SEED, counts=COUNTS)


def cmd_plan(_: argparse.Namespace) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    plans = make_plans()
    write_jsonl(OUT / "plan.jsonl", plans)
    manifest = {
        "issue": 70,
        "seed": SEED,
        "counts": COUNTS,
        "batchSize": BATCH_SIZE,
        "writer": {"model": WRITER, "temperature": WRITER_TEMPERATURE, "thinkingLevel": THINKING},
        "checker": {"model": CHECKER, "temperature": CHECKER_TEMPERATURE,
                    "thinkingLevel": THINKING, "responseJsonSchema": "schema.v2.json"},
        "sha256": {
            "data/scenarios.yaml": sha256(SCENARIOS),
            "packages/core/schema/schema.v2.json": sha256(SCHEMA),
            "ml/jobtrail_ml/sampler.py": sha256(ML / "jobtrail_ml" / "sampler.py"),
            "ml/jobtrail_ml/prompts.py": sha256(ML / "jobtrail_ml" / "prompts.py"),
            "ml/jobtrail_ml/generate.py": sha256(ML / "jobtrail_ml" / "generate.py"),
            "data/drafts/plan.jsonl": sha256(OUT / "plan.jsonl"),
        },
    }  # fmt: skip
    manifest_text = json.dumps(manifest, indent=2) + "\n"
    (OUT / "manifest.json").write_text(manifest_text, encoding="utf-8", newline="\n")
    print(f"planned {len(plans)} drafts -> {OUT / 'plan.jsonl'}")
    return 0


def api_key() -> str:
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"]
    env = ML / ".env"
    for line in env.read_text(encoding="utf-8").splitlines() if env.exists() else []:
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("GEMINI_API_KEY not set (env or ml/.env)")


def cmd_run(args: argparse.Namespace) -> int:
    plans = read_jsonl(OUT / "plan.jsonl")
    if plans != make_plans():
        raise SystemExit("plan.jsonl is out of date with scenarios/sampler: run `plan` first")
    done = {d["id"] for s in COUNTS for d in read_jsonl(OUT / f"{s}.jsonl")}
    todo = [p for p in plans if p["id"] not in done][: args.limit]
    cfg = RunConfig(WRITER, CHECKER, WRITER_TEMPERATURE, CHECKER_TEMPERATURE, THINKING, SEED,
                    json.loads(SCHEMA.read_text(encoding="utf-8")), BATCH_SIZE)  # fmt: skip
    started = datetime.now(UTC).isoformat(timespec="seconds")
    styles = load_scenarios(SCENARIOS)["styles"]
    summary = run_generation(todo, styles, OUT, GeminiClient(api_key(), rpm=args.rpm), cfg)
    summary |= {"started": started, "finished": datetime.now(UTC).isoformat(timespec="seconds"),
                "requested": len(todo), "rpm": args.rpm}  # fmt: skip
    with (OUT / "runs.jsonl").open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(summary) + "\n")
    print(json.dumps(summary, indent=2))
    return 0 if not summary["stopped"] or summary["stopped"] == "daily quota" else 1


def cmd_report(_: argparse.Namespace) -> int:
    plans = read_jsonl(OUT / "plan.jsonl")
    by_id = {p["id"]: p for p in plans}
    drafts = []
    for split in COUNTS:
        rows = read_jsonl(OUT / f"{split}.jsonl")
        for d in rows:  # flags follow the current fidelity rules; notes and gold are untouched
            plan = by_id[d["id"]]
            d["meta"]["flags"] = note_flags(plan, d["note"]) + crosscheck_flags(
                plan["record"], d["meta"]["checked"]
            )
        if rows:
            write_jsonl(OUT / f"{split}.jsonl", rows)
        drafts += rows
    usage_rows = read_jsonl(OUT / "usage.jsonl")
    usage = {"calls": len(usage_rows), "total": sum(u["totalTokens"] for u in usage_rows)}
    md = coverage_markdown(plans, drafts, usage, min_test=MIN_TEST_PER_TAG)
    (OUT / "coverage.md").write_text(md, encoding="utf-8", newline="\n")
    print(md)
    return 0


def main(argv: list[str] | None = None) -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("plan").set_defaults(fn=cmd_plan)
    run = sub.add_parser("run")
    run.add_argument("--limit", type=int, default=None, help="draft at most N new notes")
    run.add_argument("--rpm", type=float, default=8.0, help="requests per minute budget")
    run.set_defaults(fn=cmd_run)
    sub.add_parser("report").set_defaults(fn=cmd_report)
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
