"""llama.cpp runs (#72): a private llama-server per run, one request per note.

The server gets one slot (so requests never batch together) and --reasoning-format
none (so `raw` is exactly what the model wrote, thinking tags included; the scorer
strips them). Each request turns the prompt cache off, so every note's prefill is
measured on its own, and one untimed warm-up runs first: the first request after a
load is cold (3.8 s of prefill instead of 9 ms for a 46-token prompt, b9837).
"""

from __future__ import annotations

import hashlib
import shutil
import socket
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx


class LlamaError(RuntimeError):
    pass


@dataclass
class Completion:
    text: str
    finish_reason: str | None
    wall_ms: float
    timings: dict[str, float] = field(default_factory=dict)
    usage: dict[str, int] = field(default_factory=dict)


def ensure_model(path: Path, url: str | None, sha256: str,
                 transport: httpx.BaseTransport | None = None) -> Path:  # fmt: skip
    """The model file, downloaded if missing; refuses a file whose SHA-256 is wrong."""
    if path.exists():
        got = _sha256(path)
        if got != sha256:
            raise LlamaError(f"{path} has sha256 {got[:12]}…, config expects {sha256[:12]}…")
        return path
    if not url:
        raise LlamaError(f"{path} is missing and the config has no url to download it from")
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(path.suffix + ".part")
    h = hashlib.sha256()
    with httpx.Client(transport=transport, follow_redirects=True, timeout=60) as client, \
            client.stream("GET", url) as r:  # fmt: skip
        r.raise_for_status()
        with part.open("wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                h.update(chunk)
                f.write(chunk)
    if h.hexdigest() != sha256:
        part.unlink()
        raise LlamaError(f"download of {url} has sha256 {h.hexdigest()[:12]}…, not {sha256[:12]}…")
    part.replace(path)
    return path


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def server_command(exe: str, model: Path, port: int, server: dict[str, Any], seed: int) -> list:
    cmd = [exe, "-m", str(model), "--host", "127.0.0.1", "--port", str(port), "-np", "1",
           "-c", str(server["ctx"]), "-ngl", str(server["gpu_layers"]), "--seed", str(seed),
           "--reasoning-format", "none", "--no-webui"]  # fmt: skip
    if server.get("threads"):
        cmd += ["-t", str(server["threads"])]
    return cmd


class LlamaServer:
    """Starts llama-server for one model; use as a context manager."""

    def __init__(self, model: Path, server: dict[str, Any], seed: int, log: Path,
                 exe: str | None = None, startup_s: float = 300):  # fmt: skip
        self.exe = exe or shutil.which("llama-server")
        if not self.exe:
            raise LlamaError("llama-server not found on PATH (install llama.cpp)")
        self.port = free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        self.cmd = server_command(self.exe, model, self.port, server, seed)
        self.log, self.startup_s = log, startup_s
        self.proc: subprocess.Popen | None = None
        self.props: dict[str, Any] = {}

    def __enter__(self) -> LlamaServer:
        self._log = self.log.open("a", encoding="utf-8")  # a resume keeps the earlier log
        self.proc = subprocess.Popen(self.cmd, stdout=self._log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + self.startup_s
        with httpx.Client(timeout=5) as c:
            while time.monotonic() < deadline:
                if self.proc.poll() is not None:
                    raise LlamaError(
                        f"llama-server exited ({self.proc.returncode}); see {self.log}"
                    )
                try:
                    if c.get(f"{self.url}/health").status_code == 200:
                        self.props = c.get(f"{self.url}/props").json()
                        return self
                except httpx.TransportError:
                    pass
                time.sleep(0.5)
        self.__exit__(None, None, None)
        raise LlamaError(f"llama-server not healthy after {self.startup_s}s; see {self.log}")

    def __exit__(self, *_exc) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self._log.close()

    def check_build(self, pinned: str) -> None:
        """Refuse to run on a llama.cpp release other than the one the config pins."""
        if not self.build.startswith(f"{pinned}-") and self.build != pinned:
            raise LlamaError(f"config pins llama.cpp {pinned}, but llama-server is {self.build}")

    @property
    def build(self) -> str:
        return str(self.props.get("build_info", "unknown"))


class LlamaClient:
    def __init__(self, url: str, *, transport: httpx.BaseTransport | None = None,
                 timeout: float = 600, retries: int = 2,
                 clock: Callable[[], float] = time.perf_counter):  # fmt: skip
        self._http = httpx.Client(base_url=url, timeout=timeout, transport=transport)
        self._retries, self._clock = retries, clock

    def chat(self, messages: list[dict], *, schema: dict | None, sampling: dict[str, Any],
             chat_template_kwargs: dict[str, Any] | None = None) -> Completion:  # fmt: skip
        body: dict[str, Any] = {
            "messages": messages,
            "temperature": sampling["temperature"],
            "seed": sampling["seed"],
            "max_tokens": sampling["max_tokens"],
            "cache_prompt": False,
        }
        if schema is not None:
            body["response_format"] = {"type": "json_schema", "json_schema": {"schema": schema}}
        if chat_template_kwargs:
            body["chat_template_kwargs"] = chat_template_kwargs
        for attempt in range(self._retries + 1):
            start = self._clock()
            try:
                r = self._http.post("/v1/chat/completions", json=body)
            except httpx.TransportError as e:
                if attempt == self._retries:
                    raise LlamaError(f"llama-server unreachable: {e}") from e
                continue
            wall_ms = (self._clock() - start) * 1000
            if r.status_code == 200:
                return self._completion(r.json(), wall_ms)
            if r.status_code < 500 or attempt == self._retries:
                raise LlamaError(f"llama-server HTTP {r.status_code}: {r.text[:300]}")
        raise AssertionError("unreachable")

    @staticmethod
    def _completion(data: dict[str, Any], wall_ms: float) -> Completion:
        choice = data["choices"][0]
        t = data.get("timings", {})
        timings = {"wallMs": round(wall_ms, 3)}
        if "prompt_ms" in t:
            # llama-server stops prompt_ms when the first token is sampled: server-side TTFT.
            timings["ttftMs"] = round(t["prompt_ms"], 3)
            timings["prefillTokPerSec"] = round(t.get("prompt_per_second", 0), 3)
            timings["decodeTokPerSec"] = round(t.get("predicted_per_second", 0), 3)
        u = data.get("usage", {})
        usage = {"promptTokens": u.get("prompt_tokens", 0),
                 "outputTokens": u.get("completion_tokens", 0)}  # fmt: skip
        return Completion(choice["message"].get("content") or "", choice.get("finish_reason"),
                          wall_ms, timings, usage)  # fmt: skip
