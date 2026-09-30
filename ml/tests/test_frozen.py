"""#71: the freeze check CI runs. Once data/FROZEN.md exists, every file it lists must
hash to the recorded SHA-256 and hold the recorded number of valid, disjoint records."""

from pathlib import Path

import pytest

from jobtrail_ml.freeze import check_frozen

DATA = Path(__file__).resolve().parents[2] / "data"


def test_a_frozen_set_cannot_exist_without_its_hashes():
    if (DATA / "test.jsonl").exists() or (DATA / "dev.jsonl").exists():
        assert (DATA / "FROZEN.md").exists(), "data/test.jsonl or dev.jsonl without FROZEN.md"


@pytest.mark.skipif(not (DATA / "FROZEN.md").exists(), reason="not frozen yet (#71)")
def test_frozen_files_are_unchanged_valid_and_disjoint():
    assert check_frozen(DATA) == []
