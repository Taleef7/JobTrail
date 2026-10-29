import json
from pathlib import Path

from jobtrail_ml import extract, sft

ROOT = Path(__file__).resolve().parents[2]
ROWS = sft.load_rows(ROOT / "data/train/train.jsonl")


def test_an_example_is_exactly_what_the_runner_asks_and_the_record_it_wants():
    row = ROWS[0]
    ex = sft.to_example(row, "compact")
    assert ex["prompt"] == extract.messages(row["note"], "fine-tuned-short", "compact")
    assert ex["prompt"] == [{"role": "user", "content": row["note"]}]  # the note, nothing else
    out = json.loads(ex["completion"][0]["content"])
    assert list(out) == ["t", "w", "i", "m", "l", "a", "f"]  # the grammar's key order
    assert out["t"] == row["target"]["jobType"] and len(out["m"]) == len(row["target"]["materials"])


def test_validation_is_a_disjoint_reproducible_slice_of_the_training_set():
    train, val = sft.split_validation(ROWS, 0.05, 75)
    assert not set(sft.ids(train)) & set(sft.ids(val))
    assert sorted(sft.ids(train) + sft.ids(val)) == sorted(sft.ids(ROWS))  # nothing lost
    assert abs(len(val) - 0.05 * len(ROWS)) <= 9
    assert sft.split_validation(ROWS, 0.05, 75) == (train, val)  # same seed, same split
    assert sft.ids(sft.split_validation(ROWS, 0.05, 76)[1]) != sft.ids(val)
