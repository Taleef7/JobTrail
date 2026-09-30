"""Fidelity flags for eval drafts (#70). A flag is a pointer for the human reviewer
in #71, never an automatic verdict: the plan (gold) only counts if the note really
says it. Token normalization mirrors packages/core/src/match.ts."""

from __future__ import annotations

import re
from typing import Any

STOPWORDS = {"a", "an", "and", "at", "for", "in", "of", "on", "some", "the", "to", "with"}
NUMBER_WORDS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "dozen": 12,
    "half": 0.5, "couple": 2, "pair": 2,
}  # fmt: skip
APPROVAL = re.compile(
    r"approv|sign(?:ed)?[\s-]*off|\bsign|declin|reject|refus|turned (?:it |us )?down|okay"
    r"|\bok(?:'?d)?\b|thumbs?[\s-]*up|go-?ahead|all clear|green light"
)
NEGATION_CUE = re.compile(r"\b(?:didn'?t|did not|no need|not needed|never|wasn'?t|skipped)\b")


def _singular(t: str) -> str:
    if len(t) <= 3 or t.endswith("ss"):
        return t
    if t.endswith("ies"):
        return t[:-3] + "y"
    if re.search(r"(?:x|z|ch|sh|ss)es$", t):
        return t[:-2]
    return t[:-1] if t.endswith("s") else t


def normalize_tokens(text: str) -> list[str]:
    text = re.sub(r"['’]s\b", "", text.lower())
    return [_singular(t) for t in re.split(r"[^a-z0-9]+", text) if t and t not in STOPWORDS]


def numbers_in_text(text: str) -> set[float]:
    lower = text.lower()
    found = {float(m) for m in re.findall(r"\d+(?:\.\d+)?", lower)}
    for word in re.split(r"[^a-z]+", lower):
        if word in NUMBER_WORDS:
            found.add(NUMBER_WORDS[word])
    for m in re.finditer(r"\b(\w+)(?: hours?)? and a half\b", lower):
        base = NUMBER_WORDS.get(m.group(1)) or (float(m.group(1)) if m.group(1).isdigit() else 0)
        found.add(base + 0.5)
    return found


def _mentions(note: str, phrase: str) -> bool:
    tokens = normalize_tokens(phrase)
    have = set(normalize_tokens(note))
    return bool(tokens) and 2 * sum(t in have for t in tokens) >= len(tokens)


def _says_number(note: str, n: float) -> bool:
    return n in numbers_in_text(note)


def note_flags(plan: dict[str, Any], note: str) -> list[str]:
    r, m = plan["record"], plan["meta"]
    lower = note.lower()
    flags: list[str] = []

    note_tokens = set(normalize_tokens(note))
    for mat in r["materials"]:
        if not _mentions(note, mat["name"]):
            flags.append(f"material-not-in-note:{mat['name']}")
        if mat["quantity"] is not None and not _says_number(note, mat["quantity"]):
            flags.append(f"quantity-not-in-note:{mat['name']}={mat['quantity']}")
        if mat["unit"] and not _unit_forms(mat["unit"]) & note_tokens:
            flags.append(f"unit-not-in-note:{mat['name']}={mat['unit']}")

    labor, minutes = m["labor"], r["laborMinutes"]
    if labor["phrasing"] == "hours":
        if re.search(rf"\b{minutes}\b", note):
            flags.append("labor-minutes-leaked")
    elif labor["phrasing"] == "base+extra":
        if not (_says_number(note, labor["base"]) and _says_number(note, labor["extra"])):
            flags.append("labor-not-in-note")
        if re.search(rf"\b{minutes}\b", note):
            flags.append("labor-total-leaked")
    elif labor["phrasing"] == "minutes" and not _says_number(note, minutes):
        flags.append("labor-not-in-note")

    c = m["correction"]
    # an hours-phrased labor slip ("an hour, no an hour and a half") can't be checked by
    # number lookup; every other correction can
    hours_slip = c and c["field"] == "labor" and labor["phrasing"] == "hours"
    if c and not hours_slip and not _says_number(note, c["wrong"]):
        flags.append("correction-missing")

    said_approval = bool(APPROVAL.search(lower))
    if r["customerApproved"] is None and said_approval:
        flags.append("approval-mentioned")
    if r["customerApproved"] is not None and not said_approval:
        flags.append("approval-missing")

    neg = m["negation"]
    negated = neg and neg["kind"] != "approval"
    if negated and not (_mentions(note, neg["item"]) and NEGATION_CUE.search(lower)):
        flags.append("negation-missing")
    if m["supply"] and "supply" not in lower:
        flags.append("supply-missing")
    return flags


UNIT_ALIASES = {
    "feet": {"feet", "foot", "ft"},
    "gallon": {"gallon", "gal"},
    "pound": {"pound", "lb", "lbs"},
    "quart": {"quart", "qt"},
}


def _unit_forms(unit: str) -> set[str]:
    """Normalized tokens that say this unit in a note ('gallon' → gallon, gal)."""
    base = " ".join(normalize_tokens(unit))
    return UNIT_ALIASES.get(base, {base})


def _canonical_unit(unit: str | None) -> str | None:
    if not unit:
        return None
    base = " ".join(normalize_tokens(unit))
    return next((k for k, forms in UNIT_ALIASES.items() if base in forms), base)


def _dice(a: str, b: str) -> float:
    ta, tb = set(normalize_tokens(a)), set(normalize_tokens(b))
    return 2 * len(ta & tb) / (len(ta) + len(tb)) if ta and tb else 0.0


def crosscheck_flags(planned: dict[str, Any], checked: dict[str, Any] | None) -> list[str]:
    """Disagreements between the plan and a different model's blind extraction."""
    if checked is None:
        return ["crosscheck:invalid"]
    flags = [
        f"crosscheck:{field}"
        for field in ("jobType", "laborMinutes", "customerApproved")
        if planned[field] != checked.get(field)
    ]
    pm, cm = planned["materials"], checked.get("materials") or []
    if len(pm) != len(cm):
        flags.append("crosscheck:materials-count")
    pairs = _match([m["name"] for m in pm], [m.get("name", "") for m in cm])
    for i, j in pairs:
        if pm[i]["quantity"] != cm[j].get("quantity"):
            flags.append(f"crosscheck:quantity:{pm[i]['name']}")
        if _canonical_unit(pm[i]["unit"]) != _canonical_unit(cm[j].get("unit")):
            flags.append(f"crosscheck:unit:{pm[i]['name']}")
    matched = {i for i, _ in pairs}
    flags += [
        f"crosscheck:material-missing:{m['name']}" for i, m in enumerate(pm) if i not in matched
    ]
    # Lists are compared by content, not just length (Codex #105 round 2).
    for field in ("workPerformed", "issuesFound", "followUps"):
        mine, theirs = planned[field], checked.get(field) or []
        if len(mine) != len(theirs):
            flags.append(f"crosscheck:{field}-count")
        found = {i for i, _ in _match(mine, theirs)}
        flags += [f"crosscheck:{field}-missing:{x}" for i, x in enumerate(mine) if i not in found]
    return flags


def _match(planned: list[str], checked: list[str]) -> list[tuple[int, int]]:
    """Greedy one-to-one pairs with Dice >= 0.5, best first (the scorer's matching rule)."""
    scored = sorted(
        ((_dice(a, b), i, j) for i, a in enumerate(planned) for j, b in enumerate(checked)),
        reverse=True,
    )
    used_p, used_c, pairs = set(), set(), []
    for score, i, j in scored:
        if score >= 0.5 and i not in used_p and j not in used_c:
            used_p.add(i)
            used_c.add(j)
            pairs.append((i, j))
    return pairs
