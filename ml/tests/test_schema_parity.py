"""One source of truth: the JSON Schema generated from packages/core's Zod
contract must give the same verdict as Zod on every shared fixture."""

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

CORE = Path(__file__).resolve().parents[2] / "packages" / "core"
SCHEMA = json.loads((CORE / "schema" / "schema.v2.json").read_text(encoding="utf-8"))
FIXTURES = CORE / "fixtures" / "schema"
validator = Draft202012Validator(SCHEMA)


def fixtures(verdict: str) -> list[Path]:
    return sorted((FIXTURES / verdict).glob("*.json"))


def test_schema_itself_is_valid_draft_2020_12():
    Draft202012Validator.check_schema(SCHEMA)


@pytest.mark.parametrize("path", fixtures("valid"), ids=lambda p: p.stem)
def test_valid_fixtures_pass(path: Path):
    errors = list(validator.iter_errors(json.loads(path.read_text(encoding="utf-8"))))
    assert errors == [], [e.message for e in errors]


@pytest.mark.parametrize("path", fixtures("invalid"), ids=lambda p: p.stem)
def test_invalid_fixtures_fail(path: Path):
    assert not validator.is_valid(json.loads(path.read_text(encoding="utf-8")))


def test_fixture_sets_are_not_empty():
    assert len(fixtures("valid")) >= 5
    assert len(fixtures("invalid")) >= 10
