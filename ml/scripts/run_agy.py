"""#73: the cloud ceiling through the Antigravity CLI (Gemini on the owner's Pro plan).

Usage (from ml/):
  uv run python scripts/run_agy.py --config configs/<run>.yaml [--gold PATH] [--limit N]
                                   [--out-dir DIR] [--no-score]

No API key is used. agy runs a model inside its own agent harness, so this measures what
the model extracts, not API latency or price: no per-note timings are recorded, and the
token counts agy reports include its harness prompt. Notes go batch_size per call
(structured output, one record per id). Resumable like the other runners: an unfinished
batch is resent whole, with the same notes, and only its missing notes are saved.
"""

import argparse
import json
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from jobtrail_ml import agy, extract  # noqa: E402
from jobtrail_ml.runs import RESULTS, ROOT, Run, host, load_config  # noqa: E402


def batch_prompt(cfg: dict, chunk: list[dict]) -> str:
    return extract.agy_batch_prompt(cfg["format"], extract.prompt_version(cfg["prompt"]), chunk)


def agy_usage(u: dict) -> dict[str, int]:
    return {"promptTokens": u.get("input_tokens", 0), "outputTokens": u.get("output_tokens", 0),
            "thoughtsTokens": u.get("thinking_tokens", 0)}  # fmt: skip


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", type=Path, required=True)
    ap.add_argument("--gold", help="override the config's gold file")
    ap.add_argument("--limit", type=int, help="only the first N notes (a separate run)")
    ap.add_argument("--out-dir", type=Path, default=RESULTS)
    ap.add_argument("--no-score", action="store_true")
    args = ap.parse_args()

    over = {}
    if args.gold:
        over["gold"] = Path(args.gold).resolve().relative_to(ROOT).as_posix()
    if args.limit:
        over["limit"] = args.limit
    cfg = load_config(args.config, over)
    if cfg["provider"] != "agy":
        sys.exit(f"{args.config} is a {cfg['provider']} config, not agy")
    run = Run(cfg, args.out_dir)
    todo = run.todo()
    print(f"{run.id}: {len(run.gold) - len(todo)}/{len(run.gold)} done, {len(todo)} to go")
    status = generate(run, cfg) if todo else "incomplete"
    report = run.finish(status, score_it=not args.no_score)
    if report:
        print(f"scored -> {run.dir / 'report.json'}: zero-edit {report['overall']['zeroEditRate']}")
    print(run.dir)
    return 0 if run.complete else 1


def generate(run: Run, cfg: dict) -> str:
    model, n = cfg["model"]["id"], cfg["cloud"]["batch_size"]
    started = agy.version()
    run.open({"runtime": f"agy {started} {model}", "host": host(),
              "note": "agent harness, owner's plan: no API key, latency or price"})  # fmt: skip
    record = {k: v for k, v in extract.schema(cfg["format"]).items() if k != "$schema"}
    schema = extract.batch_schema(record)
    batches = run.pending_batches(n)
    for k, chunk in enumerate(batches, 1):
        if (now := agy.version()) != started:
            print(f"agy updated itself from {started} to {now}: start a new run (delete the "
                  "folder) rather than mix versions in one report")  # fmt: skip
            return "version-changed"
        for attempt in (1, 2):
            try:
                out, usage = agy.run(model, batch_prompt(cfg, chunk), schema)
                break
            except agy.AgyError as e:
                print(f"  batch at {chunk[0]['id']} attempt {attempt}: {e}", flush=True)
        else:
            return "incomplete"  # rerun to resume
        text = json.dumps(out, ensure_ascii=False)
        u = agy_usage(usage)
        run.append_many([
            {"id": note_id, "raw": raw, "format": cfg["format"], "model": f"{model} (agy)",
             "batch": {"first": chunk[0]["id"], "size": len(chunk)},
             "usage": u if j == 0 else {x: 0 for x in u}, "finishReason": finish}
            for j, (note_id, raw, finish) in enumerate(
                extract.split_batch([g["id"] for g in chunk], text, "STOP"))
        ])  # fmt: skip
        print(f"  batch {k}/{len(batches)}", flush=True)
    return "incomplete"


if __name__ == "__main__":
    raise SystemExit(main())
