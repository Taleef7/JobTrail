"""#72: extraction prompts are the same for every model and never leak eval notes."""

import json
import re
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from jobtrail_ml.extract import (
    COMPACT_LEGEND,
    EXTRACT_SYSTEM,
    batch_input,
    batch_schema,
    encode,
    fewshot_examples,
    messages,
    prompt_fingerprint,
    schema,
    split_batch,
)

DATA = Path(__file__).resolve().parents[2] / "data"


def test_zero_shot_is_the_rules_then_the_note():
    m = messages("the note", "zero-shot", "full")
    assert [x["role"] for x in m] == ["system", "user"]
    assert m[0]["content"] == EXTRACT_SYSTEM and m[1]["content"] == "the note"


def test_few_shot_adds_worked_examples_as_earlier_turns():
    m = messages("the note", "few-shot", "full")
    n = len(fewshot_examples())
    assert [x["role"] for x in m] == ["system", *["user", "assistant"] * n, "user"]
    assert json.loads(m[2]["content"]) == fewshot_examples()[0]["gold"]


def test_fine_tuned_short_is_the_note_alone():
    assert messages("the note", "fine-tuned-short", "compact") == [
        {"role": "user", "content": "the note"}
    ]


def test_compact_prompts_name_the_short_keys_and_examples_use_them():
    m = messages("n", "few-shot", "compact")
    assert m[0]["content"].endswith(COMPACT_LEGEND)
    assert list(json.loads(m[2]["content"])) == ["t", "w", "i", "m", "l", "a", "f"]


def test_unknown_variant_or_format_is_an_error():
    with pytest.raises(ValueError, match="variant"):
        messages("n", "chain-of-thought", "full")
    with pytest.raises(ValueError, match="format"):
        messages("n", "zero-shot", "yaml")


def test_fewshot_examples_are_valid_in_both_encodings():
    full = Draft202012Validator(schema("full"))
    compact = Draft202012Validator(schema("compact"))
    for ex in fewshot_examples():
        assert not list(full.iter_errors(ex["gold"])), ex["id"]
        assert not list(compact.iter_errors(json.loads(encode(ex["gold"], "compact")))), ex["id"]


def _grams(text: str, n: int = 8) -> set[tuple[str, ...]]:
    words = re.findall(r"[a-z0-9']+", text.lower())
    return {tuple(words[i : i + n]) for i in range(len(words) - n + 1)}


def test_fewshot_notes_share_no_eight_word_run_with_any_eval_note():
    files = [*(DATA / "drafts").glob("*.jsonl"), DATA / "test.jsonl", DATA / "dev.jsonl"]
    eval_grams = set()
    for f in files:
        if not f.exists() or f.name in ("plan.jsonl", "usage.jsonl", "runs.jsonl"):
            continue
        for line in f.read_text(encoding="utf-8").splitlines():
            if line:
                eval_grams |= _grams(json.loads(line)["note"])
    assert eval_grams, "no eval notes found"
    for ex in fewshot_examples():
        assert not (_grams(ex["note"]) & eval_grams), ex["id"]


def test_a_batched_answer_splits_into_one_raw_record_per_note():
    rec = {"jobType": "plumbing"}
    text = json.dumps({"records": [{"id": "a", "record": rec}, {"id": "a", "record": {}},
                                   {"id": "c", "record": rec}]})  # fmt: skip
    got = split_batch(["a", "b", "c"], text, "STOP")
    assert got == [("a", json.dumps(rec), "STOP"), ("b", "", "MISSING_IN_BATCH"),
                   ("c", json.dumps(rec), "STOP")]  # fmt: skip
    assert split_batch(["a"], "not json", "MAX_TOKENS") == [("a", "", "UNPARSEABLE_BATCH")]


def test_batch_input_and_schema_wrap_notes_and_records():
    assert json.loads(batch_input([{"id": "a", "note": "n", "gold": {}}])) == [
        {"id": "a", "note": "n"}]  # fmt: skip
    s = batch_schema({"type": "object"})
    assert s["properties"]["records"]["items"]["properties"]["record"] == {"type": "object"}


def test_prompt_fingerprint_tracks_the_prompt_not_the_note():
    a = prompt_fingerprint("zero-shot", "full")
    assert a == prompt_fingerprint("zero-shot", "full")
    assert len({a, prompt_fingerprint("few-shot", "full"),
                prompt_fingerprint("zero-shot", "compact")}) == 3  # fmt: skip


def test_agy_batch_prompt_has_the_rules_the_batch_note_and_the_notes():
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "run_agy", Path(__file__).parents[1] / "scripts/run_agy.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    text = mod.batch_prompt({"format": "full"}, [{"id": "d-1", "note": "Fixed a leak."}])
    assert text.startswith(EXTRACT_SYSTEM) and "Do not use any tools" in text
    assert '"id": "d-1"' in text and "Fixed a leak." in text
    assert mod.agy_usage({"input_tokens": 5, "output_tokens": 2, "thinking_tokens": 1}) == {
        "promptTokens": 5, "outputTokens": 2, "thoughtsTokens": 1}  # fmt: skip
