"""#76: the manifest check compares each published file's size and sha256 with the manifest."""

import importlib.util
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


def _client(headers: dict, status: int = 302) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "HEAD"  # never downloads the file
        return httpx.Response(status, headers=headers)

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
