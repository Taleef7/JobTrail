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
VARIANTS = ("zero-shot", "few-shot", "fine-tuned-short", "zero-shot-v2", "few-shot-v2")
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

# v2 (#73 error analysis): states the rules the v1 prompt left out or that #71 clarified
# (supply-house parts are materials, package words as units, issues need a finding, silence
# on approval is null), lists the trades, and uses <placeholders> instead of concrete
# examples, which the smallest models copied into their answers.
EXTRACT_SYSTEM_V2 = """\
Extract a job record from a tradesperson's end-of-job note, as JSON with these fields:
- jobType: the trade of the job's main task. plumbing: pipes, drains, fixtures, toilets, \
water heaters, supply lines. electrical: wiring, breakers, panels, outlets, switches, light \
fixtures. hvac: heating, cooling, thermostats, refrigerant, ducts, furnace filters, condensate \
lines. carpentry: doors and jambs, decks, trim, built-in shelving. appliance: repairing \
dryers, dishwashers, refrigerators and their parts. cleaning: cleaning as the job itself. \
painting: painting and staining, with their prep. roofing: roofs and gutters. general: \
handyman tasks such as mounting TVs, assembling furniture, drywall patches, door stops. null \
only if the note gives no clue.
- workPerformed: one short past-tense action per task done, verb first ("<Verb>ed <object>"). \
A fix of a problem found is its own task. A trip to the supply house is its own item \
("Picked up <part> at the supply house"). Never list work that wasn't done.
- issuesFound: problems the note says were found or noticed on site, as noun phrases. A \
problem found and fixed is an issue, and its fix is work performed. The job's own task, and \
words describing the thing being repaired, are not issues.
- materials: things the note says were used or put in, and parts picked up at the supply \
house for this job. Not tools, not things the note says weren't used or needed, and not an \
item named only as the object of a task with no number. quantity: the number said, after any \
self-correction ("<a>, no <b>" means <b>); null for "some", "a few" or no number. unit: the \
measure or package word the amount is counted in, singular: feet (always "feet" for length), \
gallon, quart, pound, roll, tube, box, pack, bundle, bottle, tub, kit. When the item itself is \
a kit ("1 <thing> kit"), the unit is "kit". null for plain counts of items.
- laborMinutes: total labor in minutes, as an integer: convert hours, add separately stated \
times; drive time doesn't count unless the note counts it; null if no time is given.
- customerApproved: true only on an explicit yes (signed off, approved, gave the go-ahead); \
false only on an explicit no (declined, didn't sign); null when the note doesn't say.
- followUps: future actions the note states. Never past actions, never invented ones.
Label only what this note says. Use null or [] when something isn't mentioned. Answer with \
the JSON object only."""

FEWSHOT_V2_NOTE = (
    " The example jobs before the note are unrelated to it: take nothing from them but the format."
)

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


def system_prompt(fmt: str, version: int = 1) -> str:
    base = EXTRACT_SYSTEM if version == 1 else EXTRACT_SYSTEM_V2
    return base + (COMPACT_LEGEND if fmt == "compact" else "")


def prompt_version(variant: str) -> int:
    return 2 if variant.endswith("-v2") else 1


def messages(note: str, variant: str, fmt: str) -> list[dict[str, str]]:
    if variant not in VARIANTS:
        raise ValueError(f"unknown prompt variant {variant!r}; expected one of {VARIANTS}")
    if fmt not in FORMATS:
        raise ValueError(f"unknown format {fmt!r}; expected one of {FORMATS}")
    if variant == "fine-tuned-short":
        return [{"role": "user", "content": note}]
    system = system_prompt(fmt, prompt_version(variant))
    if variant == "few-shot-v2":
        system += FEWSHOT_V2_NOTE
    msgs = [{"role": "system", "content": system}]
    if variant in ("few-shot", "few-shot-v2"):
        for ex in fewshot_examples():
            msgs += [{"role": "user", "content": ex["note"]},
                     {"role": "assistant", "content": encode(ex["gold"], fmt)}]  # fmt: skip
    msgs.append({"role": "user", "content": note})
    return msgs


BATCH_NOTE = (
    " The input is a JSON list of unrelated notes, each with an id. Extract each note on its "
    "own, as if it were the only one, and return one record per id, in the same order."
)


def batch_input(items: list[dict[str, str]]) -> str:
    """Several notes in one request (cloud runs on a free tier's daily request limit)."""
    return json.dumps([{"id": x["id"], "note": x["note"]} for x in items], ensure_ascii=False)


def batch_schema(record: dict[str, Any]) -> dict[str, Any]:
    item = {"type": "object", "properties": {"id": {"type": "string"}, "record": record},
            "required": ["id", "record"]}  # fmt: skip
    return {"type": "object", "properties": {"records": {"type": "array", "items": item}},
            "required": ["records"]}  # fmt: skip


AGY_TOOLS = "\n\nDo not use any tools. Answer with JSON only, matching the response schema."
_PLACEHOLDER = [{"id": "{id}", "note": "{note}"}]


def agy_batch_prompt(fmt: str, version: int, items: list[dict[str, str]]) -> str:
    """The whole prompt run_agy sends: the rules, the batch note, a no-tools line, the notes."""
    rules = system_prompt(fmt, version) + BATCH_NOTE + AGY_TOOLS
    return f"{rules}\n\n# Notes\n\n{batch_input(items)}\n"


def batch_shape_sha() -> str:
    """Fingerprint of the batched request around the rules: the notes envelope, the
    response-schema envelope and the batch note. Part of a batched run's ID."""
    shape = {"input": batch_input(_PLACEHOLDER), "schema": batch_schema({"$ref": "record"}),
             "note": BATCH_NOTE}  # fmt: skip
    return hashlib.sha256(json.dumps(shape, sort_keys=True).encode()).hexdigest()


def agy_prompt_sha(fmt: str, version: int) -> str:
    return hashlib.sha256(agy_batch_prompt(fmt, version, _PLACEHOLDER).encode()).hexdigest()


def split_batch(ids: list[str], text: str, finish: str | None) -> list[tuple[str, str, str]]:
    """(id, raw record JSON, finish reason) per note of a batched answer. A note the answer
    leaves out, or an answer that isn't JSON, scores as that note's failure."""
    try:
        records = json.loads(text)["records"]
        got: dict[str, str] = {}
        for r in records:
            if isinstance(r, dict) and isinstance(r.get("id"), str) and r["id"] not in got:
                got[r["id"]] = json.dumps(r.get("record"), ensure_ascii=False)
    except (ValueError, KeyError, TypeError):
        return [(i, "", "UNPARSEABLE_BATCH") for i in ids]
    return [(i, got[i], finish or "") if i in got else (i, "", "MISSING_IN_BATCH") for i in ids]


def schema(fmt: str) -> dict[str, Any]:
    return json.loads(SCHEMAS[fmt].read_text(encoding="utf-8"))


def prompt_fingerprint(variant: str, fmt: str) -> str:
    """SHA-256 of everything but the note: changes whenever the prompt does."""
    return hashlib.sha256(json.dumps(messages("{note}", variant, fmt)).encode()).hexdigest()
