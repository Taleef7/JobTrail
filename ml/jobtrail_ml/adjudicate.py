"""#71: settle each eval draft's key without a human reviewer (owner decision, 2026-10-02).

Three reviewers from different model families, none of them a model the eval grades,
each review every draft alone under data/LABELING.md: accept the draft key, edit it,
or reject the note as ambiguous. A key is final when two reviewers agree on it, where
"agree" is the scorer's own zero-edit test in both directions, so wording differences
the scorer forgives don't count as disagreement. Without a majority the note is
rejected, as LABELING.md says to do with an ambiguous note.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Callable, Iterable
from itertools import combinations
from typing import Any

from jsonschema import Draft202012Validator

from .freeze import GOLD_KEYS, SCHEMA_PATH, draft_hash
from .review import MODELS as PANEL_MODELS
from .review import SPLITS

REVIEWERS = {
    "gpt": "gpt-6-astra (Codex CLI 0.153, reasoning effort high)",
    "gemini": "gemini-3.1-pro-high (Antigravity CLI 1.2)",
    "claude": "claude-opus-5-5 (subagent)",
}
ACTIONS = ("accept", "edit", "reject")
MAX_ITEMS = 12
# Antigravity takes the prompt as an argument, and Windows caps a command line at 32,767
# characters, with every '"' escaped: cmdline_cost() counts that.
MAX_CMDLINE = 28_000

Draft = dict[str, Any]
Vote = dict[str, Any]
Agree = Callable[[list[tuple[dict, dict]]], list[bool]]

INSTRUCTIONS = """\
You are one of three independent reviewers checking the answer keys of an evaluation
set for a data-extraction model. Each item below is a tradesperson's end-of-job note
and a draft answer key: a JSON job record. Decide, for every item, whether the key
says exactly what the note says under the labeling rules that follow.

For each item answer:
- "accept" when the key is right under the rules. Wording of list items may differ
  from the note; what matters is the right items, numbers, units and values. gold: null.
- "edit" when any field is wrong. gold: the full corrected record (all seven fields),
  changing only what the rules require.
- "reject" when the note is ambiguous or contradicts itself, so the rules don't settle
  the key. gold: null, and say why in the comment.

Check every field against the note yourself. "concerns" are problems raised by
earlier automated checks; they can be wrong, so confirm each against the note before
acting on it. Label only what the note says; never infer from trade knowledge.
comment: one short sentence on what you changed or why you rejected; "" for a plain
accept. Do not use any tools. Answer with JSON only, matching the response schema:
exactly one decision per item, in the order given.
"""


def concerns(draft: Draft, panel: dict[str, dict[str, dict]]) -> list[str]:
    """The fidelity flags (#70) and panel problems (#71 step 1) a reviewer is shown."""
    out = [f"automated check: {flag}" for flag in draft["meta"]["flags"]]
    seen = set()
    for model in PANEL_MODELS:
        for p in panel[model][draft["id"]]["problems"]:
            text = f"reviewer note on {p['field']}: {p['issue']}"
            if text not in seen:
                seen.add(text)
                out.append(text)
    return out


def reasons(draft: Draft, panel: dict[str, dict[str, dict]]) -> list[str]:
    r = []
    if draft["meta"]["flags"]:
        r.append("fidelity")
    if any(not panel[m][draft["id"]]["ok"] for m in PANEL_MODELS):
        r.append("panel")
    return r


def review_items(drafts: list[Draft], panel: dict[str, dict[str, dict]]) -> list[dict]:
    """Every draft, test then dev, in id order, as a reviewer sees it."""
    order = {s: i for i, s in enumerate(SPLITS)}
    ordered = sorted(drafts, key=lambda d: (order[d["meta"]["split"]], d["id"]))
    return [
        {"id": d["id"], "note": d["note"], "tags": d["tags"], "draft_key": d["gold"],
         "concerns": concerns(d, panel)}
        for d in ordered
    ]  # fmt: skip


def prompt(rules: str, items: list[dict]) -> str:
    body = "[\n" + ",\n".join(json.dumps(i, ensure_ascii=False) for i in items) + "\n]"
    return f"{INSTRUCTIONS}\n# Labeling rules\n\n{rules.strip()}\n\n# Items\n\n{body}\n"


def cmdline_cost(text: str) -> int:
    return len(text) + text.count('"') + text.count("\\")


def batches(items: list[dict], rules: str) -> list[list[dict]]:
    """Greedy, order-preserving packing: at most MAX_ITEMS items and MAX_CMDLINE."""
    out: list[list[dict]] = []
    cur: list[dict] = []
    for item in items:
        full = cmdline_cost(prompt(rules, [*cur, item])) > MAX_CMDLINE
        if cur and (len(cur) == MAX_ITEMS or full):
            out.append(cur)
            cur = []
        cur.append(item)
        if cmdline_cost(prompt(rules, cur)) > MAX_CMDLINE:
            raise ValueError(f"{item['id']} alone makes a prompt over {MAX_CMDLINE} chars")
    if cur:
        out.append(cur)
    return out


def _record_schema() -> dict:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    schema.pop("$schema", None)
    return schema


def vote_schema() -> dict:
    """The response schema every reviewer answers with (strict: all keys required)."""
    return {
        "type": "object",
        "properties": {
            "decisions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "action": {"type": "string", "enum": list(ACTIONS)},
                        "gold": {"anyOf": [_record_schema(), {"type": "null"}]},
                        "comment": {"type": "string"},
                    },
                    "required": ["id", "action", "gold", "comment"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["decisions"],
        "additionalProperties": False,
    }


def check_votes(item_ids: list[str], reviewer: str, votes: Iterable[Vote]) -> dict[str, Vote]:
    """One valid vote per item: edits carry a schema-v2 key, accepts and rejects don't."""
    validator = Draft202012Validator(_record_schema())
    wanted = set(item_ids)
    by_id: dict[str, Vote] = {}
    for v in votes:
        where = f"{reviewer} {v.get('id')}"
        if v["id"] in by_id:
            raise ValueError(f"{where}: duplicate vote")
        if v["id"] not in wanted:
            raise ValueError(f"{where}: not an item")
        if v["action"] not in ACTIONS:
            raise ValueError(f"{where}: unknown action {v['action']!r}")
        if v["action"] == "edit":
            errors = list(validator.iter_errors(v["gold"])) if v["gold"] is not None else [None]
            if errors:
                raise ValueError(f"{where}: edit without a valid schema-v2 key")
        elif v["gold"] is not None:
            raise ValueError(f"{where}: {v['action']} must have gold null")
        by_id[v["id"]] = v
    missing = [i for i in item_ids if i not in by_id]
    if missing:
        raise ValueError(f"{reviewer}: no vote for {', '.join(missing[:10])}")
    return by_id


def _canon(gold: dict) -> str:
    return json.dumps({k: gold[k] for k in GOLD_KEYS}, sort_keys=True)


def aggregate(
    drafts: list[Draft],
    votes: dict[str, dict[str, Vote]],
    agree: Agree,
    reasons_by_id: dict[str, list[str]],
    reviewed_at: str,
) -> list[dict]:
    """One decision per draft, in the freeze step's decisions format.

    A candidate is a reviewer's final key: the draft's for accept, theirs for edit,
    none for reject. Two or more rejects reject the note. Otherwise the draft stands
    if two candidates agree with it (accept); else the first candidate, in REVIEWERS
    order, that two candidates agree with becomes the key (edit); else no majority,
    and the note is rejected.
    """
    names = list(REVIEWERS)
    cands = {d["id"]: {r: _candidate(d, votes[r][d["id"]]) for r in names} for d in drafts}
    pairs: dict[tuple[str, str], tuple[dict, dict]] = {}
    for d in drafts:
        keys = [d["gold"], *(c for c in cands[d["id"]].values() if c is not None)]
        for a, b in combinations(keys, 2):
            if _canon(a) != _canon(b):
                pairs.setdefault((_canon(a), _canon(b)), (a, b))
    flat = [p for ab in pairs.values() for p in (ab, ab[::-1])]
    verdicts = agree(flat) if flat else []
    if len(verdicts) != len(flat):
        raise ValueError(f"agreement check returned {len(verdicts)} verdicts for {len(flat)}")
    same = {k: verdicts[2 * i] and verdicts[2 * i + 1] for i, k in enumerate(pairs)}

    def agrees(a: dict, b: dict) -> bool:
        ka, kb = _canon(a), _canon(b)
        return ka == kb or same.get((ka, kb), False) or same.get((kb, ka), False)

    out = []
    for d in drafts:
        c = cands[d["id"]]
        live = [(r, g) for r, g in c.items() if g is not None]
        rejects = [r for r in names if c[r] is None]
        action, gold, comment = "reject", None, ""
        if len(rejects) >= 2:
            comment = "rejected by " + "; ".join(
                f"{r}: {votes[r][d['id']]['comment']}" for r in rejects
            )
        elif sum(agrees(g, d["gold"]) for _, g in live) >= 2:
            action, gold = "accept", d["gold"]
        else:
            winner = next((g for _, g in live if sum(agrees(g, h) for _, h in live) >= 2), None)
            if winner is not None:
                action, gold = "edit", winner
            else:
                comment = "no two reviewers agree on a key"
        out.append({
            "id": d["id"], "split": d["meta"]["split"], "action": action, "gold": gold,
            "comment": comment, "reviewedAt": reviewed_at, "draftHash": draft_hash(d),
            "draft": d["gold"], "method": "adjudicated", "reasons": reasons_by_id[d["id"]],
            "votes": {r: {"action": votes[r][d["id"]]["action"],
                          "agreesWithKey": c[r] is not None and gold is not None
                          and agrees(c[r], gold),
                          "comment": votes[r][d["id"]]["comment"]} for r in names},
        })  # fmt: skip
    return out


def _candidate(draft: Draft, vote: Vote) -> dict | None:
    if vote["action"] == "reject":
        return None
    return draft["gold"] if vote["action"] == "accept" else vote["gold"]


def adjudication_stats(decisions: list[dict]) -> dict[str, Any]:
    """How the reviewers voted and how often they landed on the final key."""
    names = list(REVIEWERS)
    votes = {r: dict(Counter(x["votes"][r]["action"] for x in decisions)) for r in names}
    agreed = {r: sum(x["votes"][r]["agreesWithKey"] for x in decisions) for r in names}
    support = Counter(sum(x["votes"][r]["agreesWithKey"] for r in names) for x in decisions
                      if x["action"] != "reject")  # fmt: skip
    return {
        "reviewers": REVIEWERS,
        "votes": votes,
        "agreesWithFinalKey": agreed,
        "finalKeySupport": {f"{k}/3": support[k] for k in sorted(support)},
        "unresolved": sum(x["comment"] == "no two reviewers agree on a key" for x in decisions),
    }
