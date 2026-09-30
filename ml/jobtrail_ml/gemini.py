"""Minimal Gemini API client for free-tier batch jobs: throttled to an RPM budget,
honors 429 RetryInfo, backs off on 5xx, and stops cleanly on a daily quota."""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class GeminiError(RuntimeError):
    pass


class QuotaExhausted(GeminiError):
    """The daily free-tier quota is used up; resume tomorrow (resets midnight Pacific)."""


@dataclass
class Result:
    text: str
    usage: dict[str, Any] = field(default_factory=dict)
    model_version: str | None = None


def _retry_delay(error: dict[str, Any]) -> float | None:
    for d in error.get("details", []):
        if d.get("@type", "").endswith("RetryInfo"):
            m = re.fullmatch(r"([\d.]+)s", d.get("retryDelay", ""))
            if m:
                return float(m.group(1))
    return None


def _quota_ids(error: dict[str, Any]) -> str:
    """Which quotas Google says were hit, e.g. 'GenerateRequestsPerDay...=20'."""
    return ", ".join(
        f"{v.get('quotaId')}={v.get('quotaValue', '?')}"
        for d in error.get("details", [])
        for v in d.get("violations", [])
    ) or error.get("message", "quota exhausted")


def _is_daily(error: dict[str, Any]) -> bool:
    return any(
        "PerDay" in v.get("quotaId", "")
        for d in error.get("details", [])
        for v in d.get("violations", [])
    )


class GeminiClient:
    def __init__(
        self,
        api_key: str,
        rpm: float,
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        max_retries: int = 6,
    ):
        self._http = httpx.Client(
            headers={"x-goog-api-key": api_key}, timeout=120, transport=transport
        )
        self._interval = 60.0 / rpm
        self._sleep, self._clock = sleep, clock
        self._last: float | None = None
        self._max_retries = max_retries

    def _throttle(self) -> None:
        if self._last is not None:
            wait = self._last + self._interval - self._clock()
            if wait > 0:
                self._sleep(wait)
        self._last = self._clock()

    def generate(
        self,
        model: str,
        system: str,
        user: str,
        *,
        temperature: float = 1.0,
        seed: int | None = None,
        json_schema: dict[str, Any] | None = None,
        thinking_level: str | None = None,
    ) -> Result:
        config: dict[str, Any] = {"temperature": temperature}
        if seed is not None:
            config["seed"] = seed
        if json_schema is not None:
            config["responseMimeType"] = "application/json"
            config["responseJsonSchema"] = json_schema
        if thinking_level:
            config["thinkingConfig"] = {"thinkingLevel": thinking_level}
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": config,
        }
        for attempt in range(self._max_retries + 1):
            self._throttle()
            last_try = attempt == self._max_retries
            try:
                r = self._http.post(API.format(model=model), json=body)
            except httpx.TransportError as e:  # timeouts, dropped connections
                if last_try:
                    raise GeminiError(f"{model}: {type(e).__name__}: {e}") from e
                self._sleep(min(60.0, 2.0**attempt))
                continue
            if r.status_code == 200:
                return self._result(r.json())
            error = (r.json() if r.content else {}).get("error", {})
            if r.status_code == 429:
                if _is_daily(error):
                    raise QuotaExhausted(_quota_ids(error))
                if last_try:
                    break
                self._sleep(_retry_delay(error) or min(60.0, 2.0**attempt * 5))
            elif r.status_code >= 500 and not last_try:
                self._sleep(min(60.0, 2.0**attempt))
            else:
                break
        raise GeminiError(f"{model}: HTTP {r.status_code}: {error.get('message', r.text[:300])}")

    @staticmethod
    def _result(data: dict[str, Any]) -> Result:
        candidates = data.get("candidates") or []
        if not candidates:
            raise GeminiError(f"no candidates: {data.get('promptFeedback')}")
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        if candidates[0].get("finishReason") not in (None, "STOP"):
            raise GeminiError(f"finishReason {candidates[0]['finishReason']}")
        return Result(text, data.get("usageMetadata", {}), data.get("modelVersion"))
