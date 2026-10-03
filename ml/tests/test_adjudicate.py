"""#71: cross-family adjudication of the eval drafts (no human reviewer)."""

import json
import shutil
import subprocess

import pytest

from jobtrail_ml.adjudicate import (
    MAX_CMDLINE,
    REVIEWERS,
    adjudication_stats,
    aggregate,
    apply_overrides,
    batches,
    check_vote_file,
    check_votes,
    cmdline_cost,
    contested,
    prompt,
    reasons,
    review_items,
    vote_schema,
)
from jobtrail_ml.freeze import draft_hash

GOLD = {"jobType": "plumbing", "workPerformed": ["Replaced P-trap"], "issuesFound": [],
        "materials": [{"name": "PVC P-trap kit", "quantity": 1, "unit": "kit"}],
        "laborMinutes": 90, "customerApproved": True, "followUps": []}  # fmt: skip


def draft(i, split="test", flags=(), gold=GOLD):
    return {"id": f"{split[0]}-{i:04d}", "note": f"note {i}", "gold": gold, "source": "synthetic",
            "tags": ["negation"], "verified": False,
            "meta": {"split": split, "flags": list(flags)}}  # fmt: skip


def panel_for(drafts, problems=None):
    problems = problems or {}
    return {m: {d["id"]: {"ok": not problems.get((m, d["id"])),
                          "problems": problems.get((m, d["id"]), [])} for d in drafts}
            for m in ("sonnet", "opus", "fable")}  # fmt: skip


def test_items_carry_flags_and_deduplicated_panel_problems_in_split_then_id_order():
    ds = [draft(2), draft(1, "dev"), draft(1, flags=["crosscheck:laborMinutes"])]
    issue = [{"field": "workPerformed", "issue": "fix missing"}]
    panel = panel_for(ds, {("sonnet", "t-0001"): issue, ("opus", "t-0001"): issue})
    items = review_items(ds, panel)
    assert [i["id"] for i in items] == ["t-0001", "t-0002", "d-0001"]
    assert items[0]["concerns"] == ["automated check: crosscheck:laborMinutes",
                                    "reviewer note on workPerformed: fix missing"]  # fmt: skip
    assert items[0]["draft_key"] == GOLD and "meta" not in items[0]
    assert reasons(ds[2], panel) == ["fidelity", "panel"] and reasons(ds[0], panel) == []


def test_batches_keep_order_and_stay_under_the_command_line_cap():
    items = [{"id": f"t-{i:04d}", "note": "x" * 1500, "draft_key": GOLD, "concerns": []}
             for i in range(40)]  # fmt: skip
    got = batches(items, "rules")
    assert [i["id"] for b in got for i in b] == [i["id"] for i in items]
    assert all(len(b) <= 12 and cmdline_cost(prompt("rules", b)) <= MAX_CMDLINE for b in got)
    with pytest.raises(ValueError, match="alone makes a prompt"):
        batches([{"id": "t-9", "note": "x" * MAX_CMDLINE}], "rules")


def test_cmdline_cost_counts_escaped_quotes_and_backslashes():
    assert cmdline_cost('a"b\\c') == 7


def vote(i, action, gold=None, comment=""):
    return {"id": i, "action": action, "gold": gold, "comment": comment}


def test_check_votes_wants_one_valid_vote_per_item():
    ids = ["t-0001", "t-0002"]
    ok = [vote("t-0001", "accept"), vote("t-0002", "edit", {**GOLD, "laborMinutes": 60})]
    assert set(check_votes(ids, "gpt", ok)) == set(ids)
    with pytest.raises(ValueError, match="no vote for t-0002"):
        check_votes(ids, "gpt", ok[:1])
    with pytest.raises(ValueError, match="duplicate"):
        check_votes(ids, "gpt", [*ok, ok[0]])
    with pytest.raises(ValueError, match="not an item"):
        check_votes(ids, "gpt", [*ok, vote("t-0003", "accept")])
    with pytest.raises(ValueError, match="edit without a valid"):
        check_votes(ids, "gpt", [ok[0], vote("t-0002", "edit", {**GOLD, "laborMinutes": -1})])
    with pytest.raises(ValueError, match="accept must have gold null"):
        check_votes(ids, "gpt", [vote("t-0001", "accept", GOLD), ok[1]])


def test_vote_schema_is_strict_and_embeds_schema_v2():
    s = vote_schema()
    item = s["properties"]["decisions"]["items"]
    assert item["required"] == ["id", "action", "gold", "comment"]
    assert item["additionalProperties"] is False
    record = item["properties"]["gold"]["anyOf"][0]
    assert "$schema" not in record and record["required"][0] == "jobType"


def lower_agree(pairs):
    """Stand-in for the scorer: keys agree when equal ignoring case of list items."""
    norm = lambda g: json.dumps(g).lower()  # noqa: E731
    return [norm(a) == norm(b) for a, b in pairs]


def decide(d, gpt, gemini, claude, agree=lower_agree):
    votes = {"gpt": {d["id"]: gpt}, "gemini": {d["id"]: gemini}, "claude": {d["id"]: claude}}
    return aggregate([d], votes, agree, {d["id"]: []}, "2026-10-02T00:00:00Z")[0]


D = draft(1)
EDIT_A = {**GOLD, "workPerformed": ["Replaced P-trap", "Sealed joint"]}
EDIT_A_REWORDED = {**GOLD, "workPerformed": ["replaced p-trap", "sealed joint"]}
EDIT_B = {**GOLD, "laborMinutes": 60}


def test_two_accepts_keep_the_draft_key():
    x = decide(D, vote(D["id"], "accept"), vote(D["id"], "edit", EDIT_B), vote(D["id"], "accept"))
    assert (x["action"], x["gold"]) == ("accept", GOLD)
    assert x["draftHash"] == draft_hash(D) and x["method"] == "adjudicated"
    assert {r: v["agreesWithKey"] for r, v in x["votes"].items()} == {
        "gpt": True, "gemini": False, "claude": True}  # fmt: skip


def test_an_edit_the_scorer_cannot_tell_from_the_draft_counts_as_agreeing_with_it():
    reworded = {**GOLD, "workPerformed": ["replaced p-trap"]}
    x = decide(D, vote(D["id"], "edit", reworded), vote(D["id"], "accept"), vote(D["id"], "reject"))
    assert (x["action"], x["gold"]) == ("accept", GOLD)


def test_two_agreeing_edits_replace_the_key_with_the_first_in_reviewer_order():
    x = decide(D, vote(D["id"], "accept"), vote(D["id"], "edit", EDIT_A_REWORDED),
               vote(D["id"], "edit", EDIT_A))  # fmt: skip
    assert (x["action"], x["gold"]) == ("edit", EDIT_A_REWORDED)
    assert x["votes"]["claude"]["agreesWithKey"] and not x["votes"]["gpt"]["agreesWithKey"]


def test_two_rejects_reject_and_say_why():
    x = decide(D, vote(D["id"], "reject", comment="two times stated"), vote(D["id"], "accept"),
               vote(D["id"], "reject", comment="contradicts itself"))  # fmt: skip
    assert (x["action"], x["gold"]) == ("reject", None)
    assert x["comment"] == "rejected by gpt: two times stated; claude: contradicts itself"


def test_no_majority_rejects_the_note():
    x = decide(D, vote(D["id"], "edit", EDIT_A), vote(D["id"], "edit", EDIT_B),
               vote(D["id"], "reject"))  # fmt: skip
    assert (x["action"], x["comment"]) == ("reject", "no two reviewers agree on a key")


def test_agreement_needs_both_directions_and_the_checker_is_called_once():
    calls = []

    def one_way(pairs):
        calls.append(len(pairs))
        return [a is GOLD for a, _ in pairs]  # only "draft as gold" agrees

    x = decide(D, vote(D["id"], "edit", EDIT_A), vote(D["id"], "edit", EDIT_B),
               vote(D["id"], "accept"), agree=one_way)  # fmt: skip
    assert x["action"] == "reject" and len(calls) == 1


def test_stats_count_votes_support_and_unresolved():
    ds = [draft(1), draft(2), draft(3)]
    v = {"gpt": {}, "gemini": {}, "claude": {}}
    for d in ds:
        for r in v:
            v[r][d["id"]] = vote(d["id"], "accept")
    v["gpt"]["t-0002"] = vote("t-0002", "edit", EDIT_A)
    v["gemini"]["t-0003"], v["claude"]["t-0003"] = (vote("t-0003", "edit", EDIT_A),
                                                     vote("t-0003", "edit", EDIT_B))  # fmt: skip
    v["gpt"]["t-0003"] = vote("t-0003", "reject")
    decs = aggregate(ds, v, lower_agree, {d["id"]: [] for d in ds}, "2026-10-02")
    s = adjudication_stats(decs)
    assert s["votes"]["gpt"] == {"accept": 1, "edit": 1, "reject": 1}
    assert s["finalKeySupport"] == {"2/3": 1, "3/3": 1}
    assert s["unresolved"] == 1


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node >= 24 for the scorer")
def test_zero_edit_agreement_comes_from_the_core_scorer():
    version = subprocess.run(["node", "--version"], capture_output=True, text=True).stdout
    if int(version.lstrip("v").split(".")[0]) < 24:
        pytest.skip("scorer needs node >= 24")
    from jobtrail_ml.scorer import zero_edit

    worded = {**GOLD, "workPerformed": ["Replaced the P-trap"]}
    assert zero_edit([(GOLD, worded), (GOLD, EDIT_B), (GOLD, GOLD)]) == [True, False, True]


def test_an_override_changes_a_decision_and_keeps_what_it_was():
    x = decide(
        D, vote(D["id"], "edit", EDIT_B), vote(D["id"], "edit", EDIT_B), vote(D["id"], "accept")
    )
    assert x["action"] == "edit"
    apply_overrides([x], [{"id": D["id"], "action": "accept", "reason": "rule"}], [D])
    assert (x["action"], x["gold"]) == ("accept", GOLD)
    assert x["override"] == {"reason": "rule", "was": {"action": "edit", "gold": EDIT_B}}


def test_the_committed_batch_manifest_names_the_reviewers_used():
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "data/review/adjudication/batches.json"
    assert json.loads(path.read_text(encoding="utf-8"))["reviewers"] == REVIEWERS


def test_a_vote_file_must_match_its_reviewer_model_batch_and_prompt():
    meta = {"reviewer": "gemini", "model": REVIEWERS["gemini"], "batch": "b01",
            "prompt_sha256": "abc"}  # fmt: skip
    check_vote_file(meta, "gemini", "b01", "abc")
    for bad in ({"reviewer": "claude"}, {"model": "other"}, {"batch": "b02"},
                {"prompt_sha256": "stale"}):  # fmt: skip
        with pytest.raises(ValueError, match="vote file has"):
            check_vote_file({**meta, **bad}, "gemini", "b01", "abc")
    with pytest.raises(ValueError, match="vote file has"):  # Gemini's file in Claude's folder
        check_vote_file(meta, "claude", "b01", "abc")


def test_two_agreeing_reviewers_settle_a_draft_without_the_tiebreaker():
    votes = {"gemini": {D["id"]: vote(D["id"], "accept")},
             "claude": {D["id"]: vote(D["id"], "accept")}}  # fmt: skip
    x = aggregate([D], votes, lower_agree, {D["id"]: []}, "2026-10-02")[0]
    assert x["action"] == "accept" and set(x["votes"]) == {"gemini", "claude"}


def test_contested_lists_only_drafts_the_first_two_reviewers_leave_open():
    ds = [draft(1), draft(2), draft(3)]
    v = {"gemini": {}, "claude": {}}
    for d in ds:
        v["gemini"][d["id"]] = vote(d["id"], "accept")
        v["claude"][d["id"]] = vote(d["id"], "accept")
    v["claude"]["t-0002"] = vote("t-0002", "edit", EDIT_B)  # 1 accept vs 1 edit: open
    v["gemini"]["t-0003"] = vote("t-0003", "reject")
    v["claude"]["t-0003"] = vote("t-0003", "reject")  # two rejects: settled
    assert contested(ds, v, lower_agree) == ["t-0002"]


def test_a_tiebreak_vote_decides_and_is_counted():
    ds = [draft(1), draft(2)]
    v = {"gpt": {"t-0002": vote("t-0002", "edit", EDIT_B)}, "gemini": {}, "claude": {}}
    for d in ds:
        v["gemini"][d["id"]] = vote(d["id"], "accept")
        v["claude"][d["id"]] = vote(d["id"], "accept")
    v["claude"]["t-0002"] = vote("t-0002", "edit", EDIT_B)
    decs = aggregate(ds, v, lower_agree, {d["id"]: [] for d in ds}, "2026-10-02")
    assert [(x["action"], x["gold"]) for x in decs] == [("accept", GOLD), ("edit", EDIT_B)]
    s = adjudication_stats(decs)
    assert s["tiebreaks"] == 1 and s["finalKeySupport"] == {"2/2": 1, "2/3": 1}
