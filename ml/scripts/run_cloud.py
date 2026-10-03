"""#72: the cloud ceiling. Run a Gemini model over a gold file, log tokens and $/note.

Usage (from ml/):
  uv run python scripts/run_cloud.py --config configs/<run>.yaml [--gold PATH] [--limit N]
                                     [--out-dir DIR] [--no-score]

The API key is read from the environment variable the config names (cloud.key_env,
default GEMINI_API_KEY), or from ml/.env. It is never written anywhere.
Throttled to cloud.rpm; on the free tier's daily quota it stops cleanly and the same
command resumes the next day. Cost is computed at the published paid-tier prices in
the config even when the run itself was free.
"""

import argparse
import os
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from jobtrail_ml import extract  # noqa: E402
from jobtrail_ml.gemini import GeminiClient, QuotaExhausted  # noqa: E402
from jobtrail_ml.runs import (  # noqa: E402
    RESULTS,
    ROOT,
    Run,
    cost,
    cost_line,
    gemini_usage,
    host,
    load_config,
    new_model_version,
    read_jsonl,
    usage_totals,
)


def api_key(name: str) -> str:
    value = os.environ.get(name, "").strip()  # a stray CR/space would end up in an error
    if value:
        return value
    env = ML / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition("=")
            if key.strip() == name and value.strip():
                return value.strip().strip('"').strip("'")
    sys.exit(f"set {name} (in the environment or ml/.env)")


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
    if cfg["provider"] != "gemini":
        sys.exit(f"{args.config} is a {cfg['provider']} config; use run_llamacpp.py")
    run = Run(cfg, args.out_dir)
    todo = run.todo()
    print(f"{run.id}: {len(run.gold) - len(todo)}/{len(run.gold)} done, {len(todo)} to go")
    c = cfg["cloud"]
    status = "incomplete"
    if todo:  # a finished run is only (re)scored: no key, no requests
        status = generate(run, cfg, todo)
    preds = read_jsonl(run.pred_path)
    priced = cost(usage_totals(preds), c["pricing"], len(preds))
    report = run.finish(status, {"cost": priced}, score_it=not args.no_score)
    for p in priced:
        print(cost_line(p))
    if report:
        print(f"scored -> {run.dir / 'report.json'}: zero-edit {report['overall']['zeroEditRate']}")
    print(run.dir)
    return {"quota": 3, "version-changed": 4}.get(status, 0)


def generate(run: Run, cfg: dict, todo: list[dict]) -> str:
    """Predict every note still to do; returns "quota" if the daily quota ran out."""
    c, s, model = cfg["cloud"], cfg["sampling"], cfg["model"]["id"]
    client = GeminiClient(api_key(c["key_env"]), rpm=c["rpm"])
    run.open({"runtime": f"gemini-api {model}", "host": host(),
              "note": "cloud runs are seeded but not bit-reproducible"})  # fmt: skip
    schema = extract.schema(cfg["format"]) if cfg["grammar"] else None
    if schema:
        schema = {k: v for k, v in schema.items() if k != "$schema"}
    seen = {p["modelVersion"] for p in read_jsonl(run.pred_path) if p.get("modelVersion")}
    try:
        for i, g in enumerate(todo, 1):
            msgs = extract.messages(g["note"], cfg["prompt"], cfg["format"])
            system = "\n\n".join(m["content"] for m in msgs if m["role"] == "system")
            r = client.generate(model, system, msgs[-1]["content"],
                                temperature=s["temperature"], seed=s["seed"],
                                json_schema=schema, thinking_level=c["thinking_level"],
                                max_output_tokens=s["max_tokens"],
                                allow_unfinished=True)  # fmt: skip
            if new_model_version(seen, r.model_version):
                print(
                    f"{model} now answers as {r.model_version}, not {sorted(seen)}: start a "
                    "new run (delete the folder) rather than mix versions in one report"
                )
                return "version-changed"
            seen.add(r.model_version)
            run.append({"id": g["id"], "raw": r.text, "format": cfg["format"], "model": model,
                        "modelVersion": r.model_version,
                        "timings": {"wallMs": round(r.wall_ms or 0, 3)},
                        "usage": gemini_usage(r.usage),
                        "finishReason": r.finish_reason})  # fmt: skip
            print(f"  {i}/{len(todo)} {g['id']} {r.finish_reason}", flush=True)
    except QuotaExhausted as e:
        print(f"daily quota reached ({e}); rerun the same command tomorrow to resume")
        return "quota"
    return "incomplete"


if __name__ == "__main__":
    raise SystemExit(main())
