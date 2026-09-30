"""Prompts for eval drafts (#70): the writer turns a plan into a note; the blind
cross-checker (a different model) extracts the note back into schema v2."""

from __future__ import annotations

import json
from typing import Any

WRITER_SYSTEM = (
    "You write realistic end-of-job notes that tradespeople dictate or type into their "
    "phone. Follow the facts exactly: never add a material, task, quantity, time or "
    "customer decision that isn't listed. Output only the note — no title, no quotes, "
    "no bullet points."
)

CHECKER_SYSTEM = (
    "Extract a job record from a tradesperson's end-of-job note. Label only what the note "
    "says. jobType is the trade of the main task: plumbing (pipes, drains, fixtures, water "
    "heaters), electrical (wiring, breakers, outlets, switches, light fixtures), hvac "
    "(heating, cooling, thermostats, refrigerant, filters, condensate), carpentry (doors, "
    "decks, trim, built-in shelving), appliance (dryers, dishwashers, refrigerators and their "
    "vents/parts), cleaning (cleaning as the job itself), painting (painting and staining with "
    "its prep), roofing (roofs and gutters), general (handyman tasks such as mounting TVs, "
    "assembling furniture, drywall patches, door stops). "
    "workPerformed: one short past-tense action per task done, verb first; a trip to the "
    "supply house is its own item ('Picked up <part> at the supply house'). "
    "issuesFound: problems found on site. materials: things used on the job, not tools; "
    "skip materials the note says were not used; quantity is the number said after any "
    "self-correction, null if no number; unit is the measure or package word said with "
    "the quantity (singular), null for plain counts. laborMinutes: total labor in "
    "minutes: add separately stated times together; null if no time given. "
    "customerApproved: true only on an explicit yes (approved, signed off, gave the "
    "go-ahead), not merely happy or satisfied; false only on an explicit no; otherwise null. "
    "followUps: future actions only. Use null or [] when something isn't mentioned."
)


def material_phrase(m: dict[str, Any]) -> str:
    if m["quantity"] is None:
        return f"some {m['name']} (no amount said)"
    if m["unit"]:
        return f"{m['quantity']} {m['unit']} of {m['name']}"
    return f"{m['quantity']} {m['name']}"


def _hours(minutes: int) -> str:
    h = minutes / 60
    return f"{h:g} hours" if h != 1 else "1 hour"


def writer_prompt(plan: dict[str, Any], styles: dict[str, str]) -> str:
    r, m = plan["record"], plan["meta"]
    lines = [
        f"Trade: {plan['trade']}.",
        f"Style: {styles[plan['style']]}",
        "",
        "The note must state exactly these facts, and no other materials, tasks, "
        "quantities or times:",
    ]
    extra_task = m["labor"].get("extra_task")
    supply_item = f"Picked up {m['supply']} at the supply house" if m["supply"] else None
    work = [w for w in r["workPerformed"] if w not in (extra_task, supply_item)]
    lines.append(f"- Work done: {'; '.join(work)}.")
    if r["issuesFound"]:
        lines.append(f"- Problem found: {'; '.join(r['issuesFound'])}.")
    if r["materials"]:
        lines.append(f"- Materials used: {'; '.join(material_phrase(x) for x in r['materials'])}.")
    else:
        negated = m["negation"] and m["negation"]["kind"] == "material"
        lines.append(
            "- No materials were used; the only material you mention is the one you didn't "
            "need (below)."
            if negated
            else "- No materials were used; don't mention any."
        )

    phrasing = m["labor"]["phrasing"]
    if phrasing == "none":
        lines.append("- Time: don't mention how long anything took.")
    elif phrasing == "hours":
        lines.append(
            f"- Time: the job took {_hours(r['laborMinutes'])}. Say it in hours or fractions "
            "of an hour, the way people talk (e.g. 'an hour and a half'), never in minutes."
        )
    elif phrasing == "base+extra":
        lines.append(
            f"- Time: the main work took {m['labor']['base']} minutes. You also did this: "
            f"{extra_task}, which took another {m['labor']['extra']} minutes. State the two "
            "times separately, never the total."
        )
    else:
        lines.append(f"- Time: the job took {r['laborMinutes']} minutes.")

    neg = m["negation"]
    if r["customerApproved"] is True:
        lines.append(
            "- The customer approved the work: say they gave an actual yes to it, not just "
            "that they were happy. Vary the words."
        )
    elif r["customerApproved"] is False:
        lines.append("- The customer did not approve the work: say so plainly, in your own words.")
    else:
        lines.append("- Don't mention whether the customer approved or signed off.")
    if r["followUps"]:
        lines.append(f"- Still to do later: {'; '.join(r['followUps'])}.")

    hard = []
    if supply_item:
        hard.append(
            f"Mention that you made a run to the supply house to pick up the {m['supply']}."
        )
    c = m["correction"]
    if c and c["field"] == "material":
        hard.append(
            f"When you give the amount of {c['name']}, first say {c['wrong']} by mistake, "
            f"then correct yourself to {c['right']} (e.g. '{c['wrong']}, no {c['right']}')."
        )
    elif c and phrasing == "hours":
        hard.append(
            f"When you give the time, first say {_hours(c['wrong'])} by mistake, then correct "
            f"yourself to {_hours(c['right'])}."
        )
    elif c:
        which = "the main work's time" if phrasing == "base+extra" else "the time"
        hard.append(
            f"When you give {which}, first say {c['wrong']} minutes by mistake, then correct "
            f"yourself to {c['right']} minutes."
        )
    if neg and neg["kind"] == "material":
        hard.append(f"Mention that you didn't need the {neg['item']} after all.")
    elif neg and neg["kind"] == "task":
        hard.append(f"Mention that you didn't get to this task: {neg['item']}.")
    if hard:
        lines += ["", "Also:", *(f"- {h}" for h in hard)]
    lines += ["", "Paraphrase naturally; don't copy the wording above."]
    return "\n".join(lines)


# Batching (#70): the free tier allows 20 requests per model per day, so one writer
# call drafts several notes and one checker call extracts several.

WRITER_BATCH_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "notes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"id": {"type": "string"}, "note": {"type": "string"}},
                "required": ["id", "note"],
            },
        }
    },
    "required": ["notes"],
}


def writer_batch_prompt(plans: list[dict[str, Any]], styles: dict[str, str]) -> str:
    head = (
        f"Write {len(plans)} separate notes, one per section below, returned with the "
        "section's id. Each is a different job, customer and tradesperson: don't reuse "
        "sentences, openings or sign-offs between notes. Vary how each note opens and how "
        "it words the customer's approval."
    )
    return "\n\n".join([head, *(f"### {p['id']}\n{writer_prompt(p, styles)}" for p in plans)])


CHECKER_BATCH_SYSTEM = (
    CHECKER_SYSTEM + " The input is a JSON list of unrelated notes: extract each one on its "
    "own and return it with its id."
)


def checker_batch_input(items: list[tuple[str, str]]) -> str:
    return json.dumps([{"id": i, "note": n} for i, n in items], ensure_ascii=False)


def checker_batch_schema(record_schema: dict[str, Any]) -> dict[str, Any]:
    record = {k: v for k, v in record_schema.items() if k != "$schema"}
    return {
        "type": "object",
        "properties": {
            "results": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"id": {"type": "string"}, "record": record},
                    "required": ["id", "record"],
                },
            }
        },
        "required": ["results"],
    }
