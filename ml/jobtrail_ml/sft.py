"""Supervised fine-tuning data (#75): training examples in exactly the shape the runner asks.

At evaluation the #72 runner sends the note alone as one user message (`fine-tuned-short`)
and llama.cpp applies the model's own chat template; the answer must be the record in the
run's format. So an example is that same user message as the prompt and the encoded record
as the assistant's completion, and the loss is on the completion only (TRL's
prompt-completion format).
"""

from __future__ import annotations

import json
import random
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from . import extract


def load_rows(path: Path) -> list[dict[str, Any]]:
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x]


def to_example(row: dict[str, Any], fmt: str) -> dict[str, Any]:
    """One TRL conversational prompt-completion example."""
    return {
        "id": row["id"],
        "prompt": extract.messages(row["note"], "fine-tuned-short", fmt),
        "completion": [{"role": "assistant", "content": extract.encode(row["target"], fmt)}],
    }


def split_validation(
    rows: list[dict[str, Any]], frac: float, seed: int
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(train, validation): the notes the trainer learns from, and the ones it only scores
    each epoch to watch for overfitting. Dev is never used here; it picks the recipe.

    Stratified by trade, so every trade shows up in a validation set of only ~40 notes. Notes
    with the same facts go to the same side: 7 plans were written twice in different styles
    (#74), and a twin in training would make the validation loss look better than it is."""
    rng = random.Random(f"jobtrail-sft-val:{seed}")
    groups: dict[tuple, list[dict[str, Any]]] = {}
    for r in sorted(rows, key=lambda r: r["id"]):
        groups.setdefault(_facts(r["target"]), []).append(r)
    by_trade: dict[str, list[list[dict[str, Any]]]] = {}
    for g in groups.values():
        by_trade.setdefault(g[0]["trade"], []).append(g)
    val_ids: set[str] = set()
    for trade in sorted(by_trade):
        gs = by_trade[trade]
        rng.shuffle(gs)
        want, got = round(frac * sum(len(g) for g in gs)), 0
        for g in gs:
            if got >= want:
                break
            val_ids |= {r["id"] for r in g}
            got += len(g)
    ordered = sorted(rows, key=lambda r: r["id"])
    return ([r for r in ordered if r["id"] not in val_ids],
            [r for r in ordered if r["id"] in val_ids])  # fmt: skip


def _facts(t: dict[str, Any]) -> tuple:
    """What a plan fixes (trainset.plan_contradictions): equal for two notes of one plan."""
    amounts = sorted((m["quantity"] is None, m["quantity"] or 0, (m["unit"] or "").lower())
                     for m in t["materials"])  # fmt: skip
    return (t["jobType"], t["laborMinutes"], t["customerApproved"], len(t["workPerformed"]),
            len(t["issuesFound"]), len(t["followUps"]), tuple(amounts))  # fmt: skip


def ids(rows: Iterable[dict[str, Any]]) -> list[str]:
    return [r["id"] for r in rows]
