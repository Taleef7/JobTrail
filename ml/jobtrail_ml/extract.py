"""Prompts for extraction runs (#72): one note in, one schema-v2 record out.

Three variants, the same for every model so runs compare:
- zero-shot: the labeling rules as a system prompt, then the note.
- few-shot: the same, plus worked examples as earlier chat turns.
- fine-tuned-short: the note alone, no instructions (how the fine-tuned models are
  trained, #74+).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

ML = Path(__file__).resolve().parents[1]
ROOT = ML.parent
FEWSHOT = ML / "prompts" / "fewshot.jsonl"
SCHEMAS = {
    "full": ROOT / "packages" / "core" / "schema" / "schema.v2.json",
    "compact": ROOT / "packages" / "core" / "schema" / "schema.v2.compact.json",
}
VARIANTS = ("zero-shot", "few-shot", "fine-tuned-short")
FORMATS = tuple(SCHEMAS)

EXTRACT_SYSTEM = """\
Extract a job record from a tradesperson's end-of-job note, as JSON with these fields:
- jobType: the trade of the main task: plumbing, electrical, hvac, carpentry, appliance, \
cleaning, painting, roofing, or general (handyman tasks); null only if the note gives no clue.
- workPerformed: one short past-tense action per task done, verb first ("Replaced kitchen \
sink P-trap"). A trip to the supply house is its own item ("Picked up <part> at the supply \
house"). Never list work that wasn't done.
- issuesFound: problems the note reports finding on site, as noun phrases. A problem found \
and fixed is an issue, and its fix is work performed. The job's own task is not also an issue.
- materials: things the note says were used or put in, with an amount or as supplies. Not \
tools, not things the note says weren't used, and not an item named only as the object of a \
task with no number. quantity: the number said, after any self-correction ("two, no three" \
is 3); null if no number. unit: the measure or package word said with the quantity, \
singular (length is always "feet"); null for plain counts.
- laborMinutes: total labor in minutes, as an integer; add separately stated times; null if \
no time is given.
- customerApproved: true only on an explicit yes (signed off, approved, gave the go-ahead); \
false only on an explicit no; otherwise null.
- followUps: future actions only.
Label only what the note says. Use null or [] when something isn't mentioned. Answer with \
the JSON object only."""

COMPACT_LEGEND = (
    " Use the short keys: t=jobType, w=workPerformed, i=issuesFound, m=materials (n=name, "
    "q=quantity, u=unit), l=laborMinutes, a=customerApproved, f=followUps."
)
_SHORT = {"jobType": "t", "workPerformed": "w", "issuesFound": "i", "materials": "m",
          "laborMinutes": "l", "customerApproved": "a", "followUps": "f"}  # fmt: skip
_SHORT_MATERIAL = {"name": "n", "quantity": "q", "unit": "u"}


def encode(record: dict[str, Any], fmt: str) -> str:
    """A record as the model should write it (the same encoding as core's codec.ts)."""
    if fmt == "full":
        return json.dumps(record, ensure_ascii=False)
    out = {_SHORT[k]: v for k, v in record.items() if k != "materials"}
    out["m"] = [{_SHORT_MATERIAL[k]: v for k, v in m.items()} for m in record["materials"]]
    return json.dumps({k: out[k] for k in _SHORT.values()}, ensure_ascii=False)


def fewshot_examples() -> list[dict[str, Any]]:
    return [json.loads(x) for x in FEWSHOT.read_text(encoding="utf-8").splitlines() if x]


def system_prompt(fmt: str) -> str:
    return EXTRACT_SYSTEM + (COMPACT_LEGEND if fmt == "compact" else "")


def messages(note: str, variant: str, fmt: str) -> list[dict[str, str]]:
    if variant not in VARIANTS:
        raise ValueError(f"unknown prompt variant {variant!r}; expected one of {VARIANTS}")
    if fmt not in FORMATS:
        raise ValueError(f"unknown format {fmt!r}; expected one of {FORMATS}")
    if variant == "fine-tuned-short":
        return [{"role": "user", "content": note}]
    msgs = [{"role": "system", "content": system_prompt(fmt)}]
    if variant == "few-shot":
        for ex in fewshot_examples():
            msgs += [{"role": "user", "content": ex["note"]},
                     {"role": "assistant", "content": encode(ex["gold"], fmt)}]  # fmt: skip
    msgs.append({"role": "user", "content": note})
    return msgs


def schema(fmt: str) -> dict[str, Any]:
    return json.loads(SCHEMAS[fmt].read_text(encoding="utf-8"))


def prompt_fingerprint(variant: str, fmt: str) -> str:
    """SHA-256 of everything but the note: changes whenever the prompt does."""
    return hashlib.sha256(json.dumps(messages("{note}", variant, fmt)).encode()).hexdigest()
