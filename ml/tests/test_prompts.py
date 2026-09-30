"""#70: prompts sent to the note writer and the blind cross-checker."""

import json

from jobtrail_ml.prompts import CHECKER_SYSTEM, WRITER_SYSTEM, material_phrase, writer_prompt

STYLES = {"terse": "Clipped fragments."}


def plan(**over):
    base = {
        "id": "t-0001",
        "trade": "plumbing",
        "style": "terse",
        "tags": [],
        "record": {
            "jobType": "plumbing",
            "workPerformed": ["Replaced toilet wax ring"],
            "issuesFound": [],
            "materials": [{"name": "wax ring", "quantity": 1, "unit": None}],
            "laborMinutes": 45,
            "customerApproved": True,
            "followUps": [],
        },
        "meta": {"labor": {"phrasing": "minutes"}, "correction": None, "negation": None,
                 "supply": None},
    }  # fmt: skip
    for k, v in over.items():
        if k in ("record", "meta"):
            base[k] = {**base[k], **v}
        else:
            base[k] = v
    return base


def test_material_phrases():
    assert material_phrase({"name": "wax ring", "quantity": 1, "unit": None}) == "1 wax ring"
    assert material_phrase({"name": "rigid duct", "quantity": 8, "unit": "feet"}) == (
        "8 feet of rigid duct"
    )
    assert material_phrase({"name": "spackle", "quantity": None, "unit": None}) == (
        "some spackle (no amount said)"
    )


def test_plain_prompt_states_every_fact_and_style():
    p = writer_prompt(plan(), STYLES)
    for needle in ["plumbing", "Clipped fragments.", "Replaced toilet wax ring", "1 wax ring",
                   "45 minutes", "approved"]:  # fmt: skip
        assert needle in p, needle
    assert "no other" in p.lower()  # forbids extra billables


def test_empty_sections_are_explicit():
    p = writer_prompt(plan(record={"materials": [], "laborMinutes": None,
                                   "customerApproved": None},
                           meta={"labor": {"phrasing": "none"}}), STYLES)  # fmt: skip
    assert "no materials" in p.lower()
    assert "don't mention how long" in p.lower()
    assert "don't mention whether the customer approved" in p.lower()


def test_hours_phrasing_never_leaks_the_minutes():
    p = writer_prompt(plan(record={"laborMinutes": 90}, meta={"labor": {"phrasing": "hours"}}),
                      STYLES)  # fmt: skip
    assert "1.5 hours" in p
    assert "90" not in p


def test_extra_labor_gives_parts_not_total():
    p = writer_prompt(
        plan(
            record={"laborMinutes": 80,
                    "workPerformed": ["Replaced toilet wax ring", "Cleared floor drain"]},
            meta={"labor": {"phrasing": "base+extra", "base": 60, "extra": 20,
                            "extra_task": "Cleared floor drain"}},
        ),
        STYLES,
    )  # fmt: skip
    assert "60 minutes" in p and "20 minutes" in p and "Cleared floor drain" in p
    assert "80" not in p
    assert "never the total" in p.lower()


def test_self_correction_negation_and_supply_instructions():
    p = writer_prompt(
        plan(
            record={"workPerformed": ["Replaced toilet wax ring",
                                      "Picked up wax ring at the supply house"],
                    "customerApproved": False},
            meta={"correction": {"field": "material", "name": "wax ring", "wrong": 2, "right": 1},
                  "negation": {"kind": "approval", "item": "customer approval"},
                  "supply": "wax ring"},
        ),
        STYLES,
    )  # fmt: skip
    assert "first say 2" in p and "correct yourself to 1" in p
    assert "did not approve" in p.lower()
    assert "supply house" in p


def test_time_correction_matches_the_phrasing():
    hours = writer_prompt(
        plan(record={"laborMinutes": 90},
             meta={"labor": {"phrasing": "hours"},
                   "correction": {"field": "labor", "name": None, "wrong": 60, "right": 90}}),
        STYLES,
    )  # fmt: skip
    assert "first say 1 hour" in hours and "correct yourself to 1.5 hours" in hours
    assert "minutes by mistake" not in hours and "90" not in hours
    extra = writer_prompt(
        plan(record={"laborMinutes": 80,
                     "workPerformed": ["Replaced toilet wax ring", "Cleared floor drain"]},
             meta={"labor": {"phrasing": "base+extra", "base": 60, "extra": 20,
                             "extra_task": "Cleared floor drain"},
                   "correction": {"field": "labor", "name": None, "wrong": 45, "right": 60}}),
        STYLES,
    )  # fmt: skip
    assert "main work" in extra and "first say 45 minutes" in extra
    assert "correct yourself to 60 minutes" in extra


def test_negated_material_and_task():
    m = writer_prompt(plan(meta={"negation": {"kind": "material", "item": "closet bolt"}}), STYLES)
    assert "didn't need" in m and "closet bolt" in m
    t = writer_prompt(plan(meta={"negation": {"kind": "task", "item": "Reset toilet"}}), STYLES)
    assert "didn't get to" in t and "Reset toilet" in t


def test_prompts_are_deterministic_and_systems_are_nonempty():
    assert writer_prompt(plan(), STYLES) == writer_prompt(plan(), STYLES)
    assert "Output only the note" in WRITER_SYSTEM
    assert "null" in CHECKER_SYSTEM and "minutes" in CHECKER_SYSTEM


def test_no_instruction_words_to_parrot():
    """Pilot findings (#70): notes echoed 'explicitly' and 'extra task' from the prompt."""
    extra = plan(
        record={"laborMinutes": 80,
                "workPerformed": ["Replaced toilet wax ring", "Cleared floor drain"]},
        meta={"labor": {"phrasing": "base+extra", "base": 60, "extra": 20,
                        "extra_task": "Cleared floor drain"}},
    )  # fmt: skip
    declined = plan(
        record={"customerApproved": False},
        meta={"negation": {"kind": "approval", "item": "customer approval"}},
    )
    for p in (plan(), extra, declined):
        text = writer_prompt(p, STYLES).lower()
        assert "explicitly" not in text and "extra task" not in text
        # batch 1 (#70): 3 of 4 extra-labor notes said "something came up"; most said
        # "signed off" (the example given) and one said "as extra work"
        assert "came up" not in text and "signed off" not in text and "extra work" not in text


def test_batch_prompt_and_schemas():
    from jobtrail_ml.prompts import (
        WRITER_BATCH_SCHEMA,
        checker_batch_input,
        checker_batch_schema,
        writer_batch_prompt,
    )

    a, b = plan(id="t-0001"), plan(id="t-0002", trade="electrical")
    text = writer_batch_prompt([a, b], STYLES)
    assert "### t-0001" in text and "### t-0002" in text and "Trade: electrical." in text
    assert "2 separate notes" in text and "different job" in text
    assert "vary" in text.lower() and "approval" in text.lower()
    assert WRITER_BATCH_SCHEMA["properties"]["notes"]["items"]["required"] == ["id", "note"]
    items = json.loads(checker_batch_input([("t-0001", "note a"), ("t-0002", "note b")]))
    assert items == [{"id": "t-0001", "note": "note a"}, {"id": "t-0002", "note": "note b"}]
    record = {"$schema": "x", "type": "object", "properties": {}}
    nested = checker_batch_schema(record)["properties"]["results"]["items"]["properties"]["record"]
    assert nested == {"type": "object", "properties": {}}  # $schema stripped when nested


def test_approval_must_be_an_actual_yes_and_checker_knows_the_rules():
    """Full run (#70): 21 'approved' notes only said the customer was happy; the checker
    didn't know the supply-trip rule; trades were undefined (general vs carpentry)."""
    text = writer_prompt(plan(), STYLES).lower()
    assert "not just that they were happy" in text
    for rule in ["supply house", "add", "roofing", "gutters", "general"]:
        assert rule in CHECKER_SYSTEM.lower(), rule


def test_no_materials_note_may_still_mention_the_negated_material():
    """Codex #105 round 2: 'don't mention any' contradicted 'mention you didn't need X'
    (t-0044, d-0007)."""
    p = plan(record={"materials": []},
             meta={"negation": {"kind": "material", "item": "closet bolt"}})  # fmt: skip
    text = writer_prompt(p, STYLES)
    assert "don't mention any" not in text
    assert "didn't need the closet bolt" in text
    assert "don't mention any" in writer_prompt(plan(record={"materials": []}), STYLES)
