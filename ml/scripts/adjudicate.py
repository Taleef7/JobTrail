"""#71: cross-family adjudication of the 275 eval drafts (the owner declined manual review).

Usage (from ml/):
  uv run python scripts/adjudicate.py prepare               # batches + response schema
  uv run python scripts/adjudicate.py prompts --out DIR     # one prompt file per batch
  uv run python scripts/adjudicate.py run gpt|gemini [--only b01,b02] [--jobs 3]
  uv run python scripts/adjudicate.py check gpt|gemini|claude [--only b01]
  uv run python scripts/adjudicate.py decide [--reviewed-at ISO]

Votes land in data/review/adjudication/votes/<reviewer>/<batch>.json. `run` drives the
Codex CLI (GPT) and the Antigravity CLI (Gemini); the Claude votes are written by Opus
subagents from the same prompt files. `run` is resumable: a batch with a valid vote file
is skipped. `decide` needs every reviewer's vote on every draft.
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
    REVIEWERS,
    adjudication_stats,
    aggregate,
    batches,
    check_votes,
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


def plan() -> tuple[list[list[dict]], str]:
    drafts, panel = load()
    rules = RULES.read_text(encoding="utf-8")
    return batches(review_items(drafts, panel), rules), rules


def batch_name(i: int) -> str:
    return f"b{i + 1:02d}"


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n", encoding="utf-8",
                    newline="\n")  # fmt: skip


def cmd_prepare(_args) -> None:
    bs, rules = plan()
    write_json(OUT / "vote.schema.json", vote_schema())
    write_json(OUT / "batches.json", {
        "reviewers": REVIEWERS,
        "rules_sha256": hashlib.sha256(RULES.read_bytes()).hexdigest(),
        "batches": [{"batch": batch_name(i), "ids": [x["id"] for x in b],
                     "prompt_sha256": hashlib.sha256(prompt(rules, b).encode()).hexdigest()}
                    for i, b in enumerate(bs)],
    })  # fmt: skip
    print(f"{sum(map(len, bs))} drafts in {len(bs)} batches -> {OUT}")


def cmd_prompts(args) -> None:
    bs, rules = plan()
    args.out.mkdir(parents=True, exist_ok=True)
    for i, b in enumerate(bs):
        (args.out / f"{batch_name(i)}.md").write_text(prompt(rules, b), encoding="utf-8")
    print(f"{len(bs)} prompts -> {args.out}")


def exe(name: str) -> str:
    path = shutil.which(name)  # codex is an npm .cmd shim on Windows
    if not path:
        raise RuntimeError(f"{name} not found on PATH")
    return path


def _gpt(text: str, schema: Path, cwd: Path) -> tuple[dict, dict]:
    out = cwd / "last.json"
    proc = subprocess.run(
        [exe("codex"), "exec", "-m", "gpt-6.1-sol", "-c", "model_reasoning_effort=high",
         "-s", "read-only", "--skip-git-repo-check", "--ephemeral",
         "--output-schema", str(schema), "-o", str(out), "-"],
        input=text, cwd=cwd, capture_output=True, text=True, encoding="utf-8", timeout=1800,
    )  # fmt: skip
    if proc.returncode != 0 or not out.exists():
        raise RuntimeError(f"codex exit {proc.returncode}: {proc.stderr[-400:]}")
    return json.loads(out.read_text(encoding="utf-8")), {}


def _gemini(text: str, schema: Path, cwd: Path) -> tuple[dict, dict]:
    proc = subprocess.run(
        [exe("agy"), "--model", "gemini-3.8-flash-high", "--json-schema", str(schema),
         "--output-format", "json", "--print-timeout", "1500s", f"-p={text}"],
        cwd=cwd, capture_output=True, text=True, encoding="utf-8", timeout=1800,
    )  # fmt: skip
    if proc.returncode != 0:
        raise RuntimeError(f"agy exit {proc.returncode}: {(proc.stderr or proc.stdout)[-400:]}")
    body = json.loads(proc.stdout)
    if body.get("status") != "SUCCESS" or not body.get("structured_output"):
        raise RuntimeError(f"agy status {body.get('status')}: {str(body)[:400]}")
    return body["structured_output"], body.get("usage", {})


CLIS = {"gpt": _gpt, "gemini": _gemini}


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
    bs, rules = plan()
    schema = OUT / "vote.schema.json"
    todo = []
    for i, b in enumerate(bs):
        name, ids = batch_name(i), [x["id"] for x in b]
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
    bs, _ = plan()
    bad = 0
    for i, b in enumerate(bs):
        name = batch_name(i)
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
    bs, _ = plan()
    votes: dict[str, dict] = {}
    for reviewer in REVIEWERS:
        votes[reviewer] = {}
        for i, b in enumerate(bs):
            path = OUT / "votes" / reviewer / f"{batch_name(i)}.json"
            got = json.loads(path.read_text(encoding="utf-8"))["decisions"]
            votes[reviewer].update(check_votes([x["id"] for x in b], reviewer, got))
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
    p = sub.add_parser("prompts")
    p.add_argument("--out", type=Path, required=True)
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
