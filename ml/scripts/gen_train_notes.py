"""#74: the training set, record-first, written and labeled through the Antigravity CLI.

Usage (from ml/):
  uv run python scripts/gen_train_notes.py write            # notes for plans 1..limit
  uv run python scripts/gen_train_notes.py label gemini     # blind labels
  uv run python scripts/gen_train_notes.py label gemini-medium
  uv run python scripts/gen_train_notes.py label luna --limit 150   # cross-check only
  uv run python scripts/gen_train_notes.py filter           # train.jsonl + reports
  uv run python scripts/gen_train_notes.py heldout          # held-out eval ids

limit is config.yaml's unless --limit N says otherwise; filter accepts only config.yaml's.

No API key: agy runs on the owner's plan. Every stage appends to data/train/raw/ and
resumes where it stopped; a batch is cut from the plan at fixed positions, so a resend
asks for the same notes. Settings: data/train/config.yaml.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
import traceback
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from jsonschema import Draft202012Validator  # noqa: E402

from jobtrail_ml import agy, codex, extract, trainset  # noqa: E402
from jobtrail_ml.prompts import (  # noqa: E402
    WRITER_BATCH_SCHEMA,
    WRITER_SYSTEM,
    writer_batch_prompt,
)
from jobtrail_ml.sampler import load_scenarios  # noqa: E402
from jobtrail_ml.scorer import zero_edit  # noqa: E402

ROOT = ML.parent
OUT = ROOT / "data" / "train"
RAW = OUT / "raw"
CONFIG = trainset.load_config(OUT / "config.yaml")
SCENARIOS = load_scenarios(ROOT / "data" / "scenarios.yaml")
SCHEMA = extract.schema("full")
LABELERS = {**CONFIG["labelers"], **(CONFIG.get("crosscheck") or {})}


def read_jsonl(path: Path) -> list[dict]:
    """Rows of a JSONL file, read only: another process may be appending to it (a labeler
    reads the writers' notes). An unparseable last line, an append in progress or one cut
    off by a crash, is skipped; the file's owner repairs it before appending (append)."""
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    rows = []
    for i, line in enumerate(lines):
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as e:
            if i != len(lines) - 1:
                raise ValueError(f"{path}:{i + 1}: corrupt line in the middle of the file") from e
    return rows


def read_log(path: Path) -> list[dict]:
    """A JSONL log without ids (usage.jsonl), read only: a line cut off by a crash is
    skipped, never repaired, since another process may be appending to the file."""
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def end_on_whole_line(path: Path) -> None:
    """Repairs a last line cut off by a crash: drops it, or ends it if it's a whole
    record that only lost its newline. Safe only for the file's one appender, which is
    why every process appends to files of its own (USAGE_SUFFIX, shard file names)."""
    if not path.exists():
        return
    data = path.read_bytes()
    if not data or data.endswith(b"\n"):
        return
    head, _, tail = data.rpartition(b"\n")
    try:
        json.loads(tail)
        data += b"\n"
    except ValueError:
        data = head + b"\n" if head else b""
    path.write_bytes(data)


def append(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    end_on_whole_line(path)
    with path.open("a", encoding="utf-8", newline="\n") as f:
        f.write("".join(json.dumps(r) + "\n" for r in rows))  # ASCII: no stray separators


def sha(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()[:16]


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def plans(limit: int) -> list[dict]:
    return trainset.plan_train(SCENARIOS, CONFIG, limit)


def writer_prompt(batch: list[dict]) -> str:
    return (
        f"{WRITER_SYSTEM}\n\n{writer_batch_prompt(batch, SCENARIOS['styles'])}{extract.AGY_TOOLS}"
    )


def check_plans(rows: list[dict], by_id: dict[str, dict]) -> None:
    """A saved note must come from today's plan; a re-plan would mix two datasets."""
    stale = [r["id"] for r in rows if r["id"] in by_id and r["plan"] != sha(by_id[r["id"]])]
    if stale:
        raise SystemExit(f"{len(stale)} saved notes don't match the plan ({stale[:3]}); "
                         "archive data/train/raw/ before going on")  # fmt: skip


USAGE_SUFFIX = ""  # set per process (e.g. ".write.1of3") so parallel runs log to their own file
RETRY_WAIT_S = (60, 300, 900)  # agy answers 503 "no capacity" for a while at times


def runtime(model: str) -> str:
    """The CLI and its version, best effort (a stamp on each row, never a reason to stop):
    agy, or Codex for a model written codex:<model>:<effort>."""
    try:
        if model.startswith("codex:"):
            exe = shutil.which("codex") or "codex"
            out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=60)
            return out.stdout.strip() or "codex"
        return f"agy {agy.version()}"
    except (agy.AgyError, OSError, subprocess.SubprocessError) as e:
        print(f"  version check failed ({str(e)[:120]}); stamping 'unknown'", flush=True)
        return "unknown"


def ask(model: str, prompt: str, schema: dict) -> tuple[dict, dict]:
    if model.startswith("codex:"):
        _, name, effort = model.split(":")
        return codex.run(name, effort, prompt, schema), {}
    return agy.run(model, prompt, schema)


def call(model: str, prompt: str, schema: dict, ids: list[str], role: str) -> dict | None:
    """One model call, retried after a pause on a busy server or a bad answer; its usage
    and wall time go to raw/usage.jsonl. None if every try failed."""
    for attempt, wait in enumerate((0, *RETRY_WAIT_S), 1):
        time.sleep(wait)
        t0 = time.monotonic()
        try:
            out, usage = ask(model, prompt, schema)
        except (agy.AgyError, codex.CodexError) as e:
            print(f"  {role} {ids[0]} attempt {attempt}: {str(e)[:300]}", flush=True)
            continue
        append(RAW / f"usage{USAGE_SUFFIX}.jsonl", [{"role": role, "model": model, "ids": ids,
                                      "seconds": round(time.monotonic() - t0, 1),
                                      "usage": usage, "at": now()}])  # fmt: skip
        return out
    return None


def batches(todo_ids: set[str], ps: list[dict], shard: tuple[int, int] = (1, 1)):
    """Writer batches cut from the plan at fixed positions; shard K/N takes every Nth."""
    n, (k, of) = CONFIG["batch_size"], shard
    cut = [ps[i : i + n] for i in range(0, len(ps), n)]
    return [b for j, b in enumerate(cut) if j % of == k - 1 and any(p["id"] in todo_ids for p in b)]


def note_rows() -> list[dict]:
    """Every saved note: notes.jsonl and the writer shards' notes.<k>of<n>.jsonl. Each
    process appends only to its own files, so parallel runs never write the same file."""
    paths = [RAW / "notes.jsonl", *sorted(RAW.glob("notes.*of*.jsonl"))]
    return [r for path in paths for r in read_jsonl(path)]


def cmd_write(args) -> int:
    if args.follow:
        args.follow = False
        return follow("write", cmd_write, args)
    ps = plans(args.limit)
    by_id = {p["id"]: p for p in ps}
    k, of = (int(x) for x in args.shard.split("/"))
    path = RAW / (f"notes.{k}of{of}.jsonl" if of > 1 else "notes.jsonl")
    rows = note_rows()
    check_plans(rows, by_id)
    done = {r["id"] for r in rows}
    model, version = CONFIG["writer"], runtime(CONFIG["writer"])
    todo = batches({p["id"] for p in ps} - done - gave_up(done), ps, (k, of))
    print(f"write {k}/{of}: {len(done & set(by_id))}/{len(ps)} done, {len(todo)} batches to go")
    for k, batch in enumerate(todo, 1):
        out = call(model, writer_prompt(batch), WRITER_BATCH_SCHEMA, [p["id"] for p in batch],
                   "writer")  # fmt: skip
        if out is None:
            return 1  # rerun to resume
        notes = {}
        for row in out.get("notes", []) if isinstance(out, dict) else []:
            if isinstance(row, dict) and isinstance(row.get("note"), str):
                notes.setdefault(row.get("id"), row["note"].strip())
        fresh = [{"id": p["id"], "note": notes[p["id"]], "plan": sha(p), "model": model,
                  "agy": version, "batch": batch[0]["id"]}
                 for p in batch if notes.get(p["id"]) and p["id"] not in done]  # fmt: skip
        append(path, fresh)
        done |= {r["id"] for r in fresh}
        print(f"  batch {k}/{len(todo)}: {len(fresh)} notes", flush=True)
    return 0


WRITER_TRIES = 3  # a plan the writer has been sent this often without a note is given up


def gave_up(notes: set[str]) -> set[str]:
    """Plans sent to the writer WRITER_TRIES times that still have no note."""
    logs = [r for f in sorted(RAW.glob("usage*.jsonl")) for r in read_log(f)]
    sent = Counter(i for u in logs if u["role"] == "writer" for i in u["ids"])
    return {i for i, n in sent.items() if n >= WRITER_TRIES and i not in notes}


def complete(stage: str, limit: int) -> bool:
    """Every plan up to `limit` has a note or was given up (write), and every note has a
    label (label-<name>)."""
    want = {p["id"] for p in plans(limit)}
    notes = {r["id"] for r in note_rows()} & want
    if notes | (gave_up(notes) & want) != want:
        return False
    if stage == "write":
        return True
    done = {r["id"] for r in label_rows(stage.removeprefix("label-"))}
    return notes <= done


def label_rows(name: str) -> list[dict]:
    """A labeler's rows from its file and its shard files (labels-<name>.<k>of<n>.jsonl)."""
    paths = [RAW / f"labels-{name}.jsonl", *sorted(RAW.glob(f"labels-{name}.*of*.jsonl"))]
    return [r for path in paths for r in read_jsonl(path)]


def label_batches(ps: list[dict], notes: dict, done: set[str], shard: tuple[int, int],
                  writer_done: bool = False):  # fmt: skip
    """Batches cut from the plan at fixed positions, so each belongs to one shard for good:
    those of this shard with a note left to label, once the writer has got past them (or
    has finished, which may leave a note it could never write)."""
    n, (k, of) = CONFIG["batch_size"], shard
    cut = [ps[i : i + n] for i in range(0, len(ps), n)]
    last = max((i for i, p in enumerate(ps) if p["id"] in notes), default=-1)
    out = []
    for j, b in enumerate(cut):
        ready = writer_done or all(p["id"] in notes for p in b) or last >= (j + 1) * n
        if j % of == k - 1 and ready and any(p["id"] in notes and p["id"] not in done for p in b):
            out.append([p for p in b if p["id"] in notes])
    return out


def follow(stage: str, run, args) -> int:
    """Run a stage again and again until it's complete: for unattended runs that a busy
    server or a slower stage upstream (labels wait for notes) would otherwise stop."""
    while True:
        try:
            rc = run(args)
        except Exception:  # noqa: BLE001 - an unattended run logs and tries again
            traceback.print_exc()
            rc = 1
        if complete(stage, args.limit):
            return 0
        wait = 600 if rc else 120
        print(f"{stage}: not complete (exit {rc}); next pass in {wait}s", flush=True)
        time.sleep(wait)


def cmd_label(args) -> int:
    if args.follow:
        args.follow = False
        return follow(f"label-{args.labeler}", cmd_label, args)
    name, model = args.labeler, LABELERS[args.labeler]
    ps = plans(args.limit)
    by_id = {p["id"]: p for p in ps}
    notes = {r["id"]: r for r in note_rows() if r["id"] in by_id}
    check_plans(list(notes.values()), by_id)
    k, of = (int(x) for x in args.shard.split("/"))
    tag = f"{name}.{k}of{of}" if of > 1 else name
    path = RAW / f"labels-{tag}.jsonl"
    done = {r["id"] for r in label_rows(name)}
    version = extract.prompt_version(CONFIG["label_prompt"])
    schema = extract.batch_schema({k: v for k, v in SCHEMA.items() if k != "$schema"})
    validator = Draft202012Validator(SCHEMA)
    agy_version = runtime(model)
    todo = label_batches(ps, notes, done, (k, of), writer_done=complete("write", args.limit))
    print(f"label {tag}: {len(done & set(notes))}/{len(notes)} done, {len(todo)} batches to go")
    for k, batch in enumerate(todo, 1):
        items = [{"id": p["id"], "note": notes[p["id"]]["note"]} for p in batch]
        out = call(model, extract.agy_batch_prompt("full", version, items), schema,
                   [i["id"] for i in items], f"label-{name}")  # fmt: skip
        if out is None:
            return 1
        append(RAW / f"answers-{tag}.jsonl", [{"ids": [i["id"] for i in items], "out": out}])
        rows = []
        for note_id, raw, finish in extract.split_batch([i["id"] for i in items],
                                                         json.dumps(out), "STOP"):  # fmt: skip
            if note_id in done or finish in ("MISSING_IN_BATCH", "UNPARSEABLE_BATCH"):
                continue  # not answered: left to do, so the next run resends it
            try:
                record = json.loads(raw)
            except json.JSONDecodeError:
                record = None
            if record is not None and not validator.is_valid(record):
                record = None
            rows.append(
                {
                    "id": note_id,
                    "label": record,
                    "raw": raw,
                    "finish": finish,
                    "model": model,
                    "agy": agy_version,
                    "note": sha(notes[note_id]["note"]),
                }
            )
        append(path, rows)
        done |= {r["id"] for r in rows}
        print(f"  batch {k}/{len(todo)}", flush=True)
    return 0


def eval_rows() -> list[dict]:
    paths = [ROOT / "data/test.jsonl", ROOT / "data/dev.jsonl"]
    return [json.loads(x) for p in paths for x in p.read_text(encoding="utf-8").splitlines()]


def cmd_filter(args) -> int:
    # The published files describe plans 1..limit; another limit would silently rewrite
    # them, so it must be changed in config.yaml (a recorded decision), not on the command line.
    if args.limit != CONFIG["limit"]:
        raise SystemExit(f"filter builds the set for config.yaml limit {CONFIG['limit']}, "
                         f"not {args.limit}; change the config to change the set")  # fmt: skip
    ps = plans(args.limit)
    by_id = {p["id"]: p for p in ps}
    notes = {r["id"]: r for r in sorted(note_rows(), key=lambda r: r["id"]) if r["id"] in by_id}
    check_plans(list(notes.values()), by_id)
    names = list(CONFIG["labelers"])
    labels = {n: current_labels(n, notes) for n in LABELERS}
    rows = [{"id": i, "labels": {n: labels[n][i] for n in names if i in labels[n]}}
            for i in notes]  # fmt: skip
    optional = CONFIG.get("optional_issues") or []
    verdict = trainset.decide(rows, {i: by_id[i]["record"] for i in notes}, names, zero_edit,
                              optional)  # fmt: skip
    kept = [i for i in notes if verdict[i]["reason"] is None]
    evals = eval_rows()
    leaks = trainset.leakage([{"id": i, "note": notes[i]["note"]} for i in kept], evals)
    final = [i for i in kept if not leaks[i]["near"]]

    train = [{"id": i, "note": notes[i]["note"], "target": verdict[i]["target"],
              "trade": by_id[i]["trade"], "style": by_id[i]["style"], "tags": by_id[i]["tags"],
              "source": "synthetic"} for i in final]  # fmt: skip
    text = "".join(json.dumps(t, ensure_ascii=False) + "\n" for t in train)
    (OUT / "train.jsonl").write_text(text, encoding="utf-8", newline="\n")

    reasons = Counter(v["reason"] or "kept" for v in verdict.values())
    contradicts = Counter(f for v in verdict.values() for f in v["contradicts"])
    report = {
        "issue": 74, "at": now(), "plans": len(ps), "notes": len(notes),
        "missingNotes": len(ps) - len(notes),
        "writerGaveUp": sorted(gave_up(set(notes)) & set(by_id)),
        "filter": {"counts": dict(reasons), "dropRate": round(1 - len(kept) / len(notes), 4)
                   if notes else None, "contradictsPlan": dict(contradicts)},
        "leakage": {"thresholds": trainset.LEAKAGE, "checked": len(kept),
                    "dropped": len(kept) - len(final),
                    "sharesAny8gram": sum(v["shares8"] for v in leaks.values())},
        "kept": len(final),
        # The filter drops hard notes more often; this shows how far the mix shifts.
        "mix": {"tag": mix(by_id, notes, final, lambda p: p["tags"] or ["(none)"]),
                "style": mix(by_id, notes, final, lambda p: [p["style"]]),
                "trade": mix(by_id, notes, final, lambda p: [p["trade"]])},
        "crosscheck": crosscheck(final, verdict, labels, by_id),
        "train.jsonl": hashlib.sha256(text.encode()).hexdigest(),
    }  # fmt: skip
    write_json(OUT / "leakage.json", {
        "thresholds": trainset.LEAKAGE,
        "nearDuplicates": {i: leaks[i] for i in kept if leaks[i]["near"]},
        "closest": sorted(({"id": i, **leaks[i]} for i in final), key=closeness)[:20],
    })  # fmt: skip
    drops = [{"id": i, "reason": v["reason"], "contradicts": v["contradicts"]}
             for i, v in sorted(verdict.items()) if v["reason"]]  # fmt: skip
    lines = "".join(json.dumps(d) + "\n" for d in drops)
    (RAW / "drops.jsonl").write_text(lines, encoding="utf-8", newline="\n")
    text_raw = "".join(json.dumps(r, ensure_ascii=False) + "\n"
                       for r in raw_rows(notes, by_id, labels, verdict, final))  # fmt: skip
    (OUT / "raw.jsonl").write_text(text_raw, encoding="utf-8", newline="\n")
    report["raw.jsonl"] = hashlib.sha256(text_raw.encode()).hexdigest()
    report["raw"] = {f.name: hashlib.sha256(f.read_bytes()).hexdigest()
                     for f in sorted(RAW.glob("*.jsonl"))}  # fmt: skip
    write_json(OUT / "filter.json", report)
    print(json.dumps(report, indent=2))
    return 0


def raw_rows(notes: dict, by_id: dict, labels: dict, verdict: dict, final: list[str]) -> list[dict]:
    """One row per written note, for the dataset's `raw` configuration: the plan, the note,
    each label and the decision, so the filter can be checked or redone. `labels` names only
    the models that labeled the note; a label of null means its answer was unparseable or
    invalid. A note the filter kept but the leakage check dropped is a near-duplicate."""
    final_set = set(final)
    return [{"id": i, "note": notes[i]["note"], "plan": by_id[i]["record"],
             "trade": by_id[i]["trade"], "style": by_id[i]["style"], "tags": by_id[i]["tags"],
             "labels": {n: got[i] for n, got in labels.items() if i in got},
             "kept": i in final_set,
             "reason": verdict[i]["reason"] or (None if i in final_set else "near-duplicate"),
             "contradicts": verdict[i]["contradicts"]} for i in notes]  # fmt: skip


def mix(by_id: dict, notes: dict, final: list[str], keys) -> dict[str, list[int]]:
    """{key: [written, kept]} for a plan attribute (tag, style or trade)."""
    written = Counter(k for i in notes for k in keys(by_id[i]))
    kept = Counter(k for i in final for k in keys(by_id[i]))
    return {k: [written[k], kept[k]] for k in sorted(written)}


def current_labels(name: str, notes: dict[str, dict]) -> dict[str, dict | None]:
    """{id: label} for notes as they are now (a label of an older note doesn't count)."""
    out = {}
    for r in label_rows(name):
        if r["id"] in notes and r["note"] == sha(notes[r["id"]]["note"]):
            out[r["id"]] = r["label"]
    return out


def crosscheck(final: list[str], verdict: dict, labels: dict, by_id: dict) -> dict:
    """How far each other model family agrees with the kept targets (not a filter)."""
    out = {}
    for name in CONFIG.get("crosscheck") or {}:
        got = [i for i in final if i in labels[name]]
        valid = [i for i in got if labels[name][i] is not None]
        pairs = [(verdict[i]["target"], labels[name][i]) for i in valid]
        both = zero_edit([x for a, b in pairs for x in ((a, b), (b, a))]) if pairs else []
        agree = sum(both[2 * k] and both[2 * k + 1] for k in range(len(pairs)))
        optional = CONFIG.get("optional_issues") or []
        facts = sum(not trainset.plan_contradictions(by_id[i]["record"], labels[name][i], optional)
                    for i in valid)  # fmt: skip
        out[name] = {"model": LABELERS[name], "labeled": len(got), "valid": len(valid),
                     "agreesWithTarget": agree, "keepsPlanFacts": facts}  # fmt: skip
    return out


def cmd_heldout(_args) -> int:
    """data/train/heldout.json: the held-out templates and the eval notes drawn from them."""
    rows = {s: [json.loads(x) for x in (ROOT / f"data/{s}.jsonl").read_text("utf-8").splitlines()]
            for s in ("test", "dev")}  # fmt: skip
    held = CONFIG["holdout"]
    if held != trainset.holdout(SCENARIOS, CONFIG["holdout_seed"]):
        raise SystemExit("config.yaml holdout differs from trainset.holdout(); fix the config")
    out = {"templates": held,
           **{s: sorted(trainset.held_out_ids(r, held)) for s, r in rows.items()}}  # fmt: skip
    write_json(OUT / "heldout.json", out)
    print({s: len(out[s]) for s in rows})
    return 0


def closeness(x: dict) -> float:
    """Most similar first, by each measure relative to its threshold."""
    t = trainset.LEAKAGE
    return -max(x["jaccard5"] / t["jaccard5"], x["containment8"] / t["containment8"])


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8", newline="\n")


HELP_LIMIT = "plans 1..N (default: config.yaml)"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, fn in (("write", cmd_write), ("filter", cmd_filter)):
        p = sub.add_parser(name)
        p.add_argument("--limit", type=int, default=CONFIG["limit"], help=HELP_LIMIT)
        p.set_defaults(fn=fn, follow=False)
    help_follow = "keep going (retrying) until every note is written"
    sub.choices["write"].add_argument("--follow", action="store_true", help=help_follow)
    sub.add_parser("heldout").set_defaults(fn=cmd_heldout)
    p = sub.add_parser("label")
    p.add_argument("labeler", choices=list(LABELERS))
    p.add_argument("--limit", type=int, default=CONFIG["limit"], help=HELP_LIMIT)
    p.add_argument(
        "--follow",
        action="store_true",
        help="keep going as the writer adds notes, until every note is labeled",
    )
    p.add_argument(
        "--shard",
        default="1/1",
        help="K/N: label only every Nth batch, from the Kth (parallel runs)",
    )
    p.set_defaults(fn=cmd_label)
    help_shard = "K/N: write only every Nth batch, from the Kth"
    sub.choices["write"].add_argument("--shard", default="1/1", help=help_shard)
    args = ap.parse_args()
    global USAGE_SUFFIX
    USAGE_SUFFIX = usage_suffix(args.cmd, getattr(args, "labeler", ""), getattr(args, "shard", ""))
    return args.fn(args)


def usage_suffix(cmd: str, labeler: str, shard: str) -> str:
    """Each process logs to its own usage file, so it's that file's only appender."""
    if cmd not in ("write", "label"):
        return ""
    k, of = (shard or "1/1").split("/")
    part = "" if (k, of) == ("1", "1") else f".{k}of{of}"
    return f".{cmd}{'-' + labeler if labeler else ''}{part}"


if __name__ == "__main__":
    raise SystemExit(main())
