"""The Codex CLI (`codex exec`), headless: one prompt in, schema-checked JSON out.

Runs on the owner's ChatGPT plan, so no API key is involved. Its usage is limited, so
callers use it sparingly (the #74 cross-family check). The prompt goes in on stdin; the
run is read-only and ephemeral, in an empty temporary folder.
"""

from __future__ import annotations

import contextlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


class CodexError(RuntimeError):
    pass


def strict(schema: Any) -> Any:
    """OpenAI's strict structured output wants every object closed and fully required."""
    if isinstance(schema, list):
        return [strict(s) for s in schema]
    if not isinstance(schema, dict):
        return schema
    out = {k: strict(v) for k, v in schema.items() if k != "$schema"}
    if out.get("type") == "object" and "properties" in out:
        out["additionalProperties"] = False
        out["required"] = list(out["properties"])
    return out


def kill_tree(proc: subprocess.Popen) -> None:
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
    else:
        proc.kill()
    with contextlib.suppress(subprocess.TimeoutExpired):
        proc.communicate(timeout=30)


def run(model: str, effort: str, prompt: str, schema: dict[str, Any],
        timeout_s: int = 1800) -> dict:  # fmt: skip
    """The structured answer of one `codex exec` turn."""
    exe = shutil.which("codex")
    if not exe:
        raise CodexError("codex not found on PATH (npm i -g @openai/codex)")
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        schema_path, answer = Path(tmp) / "schema.json", Path(tmp) / "answer.json"
        schema_path.write_text(json.dumps(strict(schema)), encoding="utf-8")
        # On Windows `codex` is an npm .cmd shim: on a timeout, kill its whole process
        # tree, or the node child keeps the pipes open and the wait never ends.
        proc = subprocess.Popen(
            [exe, "exec", "-m", model, "-c", f'model_reasoning_effort="{effort}"',
             "-s", "read-only", "--skip-git-repo-check", "--ephemeral", "-C", tmp,
             "--output-schema", str(schema_path), "-o", str(answer), "-"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8",
        )  # fmt: skip
        try:
            stdout, stderr = proc.communicate(prompt, timeout=timeout_s)
        except subprocess.TimeoutExpired as e:
            kill_tree(proc)
            raise CodexError(f"codex timed out after {timeout_s}s") from e
        if proc.returncode != 0 or not answer.exists():
            raise CodexError(f"codex exit {proc.returncode}: {(stderr or stdout)[-400:]}")
        text = answer.read_text(encoding="utf-8")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise CodexError(f"codex answered no JSON: {text[-300:]}") from e
