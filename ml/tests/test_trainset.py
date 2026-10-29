"""#74: the training set. Held-out templates never reach training, test and dev plans
don't move, the filter keeps only notes both labelers read back as the plan, and the
leakage check drops near-duplicates of eval notes."""

import hashlib
import json
from collections import Counter
from pathlib import Path

import pytest

from jobtrail_ml import trainset
from jobtrail_ml.sampler import load_scenarios, plan_split, plan_splits

ROOT = Path(__file__).resolve().parents[2]
SCENARIOS = load_scenarios(ROOT / "data/scenarios.yaml")
CONFIG = trainset.load_config(ROOT / "data/train/config.yaml")


def test_the_eval_plans_did_not_move():
    # data/drafts/plan.jsonl is what #70 drafted test and dev from; the sampler's new
    # options must leave it byte-identical.
    plans = plan_splits(SCENARIOS, seed=70, counts={"test": 165, "dev": 110})
    text = "".join(json.dumps(p, ensure_ascii=False) + "\n" for p in plans)
    manifest = json.loads((ROOT / "data/drafts/manifest.json").read_text(encoding="utf-8"))
    want = manifest["sha256"]["data/drafts/plan.jsonl"]
    assert hashlib.sha256(text.encode()).hexdigest() == want


def test_one_template_per_trade_is_held_out_and_it_is_stable():
    held = trainset.holdout(SCENARIOS, CONFIG["holdout_seed"])
    assert set(held) == set(SCENARIOS["trades"])
    mains = {j["work"][0] for t in SCENARIOS["trades"].values() for j in t}
    assert set(held.values()) <= mains
    assert held == trainset.holdout(SCENARIOS, CONFIG["holdout_seed"])
    assert held == CONFIG["holdout"]  # committed, so a change shows up in review


def test_training_plans_use_only_training_templates_and_never_an_eval_record():
    plans = trainset.plan_train(SCENARIOS, CONFIG, n=600)
    held = set(CONFIG["holdout"].values())
    assert not [p for p in plans if p["record"]["workPerformed"][0] in held]
    evals = {
        json.dumps(json.loads(line)["gold"], sort_keys=True)
        for split in ("test", "dev")
        for line in (ROOT / f"data/{split}.jsonl").read_text(encoding="utf-8").splitlines()
    }
    assert not [p for p in plans if json.dumps(p["record"], sort_keys=True) in evals]
    assert len({p["id"] for p in plans}) == 600 and plans[0]["id"] == "tr-0001"
    assert plans == trainset.plan_train(SCENARIOS, CONFIG, n=600)


def test_a_longer_plan_starts_with_the_shorter_one():
    # The pilot is the first 150 of the full plan, so scaling up never redraws it.
    assert (
        trainset.plan_train(SCENARIOS, CONFIG, n=150)
        == trainset.plan_train(SCENARIOS, CONFIG, n=600)[:150]
    )


def test_tag_weights_shift_the_mix():
    even = plan_split(SCENARIOS, 74, "train", 900)
    weighted = plan_split(SCENARIOS, 74, "train", 900, weights={"self-correction": 3})
    count = lambda ps: Counter(t for p in ps for t in p["tags"])  # noqa: E731
    assert count(weighted)["self-correction"] > 1.5 * count(even)["self-correction"]


def test_held_out_slice_of_the_eval_sets():
    rows = [json.loads(x) for x in (ROOT / "data/dev.jsonl").read_text("utf-8").splitlines()]
    ids = trainset.held_out_ids(rows, CONFIG["holdout"])
    held = set(CONFIG["holdout"].values())
    assert ids == {r["id"] for r in rows if r["gold"]["workPerformed"][0] in held}
    assert 0 < len(ids) < len(rows)


REC = {"jobType": "plumbing", "workPerformed": ["Replaced P-trap"], "issuesFound": [],
       "materials": [], "laborMinutes": 30, "customerApproved": True, "followUps": []}  # fmt: skip


def _same(pairs):
    return [json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True) for a, b in pairs]


PLAN = {"jobType": "painting", "workPerformed": ["Cleaned post-renovation dust"],
        "issuesFound": [], "laborMinutes": 70, "customerApproved": True, "followUps": [],
        "materials": [{"name": "tile cleaner", "quantity": 2, "unit": "bottle"},
                      {"name": "grout sealer", "quantity": 1, "unit": "bottle"}]}  # fmt: skip
# The note's own words ("tile wash"), as a labeler reads them: the target keeps them.
WORDED = {**PLAN, "workPerformed": ["Wiped down post-remodel dust"],
          "materials": [{"name": "sealer", "quantity": 1, "unit": "bottles"},
                        {"name": "tile wash", "quantity": 2, "unit": "bottle"}]}  # fmt: skip


def test_the_target_is_the_agreed_label_in_the_notes_own_words():
    out = trainset.decide([{"id": "a", "labels": {"g": WORDED, "o": WORDED}}],
                          {"a": PLAN}, ["g", "o"], _same)  # fmt: skip
    assert out["a"] == {"reason": None, "target": WORDED, "contradicts": []}


def test_filter_drops_a_missing_or_invalid_label_disagreement_or_a_wrong_fact():
    mastic = {"name": "mastic", "quantity": None, "unit": None}
    extra_material = {**WORDED, "materials": [*WORDED["materials"], mastic]}
    rows = [
        {"id": "u", "labels": {"g": WORDED}},
        {"id": "i", "labels": {"g": WORDED, "o": None}},
        {"id": "d", "labels": {"g": WORDED, "o": {**WORDED, "laborMinutes": 45}}},
        {
            "id": "m",
            "labels": {"g": {**WORDED, "laborMinutes": 45}, "o": {**WORDED, "laborMinutes": 45}},
        },  # fmt: skip
        {"id": "x", "labels": {"g": extra_material, "o": extra_material}},
        {
            "id": "q",
            "labels": {
                "g": {**WORDED, "customerApproved": None},
                "o": {**WORDED, "customerApproved": None},
            },
        },  # fmt: skip
    ]
    out = trainset.decide(rows, {r["id"]: PLAN for r in rows}, ["g", "o"], _same)
    assert {k: v["reason"] for k, v in out.items()} == {
        "u": "unlabeled", "i": "invalid-label", "d": "labelers-disagree",
        "m": "contradicts-plan", "x": "contradicts-plan", "q": "contradicts-plan",
    }  # fmt: skip
    assert out["m"]["contradicts"] == ["laborMinutes"]
    assert out["x"]["contradicts"] == ["materials"]
    assert out["q"]["contradicts"] == ["customerApproved"]
    assert out["d"]["target"] is None


def test_plan_facts_ignore_wording_and_material_order_but_not_quantities():
    assert trainset.plan_contradictions(PLAN, WORDED) == []
    two = {"quantity": 2, "unit": "bottle"}
    swapped = {**WORDED, "materials": [{"name": "sealer", **two}, {"name": "tile wash", **two}]}
    assert trainset.plan_contradictions(PLAN, swapped) == ["materials"]


def test_a_narrated_material_install_may_be_its_own_task_but_a_planned_task_cant_vanish():
    # The eval gold lists "put in 1 new furnace filter" as a task (t-0121, d-0104), so a
    # label may add up to one task per planned material; losing a planned task is an error.
    plus_two = {**WORDED, "workPerformed": ["Wiped down dust", "Washed tile", "Sealed grout"]}
    assert trainset.plan_contradictions(PLAN, plus_two) == []  # 1 task + 2 materials
    plus_three = {**plus_two, "workPerformed": [*plus_two["workPerformed"], "Swept"]}
    assert trainset.plan_contradictions(PLAN, plus_three) == ["workPerformed"]
    none = {**WORDED, "workPerformed": []}
    assert trainset.plan_contradictions(PLAN, none) == ["workPerformed"]


def test_an_optional_plan_issue_may_be_left_out_but_not_invented():
    plan = {**PLAN, "issuesFound": ["Doorknob punched through the drywall"]}
    optional = {"Doorknob punched through the drywall"}
    assert trainset.plan_contradictions(plan, WORDED, optional) == []
    assert trainset.plan_contradictions(plan, WORDED) == ["issuesFound"]
    two = {**WORDED, "issuesFound": ["Hole", "Scuff"]}
    assert trainset.plan_contradictions(plan, two, optional) == ["issuesFound"]


def test_the_config_marks_the_doorknob_issue_optional():
    assert "Doorknob punched through the drywall" in CONFIG["optional_issues"]
    issues = {i for t in SCENARIOS["trades"].values() for j in t for i in j["issues"]}
    assert set(CONFIG["optional_issues"]) <= issues


NOTE = "replaced the kitchen sink p trap and tightened the supply line connections took 45 min"


def test_leakage_flags_a_near_copy_and_passes_an_unrelated_note():
    evals = [{"id": "t-1", "note": NOTE}]
    copy = NOTE.replace("45", "40")
    fresh = "mounted a tv bracket on the living room wall and ran the cables inside it today"
    hits = trainset.leakage([{"id": "x", "note": copy}, {"id": "y", "note": fresh}], evals)
    assert hits["x"]["near"] and hits["x"]["match"] == "t-1"
    assert not hits["y"]["near"]


def test_leakage_thresholds_sit_above_test_vs_dev_overlap():
    # Independently written eval notes set the bar: a training note is a near-duplicate
    # only if it's closer to an eval note than nearly all test/dev pairs are.
    t = trainset.LEAKAGE
    assert t["jaccard5"] == pytest.approx(0.2) and t["containment8"] == pytest.approx(0.3)


def test_the_committed_held_out_ids_match_the_templates():
    held = json.loads((ROOT / "data/train/heldout.json").read_text(encoding="utf-8"))
    assert held["templates"] == CONFIG["holdout"]
    for split in ("test", "dev"):
        rows = [
            json.loads(x) for x in (ROOT / f"data/{split}.jsonl").read_text("utf-8").splitlines()
        ]
        assert held[split] == sorted(trainset.held_out_ids(rows, CONFIG["holdout"]))
    assert (len(held["test"]), len(held["dev"])) == (49, 27)


def test_codex_schemas_are_closed_and_fully_required():
    from jobtrail_ml import codex, extract

    loose = extract.batch_schema({"type": "object", "properties": {"a": {"type": "string"}}})
    tight = codex.strict(loose)
    item = tight["properties"]["records"]["items"]
    assert item["additionalProperties"] is False and item["required"] == ["id", "record"]
    assert item["properties"]["record"]["required"] == ["a"]
    assert "additionalProperties" not in loose["properties"]["records"]["items"]  # not mutated


def _script():
    import importlib.util

    path = ROOT / "ml/scripts/gen_train_notes.py"
    spec = importlib.util.spec_from_file_location("gen_train_notes", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_label_shards_split_the_batches_for_good_and_wait_for_the_writer():
    g = _script()
    ps = [{"id": f"tr-{i:04d}"} for i in range(1, 76)]  # 5 batches of 15
    notes = {p["id"]: {} for p in ps[:62]}  # the writer is in batch 5
    firsts = {sh: [b[0]["id"] for b in g.label_batches(ps, notes, set(), sh)]
              for sh in ((1, 1), (1, 2), (2, 2))}  # fmt: skip
    assert firsts[(1, 1)] == ["tr-0001", "tr-0016", "tr-0031", "tr-0046"]  # not batch 5 yet
    assert sorted(firsts[(1, 2)] + firsts[(2, 2)]) == firsts[(1, 1)]
    assert not set(firsts[(1, 2)]) & set(firsts[(2, 2)])
    notes.pop("tr-0020")  # the writer skipped a note but has moved on: label the rest
    assert [len(b) for b in g.label_batches(ps, notes, set(), (1, 1))][1] == 14


def test_label_batches_resume_after_done_and_wait_for_the_last_batch():
    g = _script()
    ps = [{"id": f"tr-{i:04d}"} for i in range(1, 39)]  # batches of 15, 15 and 8
    notes = {p["id"]: {} for p in ps}
    done = {p["id"] for p in ps[:30]} - {"tr-0020"}  # batch 2 lost one label
    firsts = [b[0]["id"] for b in g.label_batches(ps, notes, done, (1, 1))]
    assert firsts == ["tr-0016", "tr-0031"]  # batch 2 is resent whole, batch 1 skipped
    notes.pop("tr-0038")  # the writer can't write the very last note
    assert [b[0]["id"] for b in g.label_batches(ps, notes, done, (1, 1))] == ["tr-0016"]
    last = g.label_batches(ps, notes, done, (1, 1), writer_done=True)
    assert [len(b) for b in last] == [15, 7]  # once the writer gave up, label the rest


def test_leakage_catches_a_short_note_cut_from_a_long_eval_note_and_picks_the_closest():
    long_eval = (
        NOTE + " and then hauled the old trap away swept up under the cabinet checked"
        " the shutoff valves for drips wiped down the floor and the customer signed off"
        " on the repair before we packed the van and headed to the next job"
    )
    slice_ = "the kitchen sink p trap and tightened the supply line connections"
    hits = trainset.leakage([{"id": "s", "note": slice_}],
                            [{"id": "far", "note": "painted the bedroom walls today"},
                             {"id": "near", "note": long_eval}])  # fmt: skip
    assert hits["s"]["near"] and hits["s"]["match"] == "near"
    assert hits["s"]["containment8"] == 1.0 and hits["s"]["jaccard5"] < trainset.LEAKAGE["jaccard5"]


def test_the_writer_gives_up_on_a_plan_after_three_tries_and_then_the_stage_is_complete(
    tmp_path, monkeypatch
):
    g = _script()
    monkeypatch.setattr(g, "RAW", tmp_path)
    monkeypatch.setattr(g, "plans", lambda n: [{"id": f"tr-{i:04d}"} for i in range(1, n + 1)])
    note = {"plan": "x", "note": "n"}
    g.append(tmp_path / "notes.jsonl", [{"id": "tr-0001", **note}])
    tried = {"role": "writer", "ids": ["tr-0001", "tr-0002"]}
    g.append(tmp_path / "usage.jsonl", [tried, tried])
    assert not g.complete("write", 2) and g.gave_up({"tr-0001"}) == set()
    g.append(tmp_path / "usage.jsonl", [tried])
    (tmp_path / "usage.jsonl").open("a").write('{"role": "wri')  # a write cut off by a crash
    assert g.gave_up({"tr-0001"}) == {"tr-0002"} and g.complete("write", 2)
    assert not g.complete("label-gemini", 2)
    g.append(tmp_path / "labels-gemini.2of2.jsonl", [{"id": "tr-0001", "label": None}])
    assert g.complete("label-gemini", 2)  # shard files count; the given-up plan needs none


def test_raw_rows_name_only_the_labelers_that_saw_the_note_and_every_drop_reason():
    g = _script()
    ids = ["tr-0001", "tr-0002", "tr-0003"]
    notes = {i: {"note": f"note {i}"} for i in ids}
    by_id = {i: {"record": {"jobType": "hvac"}, "trade": "hvac", "style": "terse", "tags": []}
             for i in ids}  # fmt: skip
    rec = {"jobType": "hvac"}
    labels = {"gemini": {i: rec for i in ids}, "luna": {"tr-0001": None}, "gptoss": {}}
    verdict = {"tr-0001": {"reason": None, "contradicts": []},
               "tr-0002": {"reason": None, "contradicts": []},  # kept, then a near-copy
               "tr-0003": {"reason": "contradicts-plan", "contradicts": ["laborMinutes"]}}  # fmt: skip
    rows = {r["id"]: r for r in g.raw_rows(notes, by_id, labels, verdict, ["tr-0001"])}
    assert rows["tr-0001"]["labels"] == {"gemini": rec, "luna": None}  # null = invalid answer
    assert rows["tr-0002"]["labels"] == {"gemini": rec}  # luna never saw it: absent, not null
    assert [(r["kept"], r["reason"]) for r in rows.values()] == [
        (True, None), (False, "near-duplicate"), (False, "contradicts-plan")]  # fmt: skip
    assert rows["tr-0003"]["contradicts"] == ["laborMinutes"]


def test_filter_builds_only_the_configured_set():
    import argparse

    g = _script()
    with pytest.raises(SystemExit, match="limit"):
        g.cmd_filter(argparse.Namespace(limit=g.CONFIG["limit"] + 75))
