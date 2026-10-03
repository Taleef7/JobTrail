"""#73: one summary of every ladder run, plus the markdown tables for docs/RESULTS.md.

Usage (from ml/):
  uv run python scripts/summarize_results.py            # writes results/summary.json
  uv run python scripts/summarize_results.py --markdown # also prints the tables

Reads results/runs/<run>/report.json (rebuilt from predictions by score_run.py if missing)
and the rules baseline in results/runs/rules-legacy-v0/. The Gemini ceiling is also scored
on the drafts where Claude's vote alone matches the final key (#71): Gemini 3.8 Flash
reviewed the gold it is graded against, so this subset checks for that bias.
"""

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from jobtrail_ml.runs import ROOT, read_jsonl, score_run  # noqa: E402
from jobtrail_ml.scorer import score  # noqa: E402

RUNS = ROOT / "results" / "runs"
RULES = RUNS / "rules-legacy-v0"
DECISIONS = ROOT / "data" / "review" / "adjudication" / "decisions.jsonl"
FIELDS = ("zeroEditRate", "schemaValidRate", "jobTypeAccuracy", "laborMinutesAccuracy",
          "customerApprovedAccuracy", "hallucinationRate")  # fmt: skip
LISTS = ("materials", "workPerformed", "issuesFound", "followUps")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def metrics(o: dict) -> dict:
    out = {k: o[k] for k in FIELDS}
    out.update({f"{k}F1": o[k]["f1"] for k in LISTS})
    out["materialsQuantityAccuracy"] = o["materials"]["quantityAccuracy"]
    out["p50WallMs"] = o["latency"]["p50WallMs"] if o["latency"] else None
    return out


def claude_matches_final() -> set[str]:
    return {x["id"] for x in read_jsonl(DECISIONS)
            if x.get("votes", {}).get("claude", {}).get("agreesWithKey")}  # fmt: skip


def subset_report(run_dir: Path, gold: Path, ids: set[str]) -> dict:
    """The core scorer on a subset of the gold (and the matching predictions)."""
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        rows = [g for g in read_jsonl(gold) if g["id"] in ids]
        (t / "gold.jsonl").write_text("".join(json.dumps(g) + "\n" for g in rows), "utf-8")
        preds = [p for p in read_jsonl(run_dir / "predictions.jsonl") if p["id"] in ids]
        (t / "pred.jsonl").write_text("".join(json.dumps(p) + "\n" for p in preds), "utf-8")
        return score(t / "gold.jsonl", t / "pred.jsonl", t / "report.json", run_dir.name)


def runs() -> list[dict]:
    rows = []
    for split in ("test", "dev"):
        rep = RULES / f"{split}.report.json"
        if rep.exists():
            r = json.loads(rep.read_text(encoding="utf-8"))
            rows.append({
                "run": f"rules-legacy-v0-{split}", "split": split, "rung": "rules",
                "model": "rules-legacy-v0", "prompt": "-", "grammar": None,
                "n": r["overall"]["n"], "usdPerNote": 0.0, "reportSha256": sha256(rep),
                "metrics": metrics(r["overall"]),
                "byTag": {t: metrics(m) for t, m in r["byTag"].items()},
            })  # fmt: skip
    for d in sorted(RUNS.iterdir()):
        if d == RULES or not (d / "config.json").exists():
            continue
        cfg = json.loads((d / "config.json").read_text(encoding="utf-8"))
        meta = json.loads((d / "run.json").read_text(encoding="utf-8"))
        if meta["status"] != "complete":
            print(f"skipping {d.name}: {meta['status']}")
            continue
        if not (d / "report.json").exists():
            score_run(d)
        r = json.loads((d / "report.json").read_text(encoding="utf-8"))
        split = Path(cfg["gold"]).stem
        cost = meta.get("cost") or []
        row = {
            "run": d.name, "split": split,
            "rung": "local" if cfg["provider"] == "llamacpp" else "cloud",
            "via": {"llamacpp": "llama.cpp", "gemini": "Gemini API", "agy": "Antigravity CLI"}[
                cfg["provider"]],
            "model": cfg["model"].get("id") or Path(cfg["model"]["file"]).stem,
            "prompt": cfg["prompt"], "grammar": cfg["grammar"], "n": r["overall"]["n"],
            "batch": (cfg.get("cloud") or {}).get("batch_size", 1),
            "sizeMB": model_mb(cfg),
            # agy runs on a subscription: no price of its own (RESULTS uses the API estimate)
            "usdPerNote": cost[0]["usdPerNote"] if cost else (
                None if cfg["provider"] == "agy" else 0.0),
            "usdPerNote2027": cost[1]["usdPerNote"] if len(cost) > 1 else None,
            "loops": sum(p.get("finishReason") == "length"
                         for p in read_jsonl(d / "predictions.jsonl")),
            "reportSha256": sha256(d / "report.json"),
            "metrics": metrics(r["overall"]),
            "byTag": {t: metrics(m) for t, m in r["byTag"].items()},
        }  # fmt: skip
        if row["rung"] == "cloud":
            ids = claude_matches_final()
            sub = subset_report(d, ROOT / cfg["gold"], ids)
            row["claudeAgreedSubset"] = {
                "n": sub["overall"]["n"],
                "metrics": metrics(sub["overall"]),
            }
        rows.append(row)
    return rows


def model_mb(cfg: dict) -> int | None:
    if cfg["provider"] != "llamacpp":
        return None
    path = ROOT / cfg["model"]["file"]
    return round(path.stat().st_size / 1e6) if path.exists() else None


def usd(v) -> str:
    return "–" if v is None else f"${v:.4f}"


def pct(v) -> str:
    return "–" if v is None else f"{100 * v:.1f}%"


def markdown(rows: list[dict], split: str) -> str:
    head = (
        "| Rung | Model | MB | Prompt | Grammar | n | Zero-edit | Schema-valid | jobType "
        "| laborMinutes | Approved | Materials F1 | Work F1 | Issues F1 | Follow-ups F1 "
        "| Hallucination | p50 | $/note |"
    )
    lines = [head, "| --- | --- | ---: | --- | --- |" + " ---: |" * 13]
    order = {"rules": 0, "local": 1, "cloud": 2}
    ranked = sorted(rows, key=lambda r: (order[r["rung"]], r.get("sizeMB") or 0, r["model"],
                                         r["prompt"], str(r["grammar"])))  # fmt: skip
    for r in ranked:
        if r["split"] != split:
            continue
        m = r["metrics"]
        p50 = (
            "–"
            if r["rung"] == "cloud" and r.get("batch", 1) > 1
            else (f"{m['p50WallMs'] / 1000:.2f} s" if m["p50WallMs"] is not None else "–")
        )
        grammar = {True: "on", False: "off", None: "–"}[r["grammar"]]
        lines.append(
            f"| {r['rung']} | {r['model']} | {r.get('sizeMB') or '–'} | {r['prompt']} | "
            f"{grammar} | {r['n']} | "
            f"{pct(m['zeroEditRate'])} | {pct(m['schemaValidRate'])} | "
            f"{pct(m['jobTypeAccuracy'])} | "
            f"{pct(m['laborMinutesAccuracy'])} | {pct(m['customerApprovedAccuracy'])} | "
            f"{m['materialsF1']:.3f} | {m['workPerformedF1']:.3f} | {m['issuesFoundF1']:.3f} | "
            f"{m['followUpsF1']:.3f} | {pct(m['hallucinationRate'])} | {p50} | "
            f"{usd(r['usdPerNote'])} |")  # fmt: skip
    return "\n".join(lines)


TAGS = ("hours-phrasing", "negation", "self-correction", "multiple-materials", "no-materials",
        "supply-house-trip", "extra-labor", "approval-absent")  # fmt: skip


def tag_table(rows: list[dict], picks: list[str]) -> str:
    """Zero-edit per hard-case tag for chosen test runs (run-name prefixes)."""
    chosen = [next(r for r in rows if r["split"] == "test" and r["run"].startswith(p))
              for p in picks]  # fmt: skip
    names = [r["run"].rsplit("-test-", 1)[0] for r in chosen]
    lines = ["| Tag | " + " | ".join(names) + " |", "| --- |" + " ---: |" * len(chosen)]
    for t in TAGS:
        cells = [pct(r["byTag"].get(t, {}).get("zeroEditRate")) for r in chosen]
        lines.append(f"| {t} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--markdown", action="store_true")
    ap.add_argument("--tags", nargs="*", help="run-name prefixes for a per-tag test table")
    args = ap.parse_args()
    rows = runs()
    out = ROOT / "results" / "summary.json"
    # One run per line: diffable, and a fraction of the size of an indented dump.
    body = ",\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
    out.write_text('{"runs": [\n' + body + "\n]}\n", encoding="utf-8", newline="\n")
    print(f"{len(rows)} runs -> {out}")
    if args.markdown:
        for split in ("test", "dev"):
            print(f"\n### {split}\n\n{markdown(rows, split)}")
    if args.tags:
        print(f"\n### per tag (test, zero-edit)\n\n{tag_table(rows, args.tags)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
