"""#72: extraction prompts are the same for every model and never leak eval notes."""

import json
import re
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from jobtrail_ml.extract import (
    COMPACT_LEGEND,
    EXTRACT_SYSTEM,
    EXTRACT_SYSTEM_V2,
    FEWSHOT_V2_NOTE,
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
# sha256 of EXTRACT_SYSTEM (v1), hashed into every committed run ID
V1_SHA = "e5e2f9d5551ae6335ce4caa88c5a9dab5b04dbb6b1b489cbc6dec144b307171d"


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


def test_v1_prompt_text_is_frozen():
    # Committed v1 runs hash this exact text into their IDs: v2 must not change it.
    import hashlib

    assert hashlib.sha256(EXTRACT_SYSTEM.encode()).hexdigest()[:12] == V1_SHA[:12]


def test_v2_prompts_state_the_rules_v1_left_out_and_have_no_copyable_examples():
    v2 = messages("n", "zero-shot-v2", "full")[0]["content"]
    for rule in (
        "supply house for this job",
        'unit is "kit"',
        "null when the note doesn't say",
        "found or noticed",
        "plumbing: pipes",
    ):
        assert rule in v2, rule
    assert "kitchen sink" not in v2 and "Replaced" not in v2  # nothing to copy verbatim
    fs = messages("n", "few-shot-v2", "full")
    assert fs[0]["content"].endswith(FEWSHOT_V2_NOTE) and len(fs) == 2 + 2 * len(fewshot_examples())
    assert messages("n", "zero-shot", "full")[0]["content"] == EXTRACT_SYSTEM


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
    text = mod.batch_prompt({"format": "full", "prompt": "zero-shot"},
                            [{"id": "d-1", "note": "Fixed a leak."}])  # fmt: skip
    assert text.startswith(EXTRACT_SYSTEM) and "Do not use any tools" in text
    assert '"id": "d-1"' in text and "Fixed a leak." in text
    assert mod.agy_usage({"input_tokens": 5, "output_tokens": 2, "thinking_tokens": 1}) == {
        "promptTokens": 5, "outputTokens": 2, "thoughtsTokens": 1}  # fmt: skip


def test_agy_v2_batch_prompt_uses_the_v2_rules():
    import importlib.util

    path = Path(__file__).parents[1] / "scripts/run_agy.py"
    spec = importlib.util.spec_from_file_location("run_agy", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    text = mod.batch_prompt(
        {"format": "full", "prompt": "zero-shot-v2"}, [{"id": "a", "note": "n"}]
    )
    assert text.startswith(EXTRACT_SYSTEM_V2)


# The text run_agy sends is only partly hashed into the run ID (the rules are; its tools line
# and "# Notes" wrapper aren't), so it is pinned here: changing it must mean a new run.
AGY_PROMPT_SHA = {
    "zero-shot": "ea2475532e231445b5bc4332af9a01e4eb0f108d0af4f2723b8474315f7c32cc",
    "zero-shot-v2": "4474f57565d61404d646f36e96434ca07f0877ddca6f2716e6824fc4bf49385a",
}


def test_the_agy_batch_prompt_text_is_pinned():
    import hashlib
    import importlib.util

    path = Path(__file__).parents[1] / "scripts/run_agy.py"
    spec = importlib.util.spec_from_file_location("run_agy", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for variant, want in AGY_PROMPT_SHA.items():
        text = mod.batch_prompt(
            {"format": "full", "prompt": variant}, [{"id": "{id}", "note": "{note}"}]
        )
        got = hashlib.sha256(text.encode()).hexdigest()
        assert got == want, f"{variant}: agy prompt changed; give the config a new name (new run)"
