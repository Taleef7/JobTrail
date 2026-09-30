"""#70: Gemini client (throttle, 429/5xx handling) and the checkpointed draft run.
All offline: httpx.MockTransport stands in for the API."""

import json
import re

import httpx
import pytest

from jobtrail_ml.gemini import GeminiClient, GeminiError, QuotaExhausted
from jobtrail_ml.generate import RunConfig, read_done_ids, run_generation

RECORD = {
    "jobType": "plumbing",
    "workPerformed": ["Replaced toilet wax ring"],
    "issuesFound": [],
    "materials": [{"name": "wax ring", "quantity": 1, "unit": None}],
    "laborMinutes": 45,
    "customerApproved": True,
    "followUps": [],
}
NOTE = "Replaced the wax ring, used 1 wax ring. 45 minutes, customer signed off."


def plan(i, split="test"):
    return {
        "id": f"{'t' if split == 'test' else 'd'}-{i:04d}",
        "split": split,
        "trade": "plumbing",
        "style": "terse",
        "tags": [],
        "record": RECORD,
        "meta": {"labor": {"phrasing": "minutes"}, "correction": None, "negation": None,
                 "supply": None},
    }  # fmt: skip


def ok(text, model="gemini-3.8-flash"):
    return httpx.Response(
        200,
        json={
            "candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 30,
                              "totalTokenCount": 130},
            "modelVersion": model,
        },
    )  # fmt: skip


def rate_limited(delay="7s", per_day=False):
    quota = "GenerateRequestsPerDayPerProjectPerModel-FreeTier" if per_day else (
        "GenerateRequestsPerMinutePerProjectPerModel-FreeTier")  # fmt: skip
    return httpx.Response(
        429,
        json={"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "quota",
                        "details": [
                            {"@type": "type.googleapis.com/google.rpc.QuotaFailure",
                             "violations": [{"quotaId": quota}]},
                            {"@type": "type.googleapis.com/google.rpc.RetryInfo",
                             "retryDelay": delay}]}},
    )  # fmt: skip


class FakeTime:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def clock(self):
        return self.now

    def sleep(self, s):
        self.sleeps.append(s)
        self.now += s


def client(responses, rpm=60, **kw):
    t = FakeTime()
    queue = list(responses)
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        r = queue.pop(0)
        return r(request) if callable(r) else r

    c = GeminiClient("k", rpm=rpm, transport=httpx.MockTransport(handler), sleep=t.sleep,
                     clock=t.clock, **kw)  # fmt: skip
    return c, t, seen


def test_throttles_to_rpm():
    c, t, _ = client([ok("a"), ok("b"), ok("c")], rpm=30)
    for _ in range(3):
        c.generate("gemini-3.8-flash", "sys", "user")
    assert t.now >= 4.0  # 3 calls at 30 rpm -> 2 s apart


def test_per_minute_429_waits_retry_delay_then_succeeds():
    c, t, _ = client([rate_limited("7s"), ok("fine")])
    r = c.generate("gemini-3.8-flash", "sys", "user")
    assert r.text == "fine" and 7 in t.sleeps


def test_daily_quota_raises_quota_exhausted():
    c, _, _ = client([rate_limited(per_day=True)])
    with pytest.raises(QuotaExhausted):
        c.generate("gemini-3.8-flash", "sys", "user")


def test_server_errors_back_off_then_give_up():
    c, t, _ = client([httpx.Response(503, json={"error": {"message": "busy"}})] * 3,
                     max_retries=2)  # fmt: skip
    with pytest.raises(GeminiError):
        c.generate("gemini-3.8-flash", "sys", "user")
    assert len([s for s in t.sleeps if s >= 1]) == 2


def test_request_shape_schema_and_seed():
    c, _, seen = client([ok("{}")])
    c.generate("gemini-3.5-flash-lite", "sys", "u", temperature=0, seed=5,
               json_schema={"type": "object"}, thinking_level="low")  # fmt: skip
    body = seen[0]
    assert body["systemInstruction"]["parts"][0]["text"] == "sys"
    cfg = body["generationConfig"]
    assert cfg["responseMimeType"] == "application/json"
    assert cfg["responseJsonSchema"] == {"type": "object"} and cfg["seed"] == 5
    assert cfg["thinkingConfig"] == {"thinkingLevel": "low"}


CFG = RunConfig(writer_model="gemini-3.7-flash", checker_model="gemini-3.5-flash-lite",
                writer_temperature=1.0, checker_temperature=0.0, thinking_level="low",
                seed=70, schema={"type": "object"}, batch_size=2)  # fmt: skip
STYLES = {"terse": "Clipped."}


def is_checker(body):
    return "results" in json.dumps(body["generationConfig"].get("responseJsonSchema", {}))


def responder(checker_record=RECORD, drop=(), checker_text=None):
    """Answers batched writer/checker calls for whatever ids the request contains."""

    def handle(request):
        body = json.loads(request.content)
        user = body["contents"][0]["parts"][0]["text"]
        if is_checker(body):
            items = json.loads(user)
            text = checker_text or json.dumps(
                {"results": [{"id": i["id"], "record": checker_record} for i in items]}
            )
            return ok(text, "gemini-3.5-flash-lite")
        ids = re.findall(r"^### (\S+)$", user, flags=re.M)
        notes = [{"id": i, "note": f"{NOTE} ({i})"} for i in reversed(ids) if i not in drop]
        return ok(json.dumps({"notes": notes}), "gemini-3.7-flash")

    return handle


def lines(path):
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines()]


def test_run_batches_writes_drafts_usage_and_resumes_without_duplicates(tmp_path):
    plans = [plan(1), plan(2), plan(1, "dev")]
    c, _, seen = client([responder()] * 4)  # 2 batches x (writer + checker)
    summary = run_generation(plans, STYLES, tmp_path, c, CFG)
    assert summary["written"] == 3 and not summary["stopped"] and len(seen) == 4
    drafts = lines(tmp_path / "test.jsonl")
    assert [d["id"] for d in drafts] == ["t-0001", "t-0002"]  # plan order, not reply order
    d = drafts[0]
    assert d["note"] == f"{NOTE} (t-0001)" and d["gold"] == RECORD and d["verified"] is False
    assert d["source"] == "synthetic" and d["meta"]["flags"] == []
    assert d["meta"]["writer"] == {"model": "gemini-3.7-flash", "modelVersion": "gemini-3.7-flash",
                                   "batch": 1}  # fmt: skip
    usage = lines(tmp_path / "usage.jsonl")
    assert len(usage) == 4 and summary["tokens"]["total"] == 4 * 130
    assert usage[0]["ids"] == ["t-0001", "t-0002"]

    c2, _, seen2 = client([])  # nothing left to do: no calls at all
    assert run_generation(plans, STYLES, tmp_path, c2, CFG)["written"] == 0 and seen2 == []
    assert len(lines(tmp_path / "test.jsonl")) == 2


def test_notes_missing_from_a_batch_are_left_for_the_next_run(tmp_path):
    plans = [plan(1), plan(2)]
    c, _, _ = client([responder(drop={"t-0002"})] * 2)
    first = run_generation(plans, STYLES, tmp_path, c, CFG)
    assert first["written"] == 1 and first["missing"] == ["t-0002"]
    c2, _, _ = client([responder()] * 2)
    assert run_generation(plans, STYLES, tmp_path, c2, CFG)["written"] == 1
    assert read_done_ids(tmp_path / "test.jsonl") == {"t-0001", "t-0002"}


def test_run_stops_cleanly_on_daily_quota_and_resumes(tmp_path):
    plans = [plan(1), plan(2), plan(3)]
    c, _, _ = client([responder(), responder(), rate_limited(per_day=True)])
    first = run_generation(plans, STYLES, tmp_path, c, CFG)
    assert first["stopped"] == "daily quota" and first["written"] == 2
    assert read_done_ids(tmp_path / "test.jsonl") == {"t-0001", "t-0002"}
    c2, _, _ = client([responder(), responder()])
    assert run_generation(plans, STYLES, tmp_path, c2, CFG)["written"] == 1


def test_truncated_last_line_is_dropped_and_redone(tmp_path):
    good = json.dumps({"id": "t-0001", "note": "x"})
    (tmp_path / "test.jsonl").write_text(good + '\n{"id": "t-0002", "no', encoding="utf-8")
    assert read_done_ids(tmp_path / "test.jsonl") == {"t-0001"}
    assert (tmp_path / "test.jsonl").read_bytes() == (good + "\n").encode()  # LF on Windows too


def test_unparseable_or_invalid_crosscheck_is_flagged_not_fatal(tmp_path):
    c, _, _ = client([responder(checker_text="not json")] * 2)
    run_generation([plan(1)], STYLES, tmp_path, c, CFG)
    d = lines(tmp_path / "test.jsonl")[0]
    assert d["meta"]["flags"] == ["crosscheck:invalid"] and d["meta"]["checked"] is None

    strict = RunConfig(**{**CFG.__dict__, "schema": {"type": "object", "required": ["jobType"]}})
    c2, _, _ = client([responder(checker_record={"nope": 1})] * 2)
    run_generation([plan(2)], STYLES, tmp_path, c2, strict)
    assert lines(tmp_path / "test.jsonl")[1]["meta"]["flags"] == ["crosscheck:invalid"]


def test_timeouts_are_retried_then_succeed():
    def timeout(request):
        raise httpx.ReadTimeout("slow", request=request)

    c, t, _ = client([timeout, ok("fine")])
    assert c.generate("gemini-3.8-flash", "sys", "user").text == "fine"
    assert any(s >= 1 for s in t.sleeps)


def test_persistent_timeouts_become_gemini_error():
    def timeout(request):
        raise httpx.ReadTimeout("slow", request=request)

    c, _, _ = client([timeout] * 3, max_retries=2)
    with pytest.raises(GeminiError, match="timed out|slow"):
        c.generate("gemini-3.8-flash", "sys", "user")


def test_quota_stop_reports_which_quota(tmp_path):
    c, _, _ = client([rate_limited(per_day=True)])
    summary = run_generation([plan(1)], STYLES, tmp_path, c, CFG)
    assert summary["stopped"] == "daily quota"
    assert "PerDay" in summary["quota"]


def test_batch_reply_parsing_drops_duplicates_and_junk():
    from jobtrail_ml.generate import _by_id

    text = json.dumps({"notes": [{"id": "a", "note": "x"}, {"id": "a", "note": "y"},
                                 {"id": "b", "note": "z"}, {"note": "no id"}, "junk"]})  # fmt: skip
    assert _by_id(text, "notes", "note") == {"b": "z"}  # ambiguous 'a' is redone next run
    assert _by_id("not json", "notes", "note") == {} and _by_id("[]", "notes", "note") == {}
