"""#71 step 2: apply the owner's decisions to the drafts and freeze test/dev."""

import pytest

from jobtrail_ml.freeze import apply_decisions, draft_hash, review_stats, wilson

GOLD = {"jobType": "plumbing", "workPerformed": ["Replaced P-trap"], "issuesFound": [],
        "materials": [{"name": "PVC P-trap kit", "quantity": 1, "unit": "kit"}],
        "laborMinutes": 90, "customerApproved": True, "followUps": []}  # fmt: skip


def draft(i, split="test", gold=GOLD):
    return {"id": f"{split[0]}-{i:04d}", "note": f"note {i}", "gold": gold, "source": "synthetic",
            "tags": ["negation"], "verified": False,
            "meta": {"split": split, "flags": []}}  # fmt: skip


def decision(d, action, gold=None, comment="", method="adjudicated", reasons=()):
    return {"id": d["id"], "split": d["meta"]["split"], "action": action,
            "gold": gold if action == "edit" else (None if action == "reject" else d["gold"]),
            "comment": comment, "reviewedAt": "2026-10-02T00:00:00Z",
            "draftHash": draft_hash(d), "draft": d["gold"], "method": method,
            "reasons": list(reasons)}  # fmt: skip


def test_draft_hash_matches_the_label_page():
    # Values computed by apps/web/src/label/label.ts draftHash (FNV-1a over UTF-16 units).
    note = 'Café ½ — 🙂 "q"'
    gold = {"jobType": None, "workPerformed": ["Fixed tap"], "issuesFound": [],
            "materials": [{"name": "wax ring", "quantity": 1.5, "unit": None}],
            "laborMinutes": 90, "customerApproved": False, "followUps": []}  # fmt: skip
    assert draft_hash({"note": note, "gold": gold}) == "03e91ceb"


def test_draft_hash_uses_schema_key_order_not_dict_order():
    shuffled = dict(reversed(list(GOLD.items())))
    assert draft_hash({"note": "n", "gold": shuffled}) == draft_hash({"note": "n", "gold": GOLD})


D = [draft(1), draft(2), draft(3), draft(4), draft(1, "dev")]


def test_applies_accept_edit_reject_with_adjudicated_provenance():
    edited = {**GOLD, "laborMinutes": 60}
    votes = {
        "gpt": {"action": "edit"},
        "gemini": {"action": "edit"},
        "claude": {"action": "accept"},
    }
    decs = [decision(D[0], "accept", reasons=["fidelity"]),
            {**decision(D[1], "edit", edited), "votes": votes},
            decision(D[2], "reject", comment="ambiguous"),
            decision(D[3], "accept"), decision(D[4], "accept")]  # fmt: skip
    out = apply_decisions(D, decs)
    test = {r["id"]: r for r in out["test"]}
    assert set(test) == {"t-0001", "t-0002", "t-0004"}  # t-0003 rejected
    assert test["t-0001"]["verified"] is False
    assert test["t-0001"]["review"] == {"method": "adjudicated", "action": "accept",
                                        "reasons": ["fidelity"],
                                        "reviewedAt": "2026-10-02T00:00:00Z"}  # fmt: skip
    assert test["t-0002"]["gold"] == edited
    assert test["t-0002"]["review"]["votes"] == {
        "gpt": "edit",
        "gemini": "edit",
        "claude": "accept",
    }
    assert set(test["t-0001"]) == {"id", "note", "gold", "source", "tags", "verified", "review"}
    assert [r["id"] for r in out["dev"]] == ["d-0001"]
    assert out["rejected"] == [{"id": "t-0003", "split": "test", "comment": "ambiguous"}]


def test_an_override_reason_is_kept_in_the_record():
    decs = [decision(d, "accept") for d in D]
    decs[0]["override"] = {"reason": "supply-house rule", "was": {"action": "edit", "gold": GOLD}}
    out = apply_decisions(D, decs)
    assert out["test"][0]["review"]["override"] == "supply-house rule"


def test_only_a_human_decision_makes_a_record_verified():
    decs = [decision(d, "accept", method="human" if i == 0 else "adjudicated")
            for i, d in enumerate(D)]  # fmt: skip
    out = apply_decisions(D, decs)
    assert [r["verified"] for r in out["test"]] == [True, False, False, False]


def test_refuses_missing_duplicate_stale_or_unknown_decisions():
    ok = [decision(d, "accept") for d in D]
    with pytest.raises(ValueError, match="no decision for t-0004"):
        apply_decisions(D, ok[:3] + ok[4:])
    with pytest.raises(ValueError, match="duplicate decision t-0001"):
        apply_decisions(D, [*ok, ok[0]])
    stale = {**ok[1], "draftHash": "deadbeef"}
    with pytest.raises(ValueError, match="t-0002.*changed since it was reviewed"):
        apply_decisions(D, [ok[0], stale, *ok[2:]])
    with pytest.raises(ValueError, match="t-0099 is not a draft"):
        apply_decisions(D, [*ok, {**ok[0], "id": "t-0099"}])
    with pytest.raises(ValueError, match="unknown review method"):
        apply_decisions(D, [{**ok[0], "method": "vibes"}, *ok[1:]])


def test_refuses_an_edited_key_that_is_not_valid_schema_v2():
    bad = decision(D[0], "edit", {**GOLD, "laborMinutes": -5})
    with pytest.raises(ValueError, match="t-0001.*laborMinutes"):
        apply_decisions(D, [bad, *(decision(d, "accept") for d in D[1:])])


def test_stats_report_outcomes_by_reason_and_how_often_clean_drafts_changed():
    decs = [
        decision(
            D[0], "edit", {**GOLD, "followUps": ["Check leaks"]}, reasons=["fidelity", "panel"]
        ),
        decision(D[1], "accept"),
        decision(D[2], "edit", {**GOLD, "laborMinutes": 45}),
        decision(D[3], "reject", comment="ambiguous"),
        decision(D[4], "accept", method="human"),
    ]
    s = review_stats(D, decs)
    assert (s["accepted"], s["edited"], s["rejected"]) == (2, 2, 1)
    assert s["by_reason"]["clean"] == {"n": 4, "accept": 2, "edit": 1, "reject": 1}
    assert s["by_reason"]["fidelity"] == {"n": 1, "accept": 0, "edit": 1, "reject": 0}
    assert s["clean_changed"]["k"] == 2 and s["clean_changed"]["n"] == 4
    assert s["fields_edited"] == {"followUps": 1, "laborMinutes": 1}
    assert s["methods"] == {"adjudicated": 4, "human": 1}


def test_wilson_interval():
    lo, hi = wilson(0, 30)
    assert lo == 0 and 0.11 < hi < 0.12
    lo, hi = wilson(3, 30)
    assert 0.03 < lo < 0.04 and 0.25 < hi < 0.27


def test_check_frozen_catches_edits_count_drift_overlap_and_bad_provenance(tmp_path):
    import hashlib
    import json

    from jobtrail_ml.freeze import check_frozen

    rec = {"id": "t-0001", "note": "n", "gold": GOLD, "source": "synthetic", "tags": [],
           "verified": True, "review": {"method": "human", "action": "accept"}}  # fmt: skip
    dev = {**rec, "id": "d-0001", "verified": False, "review": {"method": "panel"}}

    def write(test_rows, dev_rows, frozen_counts=None):
        for name, rows in (("test.jsonl", test_rows), ("dev.jsonl", dev_rows)):
            (tmp_path / name).write_text("".join(json.dumps(r) + "\n" for r in rows))
        table = "\n".join(
            f"| `data/{n}` |   {c} | `{hashlib.sha256((tmp_path / n).read_bytes()).hexdigest()}` |"
            for n, c in (
                frozen_counts or {"test.jsonl": len(test_rows), "dev.jsonl": len(dev_rows)}
            ).items()  # fmt: skip
        )
        (tmp_path / "FROZEN.md").write_text(
            f"| File | Records | SHA-256 |\n| --- | ---: | --- |\n{table}\n"
        )

    write([rec], [dev])
    assert check_frozen(tmp_path) == []

    (tmp_path / "test.jsonl").write_text(json.dumps({**rec, "note": "edited"}) + "\n")
    assert check_frozen(tmp_path) == ["data/test.jsonl changed since it was frozen"]

    write([rec], [dev], {"test.jsonl": 2, "dev.jsonl": 1})
    assert check_frozen(tmp_path) == ["data/test.jsonl: 1 records, FROZEN.md says 2"]

    write([rec], [{**dev, "id": "t-0001"}])
    assert "t-0001 is in both data/test.jsonl and data/dev.jsonl" in check_frozen(tmp_path)

    write([{**rec, "verified": False}], [dev])
    assert check_frozen(tmp_path) == ["t-0001: verified must be true exactly for human review"]
