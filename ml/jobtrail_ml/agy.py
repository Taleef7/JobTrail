"""The Antigravity CLI (`agy`), headless: one prompt in, schema-checked JSON out.

Runs on the owner's Google AI Pro plan, so no API key is involved. The prompt is passed
as an argument (`-p=`), and Windows caps a command line at 32,767 characters, every '"'
escaped, so callers keep prompts under about 28K (adjudicate.MAX_CMDLINE).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


class AgyError(RuntimeError):
    pass


def version() -> str:
    """The `agy --version` number. agy updates itself, so runs check it before each batch."""
    exe = shutil.which("agy")
    if not exe:
        raise AgyError("agy not found on PATH (install the Antigravity CLI)")
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=60)  # fmt: skip
    except subprocess.TimeoutExpired as e:
        raise AgyError("agy --version timed out") from e
    found = re.search(r"\b\d+\.\d+(?:\.\d+)*\b", f"{out.stdout}\n{out.stderr}")
    if out.returncode != 0 or not found:
        raise AgyError(f"agy --version gave no version (exit {out.returncode}): "
                       f"{(out.stdout + out.stderr).strip()[:200]!r}")  # fmt: skip
    return found.group()


def run(
    model: str, prompt: str, schema: dict[str, Any], timeout_s: int = 1800
) -> tuple[dict, dict]:
    """(structured output, usage) from one headless agy turn."""
    exe = shutil.which("agy")
    if not exe:
        raise AgyError("agy not found on PATH (install the Antigravity CLI)")
    # agy can keep a handle on its working folder after it exits (Windows)
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        schema_path = Path(tmp) / "schema.json"
        schema_path.write_text(json.dumps(schema), encoding="utf-8")
        try:
            proc = subprocess.run(
                [exe, "--model", model, "--json-schema", str(schema_path),
                 "--output-format", "json", "--print-timeout", f"{timeout_s - 60}s",
                 f"-p={prompt}"],
                cwd=tmp, capture_output=True, text=True, encoding="utf-8", timeout=timeout_s,
            )  # fmt: skip
        except subprocess.TimeoutExpired as e:
            raise AgyError(f"agy timed out after {timeout_s}s") from e
    if proc.returncode != 0:
        raise AgyError(f"agy exit {proc.returncode}: {(proc.stderr or proc.stdout)[-400:]}")
    try:
        body = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise AgyError(f"agy printed no JSON: {proc.stdout[-300:]}") from e
    if body.get("status") != "SUCCESS" or not body.get("structured_output"):
        raise AgyError(f"agy status {body.get('status')}: {str(body)[:400]}")
    return body["structured_output"], body.get("usage", {})
