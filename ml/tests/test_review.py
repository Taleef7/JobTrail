"""#71: review queue = flagged drafts + drafts any panelist questioned + a seeded audit."""

import pytest

from jobtrail_ml.review import MODELS, build_queue, queue_summary


def draft(i, split="test", flags=()):
    return {"id": f"{split[0]}-{i:04d}", "note": f"note {i}", "gold": {"jobType": "plumbing"},
            "source": "synthetic", "tags": [], "verified": False,
            "meta": {"split": split, "flags": list(flags)}}  # fmt: skip


def verdicts(ids, bad=None):
    """Every panelist says ok for every id, except bad = {model: {id: [problems]}}."""
    bad = bad or {}
    return {m: {i: {"id": i, "ok": i not in bad.get(m, {}), "problems": bad.get(m, {}).get(i, [])}
                for i in ids} for m in MODELS}  # fmt: skip


DRAFTS = [draft(1, flags=["crosscheck:materials"]), draft(2), draft(3), draft(4), draft(1, "dev")]
IDS = [d["id"] for d in DRAFTS]


def test_flagged_and_panel_questioned_drafts_are_queued_with_reasons():
    problem = [{"field": "laborMinutes", "issue": "note says 45, key says 40"}]
    q = build_queue(DRAFTS, verdicts(IDS, {"opus": {"t-0002": problem}}), audit_n=0, seed=1)
    by_id = {x["id"]: x for x in q}
    assert set(by_id) == {"t-0001", "t-0002"}
    assert by_id["t-0001"]["reasons"] == ["fidelity"]
    assert by_id["t-0002"]["reasons"] == ["panel"]
    assert by_id["t-0002"]["panel"] == [{"model": "opus", "problems": problem}]
    assert by_id["t-0001"]["flags"] == ["crosscheck:materials"]


def test_audit_samples_only_clean_drafts_reproducibly():
    q1 = build_queue(DRAFTS, verdicts(IDS), audit_n=2, seed=7)
    q2 = build_queue(DRAFTS, verdicts(IDS), audit_n=2, seed=7)
    audit = [x["id"] for x in q1 if x["reasons"] == ["audit"]]
    assert audit == [x["id"] for x in q2 if x["reasons"] == ["audit"]]
    assert len(audit) == 2 and "t-0001" not in audit  # t-0001 is flagged, not clean


def test_queue_items_carry_what_the_reviewer_needs_in_split_then_id_order():
    q = build_queue(DRAFTS, verdicts(IDS), audit_n=10, seed=1)
    assert [x["id"] for x in q] == ["t-0001", "t-0002", "t-0003", "t-0004", "d-0001"]
    item = q[1]
    assert set(item) == {"id", "split", "note", "gold", "tags", "flags", "panel", "reasons"}
    assert item["split"] == "test" and item["gold"] == {"jobType": "plumbing"}


def test_a_missing_panel_verdict_is_an_error():
    panel = verdicts(IDS)
    del panel["fable"]["t-0003"]
    with pytest.raises(ValueError, match="fable.*t-0003"):
        build_queue(DRAFTS, panel, audit_n=0, seed=1)


def test_summary_counts_by_reason_and_split():
    problem = [{"field": "note", "issue": "ambiguous"}]
    q = build_queue(DRAFTS, verdicts(IDS, {"sonnet": {"t-0001": problem}}), audit_n=1, seed=3)
    s = queue_summary(DRAFTS, q)
    assert s["drafts"] == 5 and s["queued"] == 2
    assert s["by_reason"] == {"fidelity": 1, "panel": 1, "audit": 1}
    assert s["clean"] == 4 and s["audit"] == 1


def test_a_verdict_for_an_unknown_draft_is_an_error():
    panel = verdicts([*IDS, "t-9999"])
    with pytest.raises(ValueError, match="unknown drafts t-9999"):
        build_queue(DRAFTS, panel, audit_n=0, seed=1)
