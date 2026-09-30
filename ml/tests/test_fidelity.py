"""#70: fidelity flags point the #71 reviewer at notes that may not say what the plan says."""

import copy

from jobtrail_ml.fidelity import crosscheck_flags, note_flags, numbers_in_text

PLAN = {
    "id": "t-0001",
    "trade": "plumbing",
    "tags": ["self-correction", "negation", "supply-house-trip"],
    "record": {
        "jobType": "plumbing",
        "workPerformed": ["Replaced toilet wax ring", "Picked up wax ring at the supply house"],
        "issuesFound": [],
        "materials": [
            {"name": "wax ring", "quantity": 1, "unit": None},
            {"name": "closet bolt", "quantity": 2, "unit": None},
        ],
        "laborMinutes": 45,
        "customerApproved": True,
        "followUps": [],
    },
    "meta": {
        "labor": {"phrasing": "minutes"},
        "correction": {"field": "material", "name": "closet bolt", "wrong": 3, "right": 2},
        "negation": {"kind": "material", "item": "toilet supply line"},
        "supply": "wax ring",
    },
}
NOTE = (
    "Ran to the supply house for a wax ring, swapped it in with three, no two closet bolts. "
    "Didn't need the toilet supply line. 45 minutes, customer signed off."
)


def with_(fn):
    p = copy.deepcopy(PLAN)
    fn(p)
    return p


def test_numbers_in_text():
    assert {1, 2, 3, 45} <= numbers_in_text("a ring, three, no two bolts. 45 minutes")
    assert 1.5 in numbers_in_text("an hour and a half")


def test_faithful_note_has_no_flags():
    assert note_flags(PLAN, NOTE) == []


def test_missing_material_quantity_and_correction():
    note = "Supply house run. Swapped the ring. 45 minutes, customer signed off. Didn't need the toilet supply line."  # noqa: E501
    flags = note_flags(PLAN, note)
    assert "material-not-in-note:closet bolt" in flags
    assert "quantity-not-in-note:closet bolt=2" in flags
    assert "correction-missing" in flags


def test_hours_phrasing_leak_and_minutes_missing():
    p = with_(lambda p: (p["meta"].update(labor={"phrasing": "hours"}),
                         p["record"].update(laborMinutes=90)))  # fmt: skip
    assert "labor-minutes-leaked" in note_flags(p, NOTE.replace("45 minutes", "90 minutes"))
    assert "labor-minutes-leaked" not in note_flags(
        p, NOTE.replace("45 minutes", "hour and a half")
    )  # noqa: E501
    assert "labor-not-in-note" in note_flags(PLAN, NOTE.replace("45 minutes", "a while"))


def test_extra_labor_parts_present_total_absent():
    def setup(p):
        p["meta"]["labor"] = {"phrasing": "base+extra", "base": 30, "extra": 15,
                              "extra_task": "Cleared floor drain"}  # fmt: skip
        p["record"]["laborMinutes"] = 45

    p = with_(setup)
    good = NOTE.replace("45 minutes", "30 minutes, then another 15 minutes clearing the drain")
    assert not [f for f in note_flags(p, good) if f.startswith("labor")]
    assert "labor-total-leaked" in note_flags(p, good + " 45 total.")


def test_approval_flags():
    silent = with_(lambda p: p["record"].update(customerApproved=None))
    assert "approval-mentioned" in note_flags(silent, NOTE)
    assert "approval-missing" in note_flags(PLAN, NOTE.replace("customer signed off", "done"))


def test_negation_and_supply_missing():
    note = NOTE.replace("Didn't need the toilet supply line. ", "").replace(
        "Ran to the supply house for a wax ring", "Had a wax ring"
    )
    flags = note_flags(PLAN, note)
    assert "negation-missing" in flags and "supply-missing" in flags


def test_crosscheck_agreement_and_disagreement():
    assert crosscheck_flags(PLAN["record"], copy.deepcopy(PLAN["record"])) == []
    other = copy.deepcopy(PLAN["record"])
    other["materials"][1]["quantity"] = 3  # took the slip, not the correction
    other["laborMinutes"] = 60
    other["materials"].append({"name": "toilet supply line", "quantity": 1, "unit": None})
    flags = crosscheck_flags(PLAN["record"], other)
    assert "crosscheck:laborMinutes" in flags
    assert "crosscheck:quantity:closet bolt" in flags
    assert "crosscheck:materials-count" in flags
    assert crosscheck_flags(PLAN["record"], None) == ["crosscheck:invalid"]


def test_common_approval_phrasings_count_as_mentioned():
    """Pilot 2 (#70): 'gave the go-ahead' was wrongly flagged approval-missing."""
    for said in ["customer gave the go-ahead", "client gave the all clear",
                 "homeowner gave it the green light", "customer signed off"]:  # fmt: skip
        assert "approval-missing" not in note_flags(PLAN, NOTE.replace("customer signed off", said))


def test_rejection_and_thumb_up_count_as_mentioned():
    """Full run (#70): 'Customer rejected the work' and 'gave me the thumb up' were missed."""
    declined = with_(lambda p: p["record"].update(customerApproved=False))
    note = NOTE.replace("customer signed off", "Customer rejected the work")
    assert "approval-missing" not in note_flags(declined, note)
    thumb = NOTE.replace("customer signed off", "homeowner gave me the thumb up")
    assert "approval-missing" not in note_flags(PLAN, thumb)


def test_being_happy_is_not_approval():
    """LABELING.md: true needs an explicit yes; 'was happy with the work' is sentiment."""
    happy = NOTE.replace("customer signed off", "customer was happy with the work")
    assert "approval-missing" in note_flags(PLAN, happy)


def test_units_are_checked_in_note_and_crosscheck():
    """Codex #105: a note could drop 'feet' and still come back clean."""
    p = with_(lambda p: p["record"]["materials"].__setitem__(
        1, {"name": "closet bolt", "quantity": 2, "unit": "box"}))  # fmt: skip
    assert "unit-not-in-note:closet bolt=box" in note_flags(p, NOTE)
    assert "unit-not-in-note:closet bolt=box" not in note_flags(
        p, NOTE.replace("two closet bolts", "two boxes of closet bolts")
    )
    other = copy.deepcopy(p["record"])
    other["materials"][1]["unit"] = None
    assert "crosscheck:unit:closet bolt" in crosscheck_flags(p["record"], other)
    plural = copy.deepcopy(p["record"])
    plural["materials"][1]["unit"] = "boxes"
    assert crosscheck_flags(p["record"], plural) == []


def test_material_correction_is_checked_even_in_hours_notes():
    """Codex #105: hours-phrasing suppressed the check for material corrections too."""
    p = with_(lambda p: (p["meta"].update(labor={"phrasing": "hours"}),
                         p["record"].update(laborMinutes=60)))  # fmt: skip
    note = NOTE.replace("three, no two", "two").replace("45 minutes", "an hour")
    assert "correction-missing" in note_flags(p, note)
    hours_fix = with_(lambda p: (p["meta"].update(
        labor={"phrasing": "hours"},
        correction={"field": "labor", "name": None, "wrong": 90, "right": 60}),
        p["record"].update(laborMinutes=60)))  # fmt: skip
    assert "correction-missing" not in note_flags(hours_fix, NOTE.replace("45 minutes", "an hour"))


def test_crosscheck_compares_list_contents_not_just_counts():
    """Codex #105 round 2: a different task with the same count passed clean."""
    other = copy.deepcopy(PLAN["record"])
    other["workPerformed"] = ["Replaced kitchen faucet", PLAN["record"]["workPerformed"][1]]
    flags = crosscheck_flags(PLAN["record"], other)
    assert "crosscheck:workPerformed-missing:Replaced toilet wax ring" in flags
    assert "crosscheck:workPerformed-count" not in flags
    reworded = copy.deepcopy(PLAN["record"])
    reworded["workPerformed"] = ["Replaced the wax ring on the toilet",
                                 "Picked up a wax ring at the supply house"]  # fmt: skip
    assert crosscheck_flags(PLAN["record"], reworded) == []
