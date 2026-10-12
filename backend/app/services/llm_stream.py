"""
Low-latency, provider-agnostic LLM client for the live AI interviewer.

Every supported provider exposes an OpenAI-compatible ``/chat/completions``
endpoint, so one streaming implementation covers all of them:

    groq        https://api.groq.com/openai/v1                (GROQ_API_KEY)
    gemini      https://generativelanguage.googleapis.com/v1beta/openai  (GEMINI_API_KEY)
    openrouter  https://openrouter.ai/api/v1                  (OPENROUTER_API_KEY)
    ollama      $OLLAMA_BASE_URL/v1                           (local, no key)

Latency design
--------------
* One shared ``httpx.AsyncClient`` with keep-alive: after the first turn the
  TLS handshake is gone, saving ~100-300 ms per turn.
* Streaming (``stream: true``) so the browser can start speaking the first
  sentence while the rest is still being generated.
* A strict *time-to-first-token* budget per provider. If a provider stalls
  (rate-limit, cold model) we fail over to the next one instead of making the
  candidate wait in silence.
* Providers are tried in ``INTERVIEW_LLM_ORDER`` order (default
  ``groq,gemini,openrouter,ollama``); unconfigured ones are skipped.

API keys never reach the browser — the old frontend OpenRouter call exposed
``VITE_OPENROUTER_API_KEY`` in the JS bundle; that path is removed.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import AsyncIterator, Dict, List, Optional

import httpx

logger = logging.getLogger("ats-platform.llm")


@dataclass
class Provider:
    name: str
    base_url: str
    api_key: Optional[str]
    fast_model: str
    smart_model: str
    extra_headers: Dict[str, str] = field(default_factory=dict)

    @property
    def headers(self) -> Dict[str, str]:
        h = {"Content-Type": "application/json", **self.extra_headers}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h


def _first_key(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    key = raw.split(",")[0].strip()
    return key or None


def configured_providers() -> List[Provider]:
    """Providers in preference order, only those that are configured."""
    env = os.environ
    available: Dict[str, Provider] = {}

    if _first_key(env.get("GROQ_API_KEY")):
        available["groq"] = Provider(
            "groq",
            env.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
            _first_key(env.get("GROQ_API_KEY")),
            fast_model=env.get("INTERVIEW_GROQ_FAST_MODEL", "llama-3.1-8b-instant"),
            smart_model=env.get("INTERVIEW_GROQ_SMART_MODEL", "llama-3.3-70b-versatile"),
        )
    if _first_key(env.get("GEMINI_API_KEY")):
        available["gemini"] = Provider(
            "gemini",
            env.get("GEMINI_OPENAI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai"),
            _first_key(env.get("GEMINI_API_KEY")),
            fast_model=env.get("INTERVIEW_GEMINI_FAST_MODEL", "gemini-2.0-flash"),
            smart_model=env.get("INTERVIEW_GEMINI_SMART_MODEL", env.get("GEMINI_MODEL", "gemini-2.5-flash")),
        )
    if _first_key(env.get("OPENROUTER_API_KEY")):
        available["openrouter"] = Provider(
            "openrouter",
            env.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
            _first_key(env.get("OPENROUTER_API_KEY")),
            fast_model=env.get("INTERVIEW_OPENROUTER_FAST_MODEL", "meta-llama/llama-3.3-70b-instruct:free"),
            smart_model=env.get("INTERVIEW_OPENROUTER_SMART_MODEL", "meta-llama/llama-3.3-70b-instruct:free"),
            extra_headers={"X-Title": "CoreLink AI Interview"},
        )
    if env.get("OLLAMA_BASE_URL") or env.get("INTERVIEW_USE_OLLAMA", "").lower() in {"1", "true", "yes"}:
        base = env.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        model = env.get("OLLAMA_MODEL", "llama3.2")
        available["ollama"] = Provider("ollama", f"{base}/v1", None, fast_model=model, smart_model=model)
    # Generic OpenAI-compatible endpoint (e.g. a mock server in tests, Together, Fireworks…)
    if env.get("INTERVIEW_LLM_BASE_URL"):
        available["custom"] = Provider(
            "custom",
            env["INTERVIEW_LLM_BASE_URL"].rstrip("/"),
            _first_key(env.get("INTERVIEW_LLM_API_KEY")),
            fast_model=env.get("INTERVIEW_LLM_FAST_MODEL", "fast"),
            smart_model=env.get("INTERVIEW_LLM_SMART_MODEL", "smart"),
        )

    order = [p.strip() for p in env.get("INTERVIEW_LLM_ORDER", "custom,groq,gemini,openrouter,ollama").split(",") if p.strip()]
    return [available[n] for n in order if n in available]


_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=4.0, read=20.0, write=10.0, pool=4.0),
            limits=httpx.Limits(max_keepalive_connections=10, keepalive_expiry=120),
        )
    return _client


async def warm_up() -> None:
    """Open keep-alive connections to configured providers (cheap HEAD/GET).
    Called when an interview session is created so turn #1 doesn't pay the
    TLS handshake."""
    client = _get_client()

    async def _touch(p: Provider):
        try:
            await client.get(f"{p.base_url}/models", headers=p.headers, timeout=3.0)
        except Exception:
            pass

    await asyncio.gather(*[_touch(p) for p in configured_providers()[:2]])


class LLMUnavailable(RuntimeError):
    pass


@dataclass
class StreamResult:
    provider: str = "none"
    model: str = ""
    ttft_ms: Optional[int] = None
    total_ms: Optional[int] = None
    text: str = ""


async def stream_chat(
    messages: List[Dict[str, str]],
    *,
    smart: bool = False,
    temperature: float = 0.6,
    max_tokens: int = 160,
    first_token_timeout: float = 4.0,
    result: Optional[StreamResult] = None,
) -> AsyncIterator[str]:
    """Yield text deltas from the first provider that starts answering within
    ``first_token_timeout`` seconds. Raises ``LLMUnavailable`` if none do."""
    result = result if result is not None else StreamResult()
    client = _get_client()
    errors = []
    for p in configured_providers():
        model = p.smart_model if smart else p.fast_model
        body = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        t0 = time.perf_counter()
        got_any = False
        try:
            async with client.stream("POST", f"{p.base_url}/chat/completions", headers=p.headers, json=body) as resp:
                if resp.status_code != 200:
                    detail = (await resp.aread())[:200]
                    raise RuntimeError(f"HTTP {resp.status_code}: {detail!r}")
                lines = resp.aiter_lines()
                while True:
                    timeout = first_token_timeout if not got_any else 15.0
                    try:
                        line = await asyncio.wait_for(lines.__anext__(), timeout=timeout)
                    except StopAsyncIteration:
                        break
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = (choices[0].get("delta") or {}).get("content") or ""
                    if not delta:
                        continue
                    if not got_any:
                        got_any = True
                        result.provider, result.model = p.name, model
                        result.ttft_ms = int((time.perf_counter() - t0) * 1000)
                    result.text += delta
                    yield delta
            if got_any:
                result.total_ms = int((time.perf_counter() - t0) * 1000)
                return
            errors.append(f"{p.name}: empty response")
        except Exception as exc:  # timeout, HTTP error, network…
            if got_any:
                # Mid-stream failure: keep what we have rather than restarting.
                result.total_ms = int((time.perf_counter() - t0) * 1000)
                logger.warning("[LLM] %s failed mid-stream: %s", p.name, exc)
                return
            errors.append(f"{p.name}: {type(exc).__name__} {exc}")
            logger.warning("[LLM] %s unavailable (%s); trying next provider", p.name, exc)
    raise LLMUnavailable("; ".join(errors) or "no LLM provider configured")


async def complete_json(
    messages: List[Dict[str, str]],
    *,
    smart: bool = True,
    max_tokens: int = 900,
    timeout: float = 25.0,
) -> Optional[dict]:
    """Non-streaming JSON completion with provider failover. Returns parsed
    dict or None."""
    client = _get_client()
    for p in configured_providers():
        model = p.smart_model if smart else p.fast_model
        body = {
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        }
        try:
            resp = await client.post(f"{p.base_url}/chat/completions", headers=p.headers, json=body, timeout=timeout)
            if resp.status_code == 400 and "response_format" in resp.text:
                body.pop("response_format")
                resp = await client.post(f"{p.base_url}/chat/completions", headers=p.headers, json=body, timeout=timeout)
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"] or ""
            parsed = extract_json_object(content)
            if parsed is not None:
                parsed.setdefault("_provider", p.name)
                parsed.setdefault("_model", model)
                return parsed
        except Exception as exc:
            logger.warning("[LLM] JSON completion via %s failed: %s", p.name, exc)
    return None


def extract_json_object(text: str) -> Optional[dict]:
    import re

    if not text:
        return None
    text = re.sub(r"<think>[\s\S]*?</think>", "", text).strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        val = json.loads(text)
        return val if isinstance(val, dict) else None
    except Exception:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            val = json.loads(text[start : end + 1])
            return val if isinstance(val, dict) else None
        except Exception:
            return None
    return None
