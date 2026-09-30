"""#71: build the owner's review queue from the drafts and the model panel's verdicts.

Hybrid verification (owner decision): three models each check every draft's key
against its note under data/LABELING.md. The owner then reviews, in the labeling
tool, every draft that has a fidelity flag or that any panelist questioned, plus a
seeded random audit of the clean ones, which estimates how often "clean" is wrong.
"""

from __future__ import annotations

import random
from collections import Counter
from typing import Any

MODELS = ("sonnet", "opus", "fable")
SPLITS = ("test", "dev")

Draft = dict[str, Any]
Verdict = dict[str, Any]


def _check_panel(drafts: list[Draft], panel: dict[str, dict[str, Verdict]]) -> None:
    ids = {d["id"] for d in drafts}
    for model in MODELS:
        got = panel.get(model, {})
        missing = sorted(ids - set(got))
        if missing:
            raise ValueError(f"panel {model} has no verdict for {', '.join(missing[:5])}")
        unknown = sorted(set(got) - ids)
        if unknown:
            raise ValueError(
                f"panel {model} has verdicts for unknown drafts {', '.join(unknown[:5])}"
            )


def build_queue(
    drafts: list[Draft], panel: dict[str, dict[str, Verdict]], audit_n: int, seed: int
) -> list[dict[str, Any]]:
    """Queue items in split (test, dev) then id order; each says why it's queued."""
    _check_panel(drafts, panel)
    reasons: dict[str, list[str]] = {}
    clean = []
    for d in drafts:
        r = []
        if d["meta"]["flags"]:
            r.append("fidelity")
        if any(not panel[m][d["id"]]["ok"] for m in MODELS):
            r.append("panel")
        reasons[d["id"]] = r
        if not r:
            clean.append(d["id"])
    for i in random.Random(seed).sample(sorted(clean), min(audit_n, len(clean))):
        reasons[i] = ["audit"]

    order = {s: n for n, s in enumerate(SPLITS)}
    queued = sorted((d for d in drafts if reasons[d["id"]]),
                    key=lambda d: (order[d["meta"]["split"]], d["id"]))  # fmt: skip
    return [
        {
            "id": d["id"],
            "split": d["meta"]["split"],
            "note": d["note"],
            "gold": d["gold"],
            "tags": d["tags"],
            "flags": d["meta"]["flags"],
            "panel": [
                {"model": m, "problems": panel[m][d["id"]]["problems"]}
                for m in MODELS
                if not panel[m][d["id"]]["ok"]
            ],
            "reasons": reasons[d["id"]],
        }
        for d in queued
    ]


def queue_summary(drafts: list[Draft], queue: list[dict[str, Any]]) -> dict[str, Any]:
    by_reason = Counter(r for item in queue for r in item["reasons"])
    audit = by_reason.get("audit", 0)
    return {
        "drafts": len(drafts),
        "queued": len(queue),
        "by_split": dict(Counter(item["split"] for item in queue)),
        "by_reason": dict(by_reason),
        "clean": len(drafts) - (len(queue) - audit),
        "audit": audit,
    }
