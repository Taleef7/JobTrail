"""#72: the llama.cpp runner's server command, client and model download (all offline)."""

import hashlib
import json
from pathlib import Path

import httpx
import pytest

from jobtrail_ml.gemini import GeminiClient
from jobtrail_ml.llamacpp import (
    LlamaClient,
    LlamaError,
    LlamaServer,
    ensure_model,
    server_command,
)

SAMPLING = {"temperature": 0, "seed": 42, "max_tokens": 512}
TIMINGS = {"prompt_n": 46, "prompt_ms": 9.0, "prompt_per_second": 5000.0,
           "predicted_per_token_ms": 2.0, "predicted_per_second": 500.0}  # fmt: skip


def reply(text="{}", finish="stop"):
    return httpx.Response(200, json={
        "choices": [{"message": {"content": text}, "finish_reason": finish}],
        "timings": TIMINGS, "usage": {"prompt_tokens": 46, "completion_tokens": 20},
    })  # fmt: skip


def client(responses):
    seen, queue = [], list(responses)

    def handler(request):
        seen.append(json.loads(request.content))
        r = queue.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    ticks = iter(range(0, 10_000, 1))
    c = LlamaClient("http://x", transport=httpx.MockTransport(handler), retries=1,
                    clock=lambda: next(ticks) / 1000)  # fmt: skip
    return c, seen


def test_request_turns_grammar_on_and_prompt_cache_off():
    c, seen = client([reply()])
    c.chat([{"role": "user", "content": "n"}], schema={"type": "object"}, sampling=SAMPLING,
           chat_template_kwargs={"enable_thinking": False})  # fmt: skip
    body = seen[0]
    assert body["response_format"] == {"type": "json_schema",
                                       "json_schema": {"schema": {"type": "object"}}}  # fmt: skip
    assert (body["temperature"], body["seed"], body["max_tokens"]) == (0, 42, 512)
    assert body["cache_prompt"] is False
    assert body["chat_template_kwargs"] == {"enable_thinking": False}


def test_grammar_off_sends_no_response_format():
    c, seen = client([reply()])
    c.chat([{"role": "user", "content": "n"}], schema=None, sampling=SAMPLING)
    assert "response_format" not in seen[0] and "chat_template_kwargs" not in seen[0]


def test_timings_usage_and_finish_reason_come_back():
    c, _ = client([reply('{"a": 1}', finish="length")])
    r = c.chat([], schema=None, sampling=SAMPLING)
    assert (r.text, r.finish_reason) == ('{"a": 1}', "length")
    assert r.timings == {"wallMs": 1.0, "ttftMs": 9.0, "prefillTokPerSec": 5000.0,
                         "decodeTokPerSec": 500.0}  # fmt: skip
    assert r.usage == {"promptTokens": 46, "outputTokens": 20}


def test_server_errors_and_dropped_connections_are_retried_then_raised():
    c, _ = client([httpx.Response(503), reply("ok")])
    assert c.chat([], schema=None, sampling=SAMPLING).text == "ok"
    c, _ = client([httpx.ConnectError("down"), reply("ok")])
    assert c.chat([], schema=None, sampling=SAMPLING).text == "ok"
    c, _ = client([httpx.Response(503), httpx.Response(503)])
    with pytest.raises(LlamaError, match="HTTP 503"):
        c.chat([], schema=None, sampling=SAMPLING)


def test_reasoning_the_server_split_off_goes_back_into_raw():
    resp = httpx.Response(200, json={
        "choices": [{"message": {"content": "{}", "reasoning_content": "hmm"},
                     "finish_reason": "stop"}], "timings": TIMINGS, "usage": {},
    })  # fmt: skip
    c, _ = client([resp])
    assert c.chat([], schema=None, sampling=SAMPLING).text == "<think>hmm</think>{}"


def test_reasoning_format_comes_from_the_config():
    cmd = server_command("s", Path("m"), 1, {"ctx": 1, "gpu_layers": 0,
                                              "reasoning_format": "deepseek"}, 1)  # fmt: skip
    assert "--reasoning-format deepseek" in " ".join(cmd)


def test_a_bad_request_is_not_retried():
    c, seen = client([httpx.Response(400, text="bad schema"), reply()])
    with pytest.raises(LlamaError, match="HTTP 400"):
        c.chat([], schema=None, sampling=SAMPLING)
    assert len(seen) == 1


def test_server_command_is_one_slot_raw_output_and_pinned_settings():
    cmd = server_command("llama-server", Path("m.gguf"), 9000,
                         {"ctx": 4096, "gpu_layers": 0, "threads": 4}, seed=42)  # fmt: skip
    joined = " ".join(cmd)
    for flag in ("-np 1", "-c 4096", "-ngl 0", "--seed 42", "--reasoning-format none", "-t 4",
                 "--port 9000", "--host 127.0.0.1"):  # fmt: skip
        assert flag in joined
    assert "-t" not in server_command("s", Path("m"), 1, {"ctx": 1, "gpu_layers": 0}, 1)


BLOB = b"gguf weights"
BLOB_SHA = hashlib.sha256(BLOB).hexdigest()


def serve(body):
    return httpx.MockTransport(lambda request: httpx.Response(200, content=body))


def test_ensure_model_downloads_a_missing_file_and_checks_its_hash(tmp_path):
    path = tmp_path / "models" / "m.gguf"
    assert ensure_model(path, "https://hf/m.gguf", BLOB_SHA, transport=serve(BLOB)) == path
    assert path.read_bytes() == BLOB


def test_ensure_model_refuses_a_bad_download_and_leaves_nothing(tmp_path):
    path = tmp_path / "m.gguf"
    with pytest.raises(LlamaError, match="download"):
        ensure_model(path, "https://hf/m.gguf", BLOB_SHA, transport=serve(b"tampered"))
    assert list(tmp_path.iterdir()) == []


def test_ensure_model_refuses_a_local_file_with_the_wrong_hash(tmp_path):
    path = tmp_path / "m.gguf"
    path.write_bytes(b"other model")
    with pytest.raises(LlamaError, match="config expects"):
        ensure_model(path, None, BLOB_SHA)
    with pytest.raises(LlamaError, match="no url"):
        ensure_model(tmp_path / "missing.gguf", None, BLOB_SHA)


def gemini(responses):
    queue = list(responses)
    return GeminiClient("k", rpm=600, sleep=lambda s: None,
                        transport=httpx.MockTransport(lambda r: queue.pop(0)))  # fmt: skip


def candidate(text, finish):
    return httpx.Response(200, json={
        "candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": finish}],
        "usageMetadata": {"promptTokenCount": 5}, "modelVersion": "v1",
    })  # fmt: skip


def test_gemini_eval_mode_returns_unfinished_answers_instead_of_raising():
    r = gemini([candidate('{"jobType', "MAX_TOKENS")]).generate(
        "m", "s", "u", allow_unfinished=True, max_output_tokens=10
    )
    assert (r.text, r.finish_reason) == ('{"jobType', "MAX_TOKENS") and r.wall_ms is not None
    blocked = httpx.Response(200, json={"promptFeedback": {"blockReason": "OTHER"}})
    r = gemini([blocked]).generate("m", "s", "u", allow_unfinished=True)
    assert (r.text, r.finish_reason) == ("", "NO_CANDIDATES")


def test_gemini_default_mode_still_raises_on_unfinished_answers():
    from jobtrail_ml.gemini import GeminiError

    with pytest.raises(GeminiError, match="MAX_TOKENS"):
        gemini([candidate("x", "MAX_TOKENS")]).generate("m", "s", "u")


def test_the_server_must_be_the_pinned_llama_cpp_build(tmp_path):
    server = LlamaServer(Path("m.gguf"), {"ctx": 1, "gpu_layers": 0}, 1, tmp_path / "log",
                         exe="llama-server")  # fmt: skip
    server.props = {"build_info": "b9837-b3fed31b9"}
    server.check_build("b9837")
    with pytest.raises(LlamaError, match="pins llama.cpp b9900"):
        server.check_build("b9900")
    with pytest.raises(LlamaError, match="pins llama.cpp b983"):
        server.check_build("b983")  # a prefix of another build is not that build
