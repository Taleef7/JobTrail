"""Record-first sampler for eval drafts (#70).

Each plan holds the gold record (schema v2) and everything the note writer must
express: style, hard-case tags and their specifics in `meta`. The teacher model
only turns a plan into prose, so the label is correct by construction as long as
the note is faithful (checked by fidelity.py, then by a human in #71).

Rules follow data/LABELING.md. Deterministic: same scenarios + seed + counts ->
identical plans (random.Random seeded with a string is stable across runs).
"""

from __future__ import annotations

import math
import random
from pathlib import Path
from typing import Any

import yaml

TAGS = [
    "hours-phrasing",
    "negation",
    "self-correction",
    "multiple-materials",
    "no-materials",
    "supply-house-trip",
    "extra-labor",
    "approval-absent",
]
ID_PREFIX = {"test": "t", "dev": "d"}
MAX_SAID_MINUTES = 90
Plan = dict[str, Any]


def load_scenarios(path: Path) -> dict[str, Any]:
    scenarios = yaml.safe_load(path.read_text(encoding="utf-8"))
    if set(scenarios["tags"]) != set(TAGS):
        raise ValueError(f"scenarios.yaml tags {sorted(scenarios['tags'])} != {sorted(TAGS)}")
    return scenarios


def _round5(n: int) -> int:
    return max(5, 5 * round(n / 5))


def _conflicts(scenarios: dict[str, Any], tag: str) -> set[str]:
    return set(scenarios["tags"][tag].get("conflicts") or [])


def _tag_sets(scenarios: dict[str, Any], rng: random.Random, n: int) -> list[list[str]]:
    """Balanced tag assignment: each tagged note takes the least-used compatible tag(s)."""
    mix = scenarios["mix"]
    n_plain = round(mix["plain_share"] * n)
    used = dict.fromkeys(TAGS, 0)
    sets: list[list[str]] = [[] for _ in range(n_plain)]
    for _ in range(n - n_plain):
        chosen: list[str] = []
        k = 2 if rng.random() < mix["two_tags_share"] else 1
        for _ in range(k):
            blocked = set(chosen).union(*(_conflicts(scenarios, t) for t in chosen))
            options = [t for t in TAGS if t not in blocked]
            low = min(used[t] for t in options)
            tag = rng.choice([t for t in options if used[t] == low])
            chosen.append(tag)
            used[tag] += 1
        sets.append(sorted(chosen))
    rng.shuffle(sets)
    return sets


def _balanced(items: list[str], rng: random.Random, n: int) -> list[str]:
    out = (items * math.ceil(n / len(items)))[:n]
    rng.shuffle(out)
    return out


def _material(spec: dict[str, Any], rng: random.Random, vague_p: float) -> dict[str, Any]:
    if spec.get("vague") and rng.random() < vague_p:
        return {"name": spec["name"], "quantity": None, "unit": None}  # "some X"
    lo, hi = spec["qty"]
    return {"name": spec["name"], "quantity": rng.randint(lo, hi), "unit": spec["unit"]}


def _plan_one(
    scenarios: dict[str, Any], rng: random.Random, trade: str, style: str, tags: list[str]
) -> Plan:
    mix = scenarios["mix"]
    tagset = set(tags)
    jobs = scenarios["trades"][trade]
    need_materials = 3 if "multiple-materials" in tagset else 0
    need_work = 2 if "extra-labor" in tagset else 1
    # negation without the approval option needs a spare material or task to negate
    spare = 1 if {"negation", "approval-absent"} <= tagset else 0
    fitting = [
        j
        for j in jobs
        if len(j["materials"]) >= need_materials + spare and len(j["work"]) >= need_work
    ]
    if not fitting:
        raise ValueError(f"no {trade} job template fits tags {tags}; extend scenarios.yaml")
    job = rng.choice(fitting)

    # The template's first work item is the job's main task; the rest are minor.
    work = [job["work"][0]]
    work_pool = list(job["work"][1:])
    rng.shuffle(work_pool)
    extra_task = None
    if "extra-labor" in tagset:
        extra_task = work_pool.pop()
    elif work_pool and rng.random() < mix["second_work"]:
        work.append(work_pool.pop())

    mat_pool = list(job["materials"])
    rng.shuffle(mat_pool)
    # If no task is left to negate, keep one material unused for the negation (Codex #105).
    keep = 1 if spare and not work_pool else 0
    if "no-materials" in tagset:
        n_mat = 0
    elif "multiple-materials" in tagset:
        n_mat = rng.randint(3, len(mat_pool) - keep)
    else:
        n_mat = rng.randint(1, min(2, len(mat_pool) - keep))
    materials = [_material(s, rng, mix["vague_quantity"]) for s in mat_pool[:n_mat]]
    unused_materials = [s["name"] for s in mat_pool[n_mat:]]

    issues = [rng.choice(job["issues"])] if job["issues"] and rng.random() < mix["issue"] else []
    followups = (
        [rng.choice(job["followups"])]
        if job["followups"] and rng.random() < mix["followup"]
        else []
    )

    # Times said in minutes stay <= 90 ("190 minutes" isn't how people talk);
    # longer jobs are what the hours-phrasing tag covers.
    lo, hi = job["labor"]
    lo, hi = min(lo, MAX_SAID_MINUTES), min(hi, MAX_SAID_MINUTES)
    if "hours-phrasing" in tagset:
        labor = {"phrasing": "hours"}
        minutes = rng.choice(scenarios["hours_values"])
    elif "extra-labor" in tagset:
        base = _round5(rng.randint(lo, hi))
        extra = rng.choice(scenarios["extra_labor_minutes"])
        labor = {"phrasing": "base+extra", "base": base, "extra": extra, "extra_task": extra_task}
        minutes = base + extra
        work.append(extra_task)
    elif "self-correction" not in tagset and rng.random() < mix["labor_missing"]:
        labor = {"phrasing": "none"}
        minutes = None
    else:
        labor = {"phrasing": "minutes"}
        minutes = _round5(rng.randint(lo, hi))

    supply = None
    if "supply-house-trip" in tagset:
        supply = rng.choice(materials)["name"]
        work.append(f"Picked up {supply} at the supply house")

    negation = None
    if "negation" in tagset:
        kinds = []
        if unused_materials:
            kinds.append("material")
        if work_pool:
            kinds.append("task")
        if "approval-absent" not in tagset:
            kinds.append("approval")
        kind = rng.choice(kinds)
        item = {
            "material": lambda: rng.choice(unused_materials),
            "task": lambda: rng.choice(work_pool),
            "approval": lambda: "customer approval",
        }[kind]()
        negation = {"kind": kind, "item": item}

    if negation and negation["kind"] == "approval":
        approved = False
    elif "approval-absent" in tagset:
        approved = None
    else:
        approved = True

    correction = None
    if "self-correction" in tagset:
        counted = [m for m in materials if m["quantity"] is not None]
        if counted and (minutes is None or rng.random() < 0.7):
            target = rng.choice(counted)
            right = target["quantity"]
            deltas = [d for d in (-2, -1, 1, 2) if right + d > 0]
            correction = {
                "field": "material",
                "name": target["name"],
                "wrong": right + rng.choice(deltas),
                "right": right,
            }
        elif labor["phrasing"] == "hours":  # the slip is said in hours too
            right = minutes
            wrong = rng.choice([h for h in scenarios["hours_values"] if h != right])
            correction = {"field": "labor", "name": None, "wrong": wrong, "right": right}
        else:  # with base+extra, the slip is on the main work's time
            right = labor["base"] if labor["phrasing"] == "base+extra" else minutes
            deltas = [d for d in (-30, -15, 15, 30) if right + d > 0]
            correction = {
                "field": "labor",
                "name": None,
                "wrong": right + rng.choice(deltas),
                "right": right,
            }

    record = {
        "jobType": trade,
        "workPerformed": work,
        "issuesFound": issues,
        "materials": materials,
        "laborMinutes": minutes,
        "customerApproved": approved,
        "followUps": followups,
    }
    meta = {"labor": labor, "correction": correction, "negation": negation, "supply": supply}
    return {"trade": trade, "style": style, "tags": tags, "record": record, "meta": meta}


def plan_split(
    scenarios: dict[str, Any],
    seed: int,
    split: str,
    n: int,
    avoid: set[str] | None = None,
) -> list[Plan]:
    """Plans for one split from its own RNG stream; records in `avoid` are resampled."""
    import json

    rng = random.Random(f"jobtrail-eval:{seed}:{split}")
    tag_sets = _tag_sets(scenarios, rng, n)
    trades = _balanced(list(scenarios["trades"]), rng, n)
    styles = _balanced(list(scenarios["styles"]), rng, n)
    seen = set(avoid or ())
    plans = []
    for i in range(n):
        for _ in range(50):
            plan = _plan_one(scenarios, rng, trades[i], styles[i], tag_sets[i])
            key = json.dumps(plan["record"], sort_keys=True)
            if key not in seen:
                break
        else:
            raise RuntimeError(f"could not draw a unique record for {split} #{i + 1}")
        seen.add(key)
        plans.append({"id": f"{ID_PREFIX[split]}-{i + 1:04d}", "split": split, **plan})
    return plans


def plan_splits(scenarios: dict[str, Any], seed: int, counts: dict[str, int]) -> list[Plan]:
    """Test first, then dev (dev never repeats a test record)."""
    import json

    test = plan_split(scenarios, seed, "test", counts["test"])
    avoid = {json.dumps(p["record"], sort_keys=True) for p in test}
    return test + plan_split(scenarios, seed, "dev", counts["dev"], avoid=avoid)
