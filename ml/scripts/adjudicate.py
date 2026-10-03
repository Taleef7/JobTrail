"""#71: cross-family adjudication of the 275 eval drafts (the owner declined manual review).

Usage (from ml/):
  uv run python scripts/adjudicate.py prepare               # batches + response schema
  uv run python scripts/adjudicate.py prompts --out DIR     # one prompt file per batch
  uv run python scripts/adjudicate.py run gemini [--only b01,b02] [--jobs 3]
  uv run python scripts/adjudicate.py contested             # GPT's tie-break batches
  uv run python scripts/adjudicate.py run gpt [--jobs 2]
  uv run python scripts/adjudicate.py check gpt|gemini|claude [--only b01]
  uv run python scripts/adjudicate.py decide [--reviewed-at ISO]   # + overrides.jsonl
  uv run python scripts/adjudicate.py sensitivity           # vs the superseded reviewers

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
    apply_overrides,
    batches,
    check_vote_file,
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


def recorded_batches(reviewer: str) -> list[dict]:
    """The batches as reviewed: names, ids and prompt hashes from batches.json (b01...)
    or tiebreak.json (t01...), not recomputed from today's rules."""
    path = TIEBREAK_FILE if reviewer == TIEBREAK else OUT / "batches.json"
    return json.loads(path.read_text(encoding="utf-8"))["batches"]


def read_vote_file(reviewer: str, batch: dict) -> dict[str, dict]:
    """One batch's votes, checked against the manifest: reviewer, model, batch, prompt, ids."""
    path = OUT / "votes" / reviewer / f"{batch['batch']}.json"
    meta = json.loads(path.read_text(encoding="utf-8"))
    check_vote_file(meta, reviewer, batch["batch"], batch["prompt_sha256"])
    return check_votes(batch["ids"], reviewer, meta["decisions"])


def load_votes(reviewer: str) -> dict[str, dict]:
    got: dict[str, dict] = {}
    for batch in recorded_batches(reviewer):
        got.update(read_vote_file(reviewer, batch))
    return got


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n", encoding="utf-8",
                    newline="\n")  # fmt: skip


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def manifest(bs: list[tuple[str, list[dict]]], rules: str) -> list[dict]:
    return [{"batch": name, "ids": [x["id"] for x in b], "prompt_sha256": sha256(prompt(rules, b))}
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


def valid_votes(path: Path, ids: list[str], reviewer: str, sha: str) -> bool:
    """Reuse a vote file only if it answers today's prompt for this batch."""
    if not path.exists():
        return False
    try:
        meta = json.loads(path.read_text(encoding="utf-8"))
        check_vote_file(meta, reviewer, path.stem, sha)
        check_votes(ids, reviewer, meta["decisions"])
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
        text = prompt(rules, b)
        if not valid_votes(path, ids, args.reviewer, sha256(text)):
            todo.append((name, ids, text, path))

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
                              "batch": name, "prompt_sha256": sha256(text), "usage": usage,
                              "decisions": result["decisions"]})  # fmt: skip
            return f"{name} ok"
        return f"{name} FAILED"

    print(f"{args.reviewer}: {len(todo)} batches to do")
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for msg in pool.map(one, todo):
            print(f"  {args.reviewer} {msg}", flush=True)


def cmd_check(args) -> None:
    """Validate a reviewer's vote files against the manifest (all batches, or --only)."""
    bad = 0
    for batch in recorded_batches(args.reviewer):
        name = batch["batch"]
        if args.only and name not in args.only.split(","):
            continue
        try:
            read_vote_file(args.reviewer, batch)
            print(f"{name}: ok")
        except (OSError, ValueError, KeyError, TypeError) as e:
            bad += 1
            print(f"{name}: {type(e).__name__}: {e}")
    sys.exit(1 if bad else 0)


OVERRIDES = OUT / "overrides.jsonl"


def reviewed_at(args) -> str:
    """--reviewed-at, else the time already in decisions.jsonl, so a rerun reproduces it."""
    if args.reviewed_at:
        return args.reviewed_at
    if (OUT / "decisions.jsonl").exists():
        return read_jsonl(OUT / "decisions.jsonl")[0]["reviewedAt"]
    return datetime.now(UTC).isoformat(timespec="seconds")


def cmd_sensitivity(_args) -> None:
    """What the reviewers planned before the owner's model changes (gpt-6-astra,
    gemini-3.1-pro-high, Claude Opus) decide on the drafts all three covered, vs final."""
    drafts, _ = load()

    def superseded(name: str) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for f in sorted((OUT / "superseded" / name).glob("b*.json")):
            out.update({v["id"]: v for v in json.loads(f.read_text(encoding="utf-8"))["decisions"]})
        return out

    astra, pro = superseded("gpt-6-astra"), superseded("gemini-3.1-pro-high")
    covered = sorted(set(astra) & set(pro))
    sub = [d for d in drafts if d["id"] in covered]
    planned = aggregate(sub, {"gpt": astra, "gemini": pro, "claude": load_votes("claude")},
                        zero_edit, {d["id"]: [] for d in sub}, "")  # fmt: skip
    final = {x["id"]: x for x in read_jsonl(OUT / "decisions.jsonl")}
    both = [(x, final[x["id"]]) for x in planned if x["gold"] and final[x["id"]]["gold"]]
    flat = [p for x, f in both for p in ((x["gold"], f["gold"]), (f["gold"], x["gold"]))]
    v = zero_edit(flat) if flat else []
    same = {x["id"]: v[2 * i] and v[2 * i + 1] for i, (x, _) in enumerate(both)}
    rows = []
    for x in planned:
        f = final[x["id"]]
        if x["gold"] is None or f["gold"] is None:
            outcome = "same" if x["gold"] is None and f["gold"] is None else "different"
        else:
            outcome = "same" if same[x["id"]] else "different"
        if outcome == "different":
            fields = [k for k in (x["gold"] or {}) if f["gold"] and x["gold"][k] != f["gold"][k]]
            rows.append({"id": x["id"], "planned": x["action"], "final": f["action"],
                         "fields": fields, "planned_key": x["gold"],
                         "final_key": f["gold"]})  # fmt: skip
    out = {"reviewers": {"gpt": "gpt-6-astra", "gemini": "gemini-3.1-pro-high",
                         "claude": "claude-opus-5-5"},
           "drafts": len(planned), "same": len(planned) - len(rows), "different": rows}  # fmt: skip
    write_json(OUT / "sensitivity.json", out)
    print(f"{out['same']}/{out['drafts']} same; different: {[r['id'] for r in rows]}")


def cmd_decide(args) -> None:
    drafts, panel = load()
    votes = {r: load_votes(r) for r in REVIEWERS}
    unsettled = contested(drafts, {r: votes[r] for r in FIRST}, zero_edit)
    if sorted(unsettled) != sorted(votes[TIEBREAK]):
        sys.exit("tiebreak.json is stale: rerun `contested` and the tie-break votes")
    decisions = aggregate(drafts, votes, zero_edit, {d["id"]: reasons(d, panel) for d in drafts},
                          reviewed_at(args))  # fmt: skip
    apply_overrides(decisions, read_jsonl(OVERRIDES) if OVERRIDES.exists() else [], drafts)
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
    sub.add_parser("sensitivity").set_defaults(fn=cmd_sensitivity)
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
