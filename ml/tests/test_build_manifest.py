"""#76: the manifest check compares each published file's size and sha256 with the manifest."""

import importlib.util
import json
from pathlib import Path

import httpx

ML = Path(__file__).resolve().parents[1]
SHA = "a" * 64


def _script():
    spec = importlib.util.spec_from_file_location(
        "build_manifest", ML / "scripts/build_manifest.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _client(headers: dict, status: int = 302, statuses: list[int] | None = None) -> httpx.Client:
    queue = list(statuses or [])

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "HEAD"  # never downloads the file
        return httpx.Response(queue.pop(0) if queue else status, headers=headers)

    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)


def _manifest(**over) -> dict:
    model = {"id": "m", "url": "https://huggingface.co/x/y/resolve/r/m.gguf", "bytes": 10,
             "sha256": SHA} | over  # fmt: skip
    return {"models": [model]}


def test_check_passes_when_size_and_sha_match():
    b = _script()
    assert b.check(_manifest(), _client({"X-Linked-Size": "10", "X-Linked-ETag": f'"{SHA}"'})) == []


def test_check_reports_a_wrong_size_a_wrong_sha_and_a_missing_file():
    b = _script()
    bad = b.check(_manifest(), _client({"X-Linked-Size": "11", "X-Linked-ETag": '"' + "b" * 64}))
    assert len(bad) == 2 and "size 11" in bad[0] and "b" * 64 in bad[1]
    missing = b.check(_manifest(), _client({}, status=404))
    assert missing == ["m: HTTP 404 without X-Linked-Size"]


def test_peak_rss_reads_this_process():
    import os

    assert _script().peak_rss_mb(os.getpid()) > 0


def test_check_retries_rate_limits_and_server_errors():
    ok = {"X-Linked-Size": "10", "X-Linked-ETag": f'"{SHA}"'}
    assert _script().check(_manifest(), _client(ok, statuses=[429, 503]), wait=0) == []
    bad = _script().check(_manifest(), _client({}, status=503), wait=0)
    assert bad == ["m: HTTP 503 without X-Linked-Size"]


def test_committed_manifest_is_up_to_date():
    """models/manifest.json is what build() makes from release.yaml, configs and results."""
    b = _script()
    assert b.build() == json.loads(b.MANIFEST.read_text(encoding="utf-8"))
