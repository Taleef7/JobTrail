"""#71: the freeze check CI runs. Once data/FROZEN.md exists, every file it lists must
hash to the recorded SHA-256 and hold the recorded number of valid, disjoint records."""

import hashlib
import json
from pathlib import Path

import pytest

from jobtrail_ml.freeze import check_frozen, frozen_rows

DATA = Path(__file__).resolve().parents[2] / "data"


def test_a_frozen_set_cannot_exist_without_its_hashes():
    if (DATA / "test.jsonl").exists() or (DATA / "dev.jsonl").exists():
        assert (DATA / "FROZEN.md").exists(), "data/test.jsonl or dev.jsonl without FROZEN.md"


FROZEN = pytest.mark.skipif(not (DATA / "FROZEN.md").exists(), reason="not frozen yet (#71)")


@FROZEN
def test_frozen_files_are_unchanged_valid_and_disjoint():
    assert check_frozen(DATA) == []


# Pinned here rather than read from FROZEN.md, so a change can't edit a frozen file and
# its FROZEN.md row together and still pass: changing a frozen set means editing this test.
PINNED = {
    "test.jsonl": ("ceefa18c4113bc8e4052b680225b90530e4671d6cc012f201d5e9adab3ad71d4", 163),
    "dev.jsonl": ("393d67aef350bba1be49ea9ee97de608acec3fd969e4db523ca5970d67d3a679", 110),
}


@FROZEN
def test_frozen_sets_match_the_digests_pinned_in_this_test():
    rows = {name: (digest, n) for name, n, digest in
            frozen_rows((DATA / "FROZEN.md").read_text(encoding="utf-8"))}  # fmt: skip
    for name, (digest, n) in PINNED.items():
        assert hashlib.sha256((DATA / name).read_bytes()).hexdigest() == digest, name
        assert rows[name] == (digest, n), f"FROZEN.md row for {name} differs from the pin"


@FROZEN
def test_frozen_md_lists_both_eval_sets():
    names = {name for name, _, _ in frozen_rows((DATA / "FROZEN.md").read_text(encoding="utf-8"))}
    assert {"test.jsonl", "dev.jsonl"} <= names


@FROZEN
def test_a_part_picked_up_at_the_supply_house_is_a_material():
    # LABELING.md: the picked-up part is a material unless the note says it wasn't used.
    drafts = {}
    for split in ("test", "dev"):
        for line in (DATA / "drafts" / f"{split}.jsonl").read_text(encoding="utf-8").splitlines():
            d = json.loads(line)
            drafts[d["id"]] = d
    for split in ("test", "dev"):
        for line in (DATA / f"{split}.jsonl").read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            plan = drafts[r["id"]]["meta"]["plan"]
            if "supply-house-trip" in r["tags"] and plan.get("supply"):
                names = [m["name"] for m in r["gold"]["materials"]]
                assert plan["supply"] in names, r["id"]
