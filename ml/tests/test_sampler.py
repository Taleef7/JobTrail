"""#70: the seeded record-first sampler. Labels are correct by construction only if
every tag is backed by the record, so these tests check tags against records."""

import json
from collections import Counter
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from jobtrail_ml.sampler import TAGS, load_scenarios, plan_split, plan_splits

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "packages/core/schema/schema.v2.json").read_text(encoding="utf-8"))
SCENARIOS = load_scenarios(ROOT / "data/scenarios.yaml")
COUNTS = {"test": 165, "dev": 110}


@pytest.fixture(scope="module")
def plans():
    return plan_splits(SCENARIOS, seed=70, counts=COUNTS)


def test_same_seed_same_plan_and_different_seed_differs(plans):
    assert plan_splits(SCENARIOS, seed=70, counts=COUNTS) == plans
    assert plan_splits(SCENARIOS, seed=71, counts=COUNTS) != plans


def test_counts_and_unique_ids(plans):
    by_split = Counter(p["split"] for p in plans)
    assert by_split == COUNTS
    ids = [p["id"] for p in plans]
    assert len(ids) == len(set(ids))
    assert all(p["id"].startswith("t-" if p["split"] == "test" else "d-") for p in plans)


def test_every_planned_record_satisfies_schema_v2(plans):
    validator = Draft202012Validator(SCHEMA)
    for p in plans:
        errors = [e.message for e in validator.iter_errors(p["record"])]
        assert not errors, (p["id"], errors)


def test_every_tag_has_at_least_12_test_drafts_and_plain_share(plans):
    test = [p for p in plans if p["split"] == "test"]
    per_tag = Counter(t for p in test for t in p["tags"])
    assert set(per_tag) == set(TAGS)
    assert min(per_tag.values()) >= 12, per_tag
    plain = sum(1 for p in test if not p["tags"])
    assert 0.15 <= plain / len(test) <= 0.25


def test_no_conflicting_tags(plans):
    for p in plans:
        for tag in p["tags"]:
            conflicts = set(SCENARIOS["tags"][tag].get("conflicts", []))
            assert not conflicts & set(p["tags"]), (p["id"], p["tags"])


def test_tags_are_backed_by_the_record(plans):
    hours = set(SCENARIOS["hours_values"])
    for p in plans:
        r, m, tags = p["record"], p["meta"], set(p["tags"])
        assert r["jobType"] == p["trade"]
        assert ("no-materials" in tags) == (r["materials"] == [])
        assert ("multiple-materials" in tags) == (len(r["materials"]) >= 3)
        assert ("approval-absent" in tags) == (r["customerApproved"] is None)
        assert ("hours-phrasing" in tags) == (m["labor"]["phrasing"] == "hours")
        if "hours-phrasing" in tags:
            assert r["laborMinutes"] in hours
        assert ("extra-labor" in tags) == (m["labor"]["phrasing"] == "base+extra")
        if "extra-labor" in tags:
            assert m["labor"]["base"] + m["labor"]["extra"] == r["laborMinutes"]
            assert m["labor"]["extra_task"] in r["workPerformed"]
        if r["laborMinutes"] is None:
            assert m["labor"]["phrasing"] == "none"
        assert ("self-correction" in tags) == (m["correction"] is not None)
        if m["correction"]:
            c = m["correction"]
            assert c["wrong"] != c["right"] and c["wrong"] > 0
            if c["field"] == "labor" and m["labor"]["phrasing"] == "base+extra":
                assert c["right"] == m["labor"]["base"]
            elif c["field"] == "labor":
                assert c["right"] == r["laborMinutes"]
                if m["labor"]["phrasing"] == "hours":
                    assert c["wrong"] in hours
            else:
                assert {"name": c["name"], "right": c["right"]} in [
                    {"name": x["name"], "right": x["quantity"]} for x in r["materials"]
                ]
        assert ("negation" in tags) == (m["negation"] is not None)
        if m["negation"]:
            kind, item = m["negation"]["kind"], m["negation"]["item"]
            if kind == "approval":
                assert r["customerApproved"] is False
            elif kind == "material":
                assert item not in [x["name"] for x in r["materials"]]
            else:
                assert item not in r["workPerformed"]
        elif "approval-absent" not in tags:
            assert r["customerApproved"] is True  # false only ever comes from a negation
        assert ("supply-house-trip" in tags) == (m["supply"] is not None)
        if m["supply"]:
            assert m["supply"] in [x["name"] for x in r["materials"]]
            assert f"Picked up {m['supply']} at the supply house" in r["workPerformed"]


def test_unsaid_quantity_has_no_unit(plans):
    for p in plans:
        for mat in p["record"]["materials"]:
            if mat["quantity"] is None:
                assert mat["unit"] is None, p["id"]


def test_test_and_dev_never_share_a_record(plans):
    def key(p):
        return json.dumps(p["record"], sort_keys=True)

    test = {key(p) for p in plans if p["split"] == "test"}
    assert not [p["id"] for p in plans if p["split"] == "dev" and key(p) in test]


def test_styles_and_trades_are_balanced(plans):
    test = [p for p in plans if p["split"] == "test"]
    styles = Counter(p["style"] for p in test)
    trades = Counter(p["trade"] for p in test)
    assert max(styles.values()) - min(styles.values()) <= 1
    assert max(trades.values()) - min(trades.values()) <= 1


def test_split_streams_are_independent():
    """Changing the dev count must not change a single test plan."""
    a = plan_split(SCENARIOS, seed=70, split="test", n=165)
    b = plan_splits(SCENARIOS, seed=70, counts={"test": 165, "dev": 50})
    assert [p for p in b if p["split"] == "test"] == a


def test_realism_main_task_first_minutes_capped_extra_is_minor(plans):
    """Pilot findings (#70): nobody says '190 minutes'; the extra task is never the main one."""
    for p in plans:
        r, labor = p["record"], p["meta"]["labor"]
        mains = [j["work"][0] for j in SCENARIOS["trades"][p["trade"]]]
        assert r["workPerformed"][0] in mains, p["id"]
        if labor["phrasing"] == "minutes":
            assert r["laborMinutes"] <= 90, p["id"]
        if labor["phrasing"] == "base+extra":
            assert labor["base"] <= 90 and labor["extra_task"] not in mains, p["id"]


def test_negation_always_has_something_to_negate_across_seeds():
    """Codex #105 round 3: negation + approval-absent could leave nothing to negate
    (IndexError for seed=1 and 23 of the first 100 seeds)."""
    for seed in range(100):
        for p in plan_splits(SCENARIOS, seed=seed, counts=COUNTS):
            if p["meta"]["negation"]:
                assert p["meta"]["negation"]["kind"] in {"material", "task", "approval"}
