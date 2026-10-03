"""#71: cross-family adjudication of the 275 eval drafts (the owner declined manual review).

Usage (from ml/):
  uv run python scripts/adjudicate.py prepare               # batches + response schema
  uv run python scripts/adjudicate.py prompts --out DIR     # one prompt file per batch
  uv run python scripts/adjudicate.py run gemini [--only b01,b02] [--jobs 3]
  uv run python scripts/adjudicate.py contested             # GPT's tie-break batches
  uv run python scripts/adjudicate.py run gpt [--jobs 2]
  uv run python scripts/adjudicate.py check gpt|gemini|claude [--only b01]
  uv run python scripts/adjudicate.py decide [--reviewed-at ISO]

Votes land in data/review/adjudication/votes/<reviewer>/<batch>.json. `run` drives the
Antigravity CLI (Gemini 3.8 Flash and GPT-OSS 120B); the Claude votes are written by Opus
subagents from the same prompt files. Gemini and Claude vote on every draft (batches
b01...); GPT votes only on the drafts they leave unsettled (tiebreak.json, batches
t01...). `run` is resumable: a batch with a valid vote file is skipped.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from jobtrail_ml.adjudicate import (  # noqa: E402
    FIRST,
    REVIEWERS,
    TIEBREAK,
    adjudication_stats,
    aggregate,
    batches,
    check_votes,
    contested,
    prompt,
    reasons,
    review_items,
    vote_schema,
)
from jobtrail_ml.review import MODELS, SPLITS  # noqa: E402
from jobtrail_ml.scorer import zero_edit  # noqa: E402

ROOT = ML.parent
DATA = ROOT / "data"
OUT = DATA / "review" / "adjudication"
RULES = DATA / "LABELING.md"


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def load():
    drafts = [d for s in SPLITS for d in read_jsonl(DATA / "drafts" / f"{s}.jsonl")]
    panel = {
        m: {
            v["id"]: v
            for s in SPLITS
            for v in read_jsonl(DATA / "review" / "panel" / f"{s}-{m}.jsonl")
        }
        for m in MODELS
    }
    return drafts, panel


TIEBREAK_FILE = OUT / "tiebreak.json"


def plan(reviewer: str | None = None) -> tuple[list[tuple[str, list[dict]]], str]:
    """(batch name, items) for a reviewer: every draft, or for the tie-breaker only the
    drafts listed in tiebreak.json."""
    drafts, panel = load()
    rules = RULES.read_text(encoding="utf-8")
    items = review_items(drafts, panel)
    if reviewer == TIEBREAK:
        if not TIEBREAK_FILE.exists():
            sys.exit("no tiebreak.json yet: run `contested` after the gemini and claude votes")
        wanted = set(json.loads(TIEBREAK_FILE.read_text(encoding="utf-8"))["ids"])
        chosen = [x for x in items if x["id"] in wanted]
        return [(f"t{i + 1:02d}", b) for i, b in enumerate(batches(chosen, rules))], rules
    return [(f"b{i + 1:02d}", b) for i, b in enumerate(batches(items, rules))], rules


def load_votes(reviewer: str) -> dict[str, dict]:
    got: dict[str, dict] = {}
    for name, b in plan(reviewer)[0]:
        path = OUT / "votes" / reviewer / f"{name}.json"
        decisions = json.loads(path.read_text(encoding="utf-8"))["decisions"]
        got.update(check_votes([x["id"] for x in b], reviewer, decisions))
    return got


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n", encoding="utf-8",
                    newline="\n")  # fmt: skip


def manifest(bs: list[tuple[str, list[dict]]], rules: str) -> list[dict]:
    return [{"batch": name, "ids": [x["id"] for x in b],
             "prompt_sha256": hashlib.sha256(prompt(rules, b).encode()).hexdigest()}
            for name, b in bs]  # fmt: skip


def cmd_prepare(_args) -> None:
    bs, rules = plan()
    write_json(OUT / "vote.schema.json", vote_schema())
    write_json(OUT / "batches.json", {
        "reviewers": REVIEWERS,
        "rules_sha256": hashlib.sha256(RULES.read_bytes()).hexdigest(),
        "batches": manifest(bs, rules),
    })  # fmt: skip
    print(f"{sum(len(b) for _, b in bs)} drafts in {len(bs)} batches -> {OUT}")


def cmd_contested(_args) -> None:
    """After the FIRST reviewers: the drafts they leave unsettled go to the tie-breaker."""
    drafts, _ = load()
    ids = contested(drafts, {r: load_votes(r) for r in FIRST}, zero_edit)
    write_json(TIEBREAK_FILE, {"reviewer": TIEBREAK, "settledBy": list(FIRST), "ids": ids})
    bs, rules = plan(TIEBREAK)
    write_json(TIEBREAK_FILE, {"reviewer": TIEBREAK, "settledBy": list(FIRST), "ids": ids,
                               "batches": manifest(bs, rules)})  # fmt: skip
    print(f"{len(ids)} of {len(drafts)} drafts need a tie-break, in {len(bs)} batches")


def cmd_prompts(args) -> None:
    bs, rules = plan(args.reviewer)
    args.out.mkdir(parents=True, exist_ok=True)
    for name, b in bs:
        (args.out / f"{name}.md").write_text(prompt(rules, b), encoding="utf-8")
    print(f"{len(bs)} prompts -> {args.out}")


def exe(name: str) -> str:
    path = shutil.which(name)  # resolves .cmd and .exe shims on Windows
    if not path:
        raise RuntimeError(f"{name} not found on PATH")
    return path


def _agy(model: str, text: str, schema: Path, cwd: Path) -> tuple[dict, dict]:
    proc = subprocess.run(
        [exe("agy"), "--model", model, "--json-schema", str(schema),
         "--output-format", "json", "--print-timeout", "1500s", f"-p={text}"],
        cwd=cwd, capture_output=True, text=True, encoding="utf-8", timeout=1800,
    )  # fmt: skip
    if proc.returncode != 0:
        raise RuntimeError(f"agy exit {proc.returncode}: {(proc.stderr or proc.stdout)[-400:]}")
    body = json.loads(proc.stdout)
    if body.get("status") != "SUCCESS" or not body.get("structured_output"):
        raise RuntimeError(f"agy status {body.get('status')}: {str(body)[:400]}")
    return body["structured_output"], body.get("usage", {})


CLIS = {
    "gpt": lambda text, schema, cwd: _agy("gpt-oss-120b-medium", text, schema, cwd),
    "gemini": lambda text, schema, cwd: _agy("gemini-3.8-flash-high", text, schema, cwd),
}


def valid_votes(path: Path, ids: list[str], reviewer: str) -> bool:
    if not path.exists():
        return False
    try:
        check_votes(ids, reviewer, json.loads(path.read_text(encoding="utf-8"))["decisions"])
    except (ValueError, KeyError, json.JSONDecodeError) as e:
        print(f"  {path.name}: invalid ({e}); redoing")
        return False
    return True


def cmd_run(args) -> None:
    bs, rules = plan(args.reviewer)
    schema = OUT / "vote.schema.json"
    todo = []
    for name, b in bs:
        ids = [x["id"] for x in b]
        if args.only and name not in args.only.split(","):
            continue
        path = OUT / "votes" / args.reviewer / f"{name}.json"
        if not valid_votes(path, ids, args.reviewer):
            todo.append((name, ids, prompt(rules, b), path))

    def one(job) -> str:
        name, ids, text, path = job
        for attempt in range(1, 3):
            # agy can keep a handle on its working folder after it exits (Windows)
            with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
                try:
                    result, usage = CLIS[args.reviewer](text, schema, Path(tmp))
                    check_votes(ids, args.reviewer, result["decisions"])
                except (RuntimeError, ValueError, KeyError, json.JSONDecodeError,
                        subprocess.TimeoutExpired) as e:  # fmt: skip
                    print(f"  {args.reviewer} {name} attempt {attempt}: {e}")
                    continue
            write_json(path, {"reviewer": args.reviewer, "model": REVIEWERS[args.reviewer],
                              "batch": name, "usage": usage,
                              "decisions": result["decisions"]})  # fmt: skip
            return f"{name} ok"
        return f"{name} FAILED"

    print(f"{args.reviewer}: {len(todo)} batches to do")
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for msg in pool.map(one, todo):
            print(f"  {args.reviewer} {msg}", flush=True)


def cmd_check(args) -> None:
    """Validate a reviewer's vote files (all batches, or --only)."""
    bs, _ = plan(args.reviewer)
    bad = 0
    for name, b in bs:
        if args.only and name not in args.only.split(","):
            continue
        path = OUT / "votes" / args.reviewer / f"{name}.json"
        try:
            check_votes([x["id"] for x in b], args.reviewer,
                        json.loads(path.read_text(encoding="utf-8"))["decisions"])  # fmt: skip
            print(f"{name}: ok")
        except (OSError, ValueError, KeyError, TypeError) as e:
            bad += 1
            print(f"{name}: {type(e).__name__}: {e}")
    sys.exit(1 if bad else 0)


def cmd_decide(args) -> None:
    drafts, panel = load()
    votes = {r: load_votes(r) for r in REVIEWERS}
    unsettled = contested(drafts, {r: votes[r] for r in FIRST}, zero_edit)
    if sorted(unsettled) != sorted(votes[TIEBREAK]):
        sys.exit("tiebreak.json is stale: rerun `contested` and the tie-break votes")
    reviewed_at = args.reviewed_at or datetime.now(UTC).isoformat(timespec="seconds")
    decisions = aggregate(drafts, votes, zero_edit, {d["id"]: reasons(d, panel) for d in drafts},
                          reviewed_at)  # fmt: skip
    order = {s: i for i, s in enumerate(SPLITS)}
    decisions.sort(key=lambda x: (order[x["split"]], x["id"]))
    with (OUT / "decisions.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        f.writelines(json.dumps(x, ensure_ascii=False) + "\n" for x in decisions)
    stats = adjudication_stats(decisions)
    write_json(OUT / "stats.json", stats)
    print(json.dumps(stats, indent=1))


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(required=True)
    sub.add_parser("prepare").set_defaults(fn=cmd_prepare)
    sub.add_parser("contested").set_defaults(fn=cmd_contested)
    p = sub.add_parser("prompts")
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--reviewer", choices=sorted(REVIEWERS), help="gpt: the tie-break batches")
    p.set_defaults(fn=cmd_prompts)
    r = sub.add_parser("run")
    r.add_argument("reviewer", choices=sorted(CLIS))
    r.add_argument("--only", help="comma-separated batch names, e.g. b01,b02")
    r.add_argument("--jobs", type=int, default=2)
    r.set_defaults(fn=cmd_run)
    c = sub.add_parser("check")
    c.add_argument("reviewer", choices=sorted(REVIEWERS))
    c.add_argument("--only")
    c.set_defaults(fn=cmd_check)
    d = sub.add_parser("decide")
    d.add_argument("--reviewed-at")
    d.set_defaults(fn=cmd_decide)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
