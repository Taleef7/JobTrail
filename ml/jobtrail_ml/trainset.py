"""The training set (#74): held-out templates, training plans, the agreement filter and
the leakage check against the frozen eval sets.

Notes are written record-first like the eval drafts (#70): a plan fixes the facts and a
writer model turns them into a note in its own words. The training target is what two
independent blind labelers read in the note, so it uses the note's wording (a target
naming a part the note calls something else would teach the model to invent). A note is
kept only if both labels are valid, they agree (the core scorer's zero-edit test, both
directions), and the label keeps every fact the plan fixed (plan_contradictions).
"""

from __future__ import annotations

import copy
import json
import random
import re
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

import yaml

from .sampler import Plan, fits, plan_split, tag_combos

# A training note is a near-duplicate of an eval note when it is closer to it than
# nearly all independently written test/dev pairs are to each other. Measured on the
# frozen sets before any training note existed: the test-vs-dev 95th percentiles are
# 0.139 (5-shingle Jaccard) and 0.154 (8-gram containment); the maxima 0.256 and 0.52.
LEAKAGE = {"jaccard5": 0.2, "containment8": 0.3}

Agree = Callable[[list[tuple[dict, dict]]], list[bool]]


def load_config(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def holdout(scenarios: dict[str, Any], seed: int) -> dict[str, str]:
    """{trade: main task of its held-out template}, one per trade, from a fixed seed.
    Only templates whose removal still lets the trade express every hard case qualify."""
    rng = random.Random(f"jobtrail-holdout:{seed}")
    combos = tag_combos(scenarios)
    out = {}
    for trade in sorted(scenarios["trades"]):
        jobs = scenarios["trades"][trade]
        ok = [j for j in jobs
              if all(any(fits(k, c) for k in jobs if k is not j) for c in combos)]  # fmt: skip
        if not ok:
            raise ValueError(f"no {trade} template can be held out; extend scenarios.yaml")
        out[trade] = rng.choice(ok)["work"][0]
    return out


def training_scenarios(scenarios: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    """The scenario matrix without the held-out templates, with the training mix."""
    held = set(config["holdout"].values())
    out = copy.deepcopy(scenarios)
    out["trades"] = {t: [j for j in jobs if j["work"][0] not in held]
                     for t, jobs in scenarios["trades"].items()}  # fmt: skip
    out["mix"] = {**scenarios["mix"], **(config.get("mix") or {})}
    return out


def eval_records(root: Path) -> set[str]:
    """Every test/dev answer key: the frozen ones and the plans they were drafted from."""
    keys = set()
    for path in (root / "data/test.jsonl", root / "data/dev.jsonl"):
        for line in path.read_text(encoding="utf-8").splitlines():
            keys.add(json.dumps(json.loads(line)["gold"], sort_keys=True))
    for line in (root / "data/drafts/plan.jsonl").read_text(encoding="utf-8").splitlines():
        keys.add(json.dumps(json.loads(line)["record"], sort_keys=True))
    return keys


def plan_train(
    scenarios: dict[str, Any], config: dict[str, Any], n: int, root: Path | None = None
) -> list[Plan]:
    """The first n plans of the fixed training pool, so a pilot is a prefix of the full run."""
    if n > config["pool"]:
        raise ValueError(f"asked for {n} plans; the pool is {config['pool']}")
    root = root or Path(__file__).resolve().parents[2]
    pool = plan_split(training_scenarios(scenarios, config), config["seed"], "train",
                      config["pool"], avoid=eval_records(root),
                      weights=config.get("tag_weights"), per_style=True)  # fmt: skip
    return pool[:n]


def held_out_ids(rows: Iterable[dict], held: dict[str, str]) -> set[str]:
    """Eval records from a held-out template (their main task is the template's)."""
    mains = set(held.values())
    return {r["id"] for r in rows if r["gold"]["workPerformed"][0] in mains}


def _unit(u: str | None) -> str | None:
    if u is None:
        return None
    u = u.strip().lower()
    return u[:-1] if len(u) > 3 and u.endswith("s") and not u.endswith("ss") else u


def plan_contradictions(plan: dict, label: dict, optional_issues: Iterable[str] = ()) -> list[str]:
    """Fields where a label breaks a fact the plan fixed. Wording is the note's, so it
    isn't compared; the facts are:
    - the same trade, minutes, approval and number of follow-ups;
    - every planned task, plus at most one more per planned material: the writer may
      narrate putting a material in ("popped in two filters"), and the eval gold lists
      that as a task (t-0121, d-0104);
    - the planned issues, except that an optional one (an issue LABELING.md reads as the
      job's own task, labeled both ways in the frozen gold) may be left out;
    - the same materials by quantity and unit, in any order.
    """
    bad = [k for k in ("jobType", "laborMinutes", "customerApproved") if plan[k] != label[k]]
    planned, tasks = len(plan["workPerformed"]), len(label["workPerformed"])
    if not planned <= tasks <= planned + len(plan["materials"]):
        bad.append("workPerformed")
    issues = len(plan["issuesFound"])
    skippable = sum(i in set(optional_issues) for i in plan["issuesFound"])
    if not issues - skippable <= len(label["issuesFound"]) <= issues:
        bad.append("issuesFound")
    if len(plan["followUps"]) != len(label["followUps"]):
        bad.append("followUps")

    def amounts(rec: dict) -> list[tuple]:
        return sorted((m["quantity"] is None, m["quantity"] or 0, _unit(m["unit"]) or "")
                       for m in rec["materials"])  # fmt: skip

    if amounts(plan) != amounts(label):
        bad.append("materials")
    order = list(plan)
    return sorted(bad, key=order.index)


def decide(
    rows: list[dict],
    plans: dict[str, dict],
    labelers: list[str],
    agree: Agree,
    optional_issues: Iterable[str] = (),
) -> dict[str, dict]:
    """{id: {"reason": None to keep, else why it's dropped, "target", "contradicts"}}.

    Each row has `labels` {labeler: record, or None if unparseable or schema-invalid}.
    Checks in order: every labeler answered, every label is valid, the labels agree with
    each other (zero-edit, both directions), the first labeler's label keeps the plan's
    facts. The target is the first labeler's label.
    """
    out: dict[str, dict] = {}
    pairs: list[tuple[dict, dict]] = []
    asks: list[str] = []
    for r in rows:
        labels = r["labels"]
        res = {"reason": None, "target": None, "contradicts": []}
        if any(name not in labels for name in labelers):
            res["reason"] = "unlabeled"
        elif any(labels[name] is None for name in labelers):
            res["reason"] = "invalid-label"
        else:
            first = labels[labelers[0]]
            for name in labelers[1:]:
                pairs += [(first, labels[name]), (labels[name], first)]
                asks.append(r["id"])
            res["target"] = first
        out[r["id"]] = res
    verdicts = agree(pairs) if pairs else []
    for k, rid in enumerate(asks):
        if not (verdicts[2 * k] and verdicts[2 * k + 1]):
            out[rid].update(reason="labelers-disagree", target=None)
    for r in rows:
        res = out[r["id"]]
        if res["reason"] is None:
            res["contradicts"] = plan_contradictions(plans[r["id"]], res["target"],
                                                     optional_issues)  # fmt: skip
            if res["contradicts"]:
                res.update(reason="contradicts-plan", target=None)
    return out


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _grams(tokens: list[str], n: int) -> set[tuple[str, ...]]:
    return {tuple(tokens[i : i + n]) for i in range(len(tokens) - n + 1)}


def leakage(train: list[dict], evals: list[dict]) -> dict[str, dict]:
    """{train id: closest eval note by each measure and whether it's a near-duplicate}."""
    ev = []
    for e in evals:
        t = _tokens(e["note"])
        ev.append((e["id"], _grams(t, 5), _grams(t, 8)))
    out = {}
    for r in train:
        t = _tokens(r["note"])
        g5, g8 = _grams(t, 5), _grams(t, 8)
        best = {"jaccard5": 0.0, "containment8": 0.0, "match": None, "shares8": False}
        for eid, e5, e8 in ev:
            union = g5 | e5
            jac = len(g5 & e5) / len(union) if union else 0.0
            con = len(g8 & e8) / len(g8) if g8 else 0.0
            best["shares8"] = best["shares8"] or bool(g8 & e8)
            if max(jac / LEAKAGE["jaccard5"], con / LEAKAGE["containment8"]) > max(
                best["jaccard5"] / LEAKAGE["jaccard5"],
                best["containment8"] / LEAKAGE["containment8"],
            ):
                best.update(jaccard5=round(jac, 4), containment8=round(con, 4), match=eid)
        best["near"] = (best["jaccard5"] >= LEAKAGE["jaccard5"]
                        or best["containment8"] >= LEAKAGE["containment8"])  # fmt: skip
        out[r["id"]] = best
    return out
