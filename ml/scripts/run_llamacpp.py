"""#72: run a GGUF model over a gold file with llama.cpp, then score it.

Usage (from ml/):
  uv run python scripts/run_llamacpp.py --config configs/<run>.yaml [--gold PATH] [--limit N]
                                        [--out-dir DIR] [--no-score]

Reproduce any run from its folder: --config ../results/runs/<id>/config.json.
--gold and --limit override the config and so give a different run ID.
Needs llama.cpp's llama-server on PATH; downloads the model (sha256-checked) if missing.
"""

import argparse
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from jobtrail_ml import extract  # noqa: E402
from jobtrail_ml.llamacpp import LlamaClient, LlamaServer, ensure_model  # noqa: E402
from jobtrail_ml.runs import RESULTS, ROOT, Run, host, load_config  # noqa: E402


def overrides(args) -> dict:
    out = {}
    if args.gold:
        out["gold"] = Path(args.gold).resolve().relative_to(ROOT).as_posix()
    if args.limit:
        out["limit"] = args.limit
    return out


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", type=Path, required=True)
    ap.add_argument("--gold", help="override the config's gold file")
    ap.add_argument("--limit", type=int, help="only the first N notes (a separate run)")
    ap.add_argument("--out-dir", type=Path, default=RESULTS)
    ap.add_argument("--no-score", action="store_true")
    args = ap.parse_args()

    cfg = load_config(args.config, overrides(args))
    if cfg["provider"] != "llamacpp":
        sys.exit(f"{args.config} is a {cfg['provider']} config; use run_cloud.py")
    run = Run(cfg, args.out_dir)
    todo = run.todo()
    print(f"{run.id}: {len(run.gold) - len(todo)}/{len(run.gold)} done, {len(todo)} to go")
    if todo:  # a finished run is only (re)scored: no model, no server
        generate(run, cfg, todo)
    report = run.finish("incomplete", score_it=not args.no_score)
    if report:
        print(f"scored -> {run.dir / 'report.json'}: zero-edit {report['overall']['zeroEditRate']}")
    print(run.dir)
    return 0


def generate(run: Run, cfg: dict, todo: list[dict]) -> None:
    model = ensure_model(ROOT / cfg["model"]["file"], cfg["model"].get("url"),
                         cfg["model"]["sha256"])  # fmt: skip
    schema = extract.schema(cfg["format"]) if cfg["grammar"] else None
    s, kwargs = cfg["sampling"], cfg["server"]["chat_template_kwargs"]
    run.dir.mkdir(parents=True, exist_ok=True)
    with LlamaServer(model, cfg["server"], s["seed"], run.dir / "server.log") as server:
        server.check_build(cfg["server"]["build"])
        run.open({"runtime": f"llama.cpp {server.build}", "threads": cfg["server"]["threads"],
                  "host": host(),
                  "chatTemplateCaps": server.props.get("chat_template_caps")})  # fmt: skip
        client = LlamaClient(server.url)
        # Warm-up, not recorded: the first request after a load is cold.
        client.chat(extract.messages(todo[0]["note"], cfg["prompt"], cfg["format"]),
                    schema=schema, sampling=s, chat_template_kwargs=kwargs)  # fmt: skip
        for i, g in enumerate(todo, 1):
            c = client.chat(extract.messages(g["note"], cfg["prompt"], cfg["format"]),
                            schema=schema, sampling=s, chat_template_kwargs=kwargs)  # fmt: skip
            run.append({"id": g["id"], "raw": c.text, "format": cfg["format"],
                        "model": Path(cfg["model"]["file"]).stem, "timings": c.timings,
                        "usage": c.usage, "finishReason": c.finish_reason})  # fmt: skip
            if i % 10 == 0 or i == len(todo):
                print(f"  {i}/{len(todo)}  last {c.timings['wallMs']:.0f} ms", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
