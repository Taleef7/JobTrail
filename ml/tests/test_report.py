"""#70: coverage report over the plan and the drafts written so far."""

from jobtrail_ml.report import coverage_markdown, coverage_table
from jobtrail_ml.sampler import TAGS


def p(i, split, tags):
    return {"id": f"{split[0]}-{i:04d}", "split": split, "tags": tags, "style": "terse",
            "trade": "plumbing"}  # fmt: skip


PLANS = [p(1, "test", ["negation"]), p(2, "test", ["negation", "hours-phrasing"]),
         p(3, "test", []), p(1, "dev", ["negation"])]  # fmt: skip
DRAFTS = [
    {"id": "t-0001", "tags": ["negation"], "meta": {"split": "test", "flags": []}},
    {"id": "t-0002", "tags": ["negation", "hours-phrasing"],
     "meta": {"split": "test", "flags": ["labor-minutes-leaked", "crosscheck:laborMinutes"]}},
]  # fmt: skip


def test_table_counts_planned_drafted_and_clean():
    t = coverage_table(PLANS, DRAFTS)
    assert t["negation"] == {"test_planned": 2, "test_drafted": 2, "test_clean": 1,
                             "dev_planned": 1, "dev_drafted": 0}  # fmt: skip
    assert t["hours-phrasing"]["test_clean"] == 0
    assert t["(plain)"]["test_planned"] == 1 and t["(plain)"]["test_drafted"] == 0
    assert set(TAGS) <= set(t)


def test_markdown_has_every_tag_flag_counts_and_usage():
    md = coverage_markdown(PLANS, DRAFTS, {"total": 1234, "calls": 4}, min_test=12)
    for tag in TAGS:
        assert f"| {tag} |" in md
    assert "labor-minutes-leaked" in md and "crosscheck:laborMinutes" in md
    assert "1,234" in md
    # negation and hours-phrasing have < 12 test drafts: named against the target
    assert "Below 12:** hours-phrasing, negation" in md
