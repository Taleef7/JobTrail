"""#67 evidence: prove the generated JSON Schemas work as llama.cpp grammars, and
measure how many tokens the compact encoding saves with the real tokenizer.

Usage (from ml/):  uv run python scripts/check_constrained.py models/<file>.gguf
Needs llama.cpp's `llama-completion` and `llama-tokenize` on PATH.
Writes evidence/67/llamacpp-constrained.json and evidence/67/token-counts.json.
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
CORE = ROOT / "packages" / "core"
OUT = ROOT / "evidence" / "67"

SCHEMAS = {
    "full": CORE / "schema" / "schema.v2.json",
    "compact": CORE / "schema" / "schema.v2.compact.json",
}
SYSTEM = {
    "full": "Extract a job record as JSON. Do not invent details; use null or [] when "
    "something isn't mentioned. laborMinutes is total labor in minutes.",
    "compact": "Extract a job record as compact JSON: t=jobType, w=workPerformed, "
    "i=issuesFound, m=materials (n=name, q=quantity, u=unit), l=laborMinutes, "
    "a=customerApproved, f=followUps. Do not invent details; use null or [].",
}
NOTES = [
    "Swapped out the P-trap under the kitchen sink, used one PVC trap kit and some "
    "plumber's tape. Took about an hour and a half. Customer signed off. Come back next "
    "week to check for leaks.",
    "Replaced the thermostat on the upstairs furnace, used two, no three, wire nuts. Had to "
    "run to the supply house for the thermostat. Two hours total. Customer didn't sign, "
    "wasn't home.",
    "Cleaned out the dryer vent and replaced 8 feet of foil duct with rigid duct. 45 minutes.",
]
COMPACT_KEYS = {
    "jobType": "t",
    "workPerformed": "w",
    "issuesFound": "i",
    "materials": "m",
    "laborMinutes": "l",
    "customerApproved": "a",
    "followUps": "f",
}
MATERIAL_KEYS = {"name": "n", "quantity": "q", "unit": "u"}


def tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        sys.exit(f"{name} not found on PATH (install llama.cpp)")
    return path


def extract_json(text: str) -> str | None:
    text = re.sub(r"\x1b\[[0-9;]*m", "", text)
    start, end = text.find("{"), text.rfind("}")
    return text[start : end + 1] if start != -1 and end > start else None


def constrained_runs(model: Path) -> list[dict]:
    runs = []
    for fmt, schema_path in SCHEMAS.items():
        validator = Draft202012Validator(json.loads(schema_path.read_text(encoding="utf-8")))
        for i, note in enumerate(NOTES):
            proc = subprocess.run(
                [tool("llama-completion"), "-m", str(model), "-jf", str(schema_path),
                 "-sys", SYSTEM[fmt], "-p", note, "-st", "--temp", "0", "-n", "320",
                 "--no-display-prompt"],
                stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8",
                check=False,
            )  # fmt: skip
            # Note: --log-disable also suppresses the generated text when stdout is piped
            # (llama.cpp b9837 on Windows), so logs are left on and go to stderr.
            raw = extract_json(proc.stdout)
            parsed = json.loads(raw) if raw else None
            errors = [e.message for e in validator.iter_errors(parsed)] if raw else ["no JSON"]
            runs.append({"format": fmt, "note": i, "exitCode": proc.returncode,
                         "schemaValid": not errors, "errors": errors, "output": raw})  # fmt: skip
            print(f"{fmt} note {i}: {errors if errors else 'valid'}")
    return runs


def to_compact(record: dict) -> dict:
    out = {COMPACT_KEYS[k]: v for k, v in record.items() if k != "materials"}
    out["m"] = [{MATERIAL_KEYS[k]: v for k, v in m.items()} for m in record["materials"]]
    return out


def token_count(model: Path, text: str) -> int:
    proc = subprocess.run(
        [tool("llama-tokenize"), "-m", str(model), "--stdin", "--show-count"],
        input=text, capture_output=True, text=True, encoding="utf-8", check=True,
    )  # fmt: skip
    match = re.search(r"Total number of tokens:\s*(\d+)", proc.stdout + proc.stderr)
    if not match:
        sys.exit(f"could not read token count from llama-tokenize output: {proc.stdout[-200:]}")
    return int(match.group(1))


def token_counts(model: Path) -> list[dict]:
    rows = []
    for path in sorted((CORE / "fixtures" / "schema" / "valid").glob("*.json")):
        record = json.loads(path.read_text(encoding="utf-8"))
        full = json.dumps(record, separators=(",", ":"))
        compact = json.dumps(to_compact(record), separators=(",", ":"))
        f, c = token_count(model, full), token_count(model, compact)
        rows.append({"fixture": path.stem, "fullTokens": f, "compactTokens": c,
                     "saved": f - c, "savedPct": round(100 * (f - c) / f, 1)})  # fmt: skip
        print(f"{path.stem}: full {f} -> compact {c} tokens")
    return rows


def main() -> None:
    model = Path(sys.argv[1]).resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"model": model.name, "llamaCpp": subprocess.run(
        [tool("llama-completion"), "--version"], capture_output=True, text=True, check=False
    ).stderr.strip().splitlines()[0]}  # fmt: skip
    runs = constrained_runs(model)
    (OUT / "llamacpp-constrained.json").write_text(
        json.dumps({**meta, "runs": runs}, indent=2) + "\n", encoding="utf-8"
    )
    counts = token_counts(model)
    total_full = sum(r["fullTokens"] for r in counts)
    total_compact = sum(r["compactTokens"] for r in counts)
    summary = {"totalFull": total_full, "totalCompact": total_compact,
               "savedPct": round(100 * (total_full - total_compact) / total_full, 1)}  # fmt: skip
    (OUT / "token-counts.json").write_text(
        json.dumps({**meta, "summary": summary, "fixtures": counts}, indent=2) + "\n",
        encoding="utf-8",
    )
    valid = sum(r["schemaValid"] for r in runs)
    print(f"constrained runs schema-valid: {valid}/{len(runs)}; compact saves {summary}")


if __name__ == "__main__":
    main()
