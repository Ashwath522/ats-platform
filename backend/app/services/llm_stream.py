"""
Low-latency, provider-agnostic LLM client for the live AI interviewer.

Every supported provider exposes an OpenAI-compatible ``/chat/completions``
endpoint, so one streaming implementation covers all of them:

    groq        https://api.groq.com/openai/v1                (GROQ_API_KEY)
    gemini      https://generativelanguage.googleapis.com/v1beta/openai  (GEMINI_API_KEY)
    openrouter  https://openrouter.ai/api/v1                  (OPENROUTER_API_KEY)
    ollama      $OLLAMA_BASE_URL/v1                           (local, no key)
    custom      $INTERVIEW_LLM_BASE_URL                       (mock server / any OpenAI-compatible host)

Latency design
--------------
* One shared ``httpx.AsyncClient`` with keep-alive (+ a background keep-alive
  ping while interviews are active) so turns don't pay TLS handshakes.
* Streaming, so the browser speaks the first sentence while the rest is still
  being generated.
* **Hedged failover**: if the preferred provider hasn't produced a first token
  after ``INTERVIEW_HEDGE_AFTER_S`` (default 0.9 s) the next provider is started
  in parallel and whichever answers first wins. A provider that errors (429,
  5xx, auth, bad model) fails over immediately; one that is silent for
  ``INTERVIEW_TTFT_BUDGET_S`` (default 2.5 s) is abandoned.
* **Circuit breaker**: a failing provider is put on a cooldown (longer for
  config errors such as a bad key or a retired model) so the next turns don't
  wait on it again; it is still used as a last resort.
* Every attempt is recorded (provider, model, status, HTTP code, TTFT — never
  keys or text) in ``llm_telemetry`` for the admin LLM status view.

API keys never reach the browser.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import httpx

from . import llm_telemetry as tel

logger = logging.getLogger("ats-platform.llm")


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass
class Provider:
    name: str
    base_url: str
    api_key: Optional[str]
    fast_model: str
    smart_model: str
    extra_headers: Dict[str, str] = field(default_factory=dict)
    # Provider-specific request fields (e.g. Gemini ``reasoning_effort: none``
    # so 2.5-flash doesn't spend the token budget "thinking"). Dropped
    # automatically if the provider rejects them.
    extra_body: Dict[str, Any] = field(default_factory=dict)

    @property
    def headers(self) -> Dict[str, str]:
        h = {"Content-Type": "application/json", **self.extra_headers}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def model_for(self, smart: bool) -> str:
        return self.smart_model if smart else self.fast_model


def _first_key(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    key = raw.split(",")[0].strip().strip('"').strip("'")
    return key or None


def _groq_base(env) -> str:
    """The official ``groq`` SDK reads ``GROQ_BASE_URL`` as the bare host
    (https://api.groq.com) and appends /openai/v1 itself, while this client
    needs the OpenAI-compatible root. Accept either spelling so one env var
    can't silently break the other client."""
    if env.get("INTERVIEW_GROQ_BASE_URL"):
        return env["INTERVIEW_GROQ_BASE_URL"].strip().rstrip("/")
    raw = (env.get("GROQ_BASE_URL") or "https://api.groq.com").strip().rstrip("/")
    if not raw.endswith("/openai/v1"):
        raw = raw[: -len("/openai")] if raw.endswith("/openai") else raw
        raw = f"{raw}/openai/v1"
    return raw


def configured_providers() -> List[Provider]:
    """Providers in preference order, only those that are configured."""
    env = os.environ
    available: Dict[str, Provider] = {}

    if _first_key(env.get("GROQ_API_KEY")):
        available["groq"] = Provider(
            "groq",
            _groq_base(env),
            _first_key(env.get("GROQ_API_KEY")),
            fast_model=env.get("INTERVIEW_GROQ_FAST_MODEL", "llama-3.1-8b-instant"),
            smart_model=env.get("INTERVIEW_GROQ_SMART_MODEL", "llama-3.3-70b-versatile"),
        )
    if _first_key(env.get("GEMINI_API_KEY")):
        effort = env.get("INTERVIEW_GEMINI_REASONING_EFFORT", "none").strip()
        available["gemini"] = Provider(
            "gemini",
            env.get("GEMINI_OPENAI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai").rstrip("/"),
            _first_key(env.get("GEMINI_API_KEY")),
            # gemini-2.0-flash was retired in 2026; 2.5 flash-lite is the fast free model.
            fast_model=env.get("INTERVIEW_GEMINI_FAST_MODEL", "gemini-2.5-flash-lite"),
            smart_model=env.get("INTERVIEW_GEMINI_SMART_MODEL", "gemini-2.5-flash"),
            extra_body={"reasoning_effort": effort} if effort else {},
        )
    if _first_key(env.get("OPENROUTER_API_KEY")):
        available["openrouter"] = Provider(
            "openrouter",
            env.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/"),
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


def _secrets() -> List[str]:
    return [p.api_key for p in configured_providers() if p.api_key]


# ── Circuit breaker ───────────────────────────────────────────────────────────

_HEALTH: Dict[str, Dict[str, Any]] = {}


def _cooldown_seconds(status: str, fails: int, retry_after: Optional[float]) -> float:
    if status == "rate_limited":
        return max(5.0, min(retry_after or 20.0, 90.0))
    if status in {"auth_error", "model_not_found"}:
        return 300.0  # configuration problem: don't keep paying for it every turn
    if status == "hedge_lost":
        return 120.0  # slower than a peer: prefer the peer for a while
    return min(30.0 * (2 ** max(0, fails - 1)), 300.0)


def mark_failure(name: str, status: str, retry_after: Optional[float] = None) -> None:
    h = _HEALTH.setdefault(name, {"fails": 0, "cool_until": 0.0})
    if status != "hedge_lost":
        h["fails"] = h.get("fails", 0) + 1
    h["cool_until"] = time.time() + _cooldown_seconds(status, h.get("fails", 1), retry_after)
    h["last_status"] = status


def mark_success(name: str) -> None:
    _HEALTH[name] = {"fails": 0, "cool_until": 0.0, "last_status": "ok", "last_ok": time.time()}


def reset_health() -> None:
    _HEALTH.clear()


def providers_by_health() -> List[Provider]:
    """Configured order, but providers on cooldown move to the back (still
    usable as a last resort)."""
    now = time.time()
    provs = configured_providers()
    healthy = [p for p in provs if _HEALTH.get(p.name, {}).get("cool_until", 0) <= now]
    cooling = sorted((p for p in provs if p not in healthy), key=lambda p: _HEALTH[p.name]["cool_until"])
    return healthy + cooling


def health_snapshot() -> Dict[str, dict]:
    now = time.time()
    out = {}
    for p in configured_providers():
        h = _HEALTH.get(p.name, {})
        out[p.name] = {
            "fast_model": p.fast_model,
            "smart_model": p.smart_model,
            "cooling_down_s": max(0, int(h.get("cool_until", 0) - now)),
            "consecutive_failures": h.get("fails", 0),
            "last_status": h.get("last_status"),
        }
    return out


# ── HTTP client ───────────────────────────────────────────────────────────────

_client: Optional[httpx.AsyncClient] = None
_client_loop: Optional[asyncio.AbstractEventLoop] = None


def _get_client() -> httpx.AsyncClient:
    """One keep-alive client per event loop (tests create several loops)."""
    global _client, _client_loop
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if _client is None or _client.is_closed or (_client_loop is not None and loop is not None and _client_loop is not loop):
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=_env_float("INTERVIEW_CONNECT_TIMEOUT_S", 2.0), read=20.0, write=5.0, pool=2.0),
            limits=httpx.Limits(max_connections=40, max_keepalive_connections=12, keepalive_expiry=90),
            http2=False,
        )
        _client_loop = loop
    return _client


_last_activity = 0.0
_keepalive_task: Optional[asyncio.Task] = None


async def warm_up() -> None:
    """Open keep-alive connections to the top providers (cheap GET /models).
    Called when an interview session is created / the candidate starts
    speaking, so the next turn doesn't pay the TLS handshake."""
    client = _get_client()

    async def _touch(p: Provider):
        try:
            await client.get(f"{p.base_url}/models", headers=p.headers, timeout=3.0)
        except Exception:
            pass

    await asyncio.gather(*[_touch(p) for p in providers_by_health()[:2]])


def touch_activity() -> None:
    """Keep provider connections warm while interviews are running (pings the
    top providers every ~25 s, stops after 3 idle minutes)."""
    global _last_activity, _keepalive_task
    _last_activity = time.time()
    if os.environ.get("INTERVIEW_KEEPALIVE", "1").lower() in {"0", "false", "no"} or os.environ.get("TESTING") == "1":
        return
    if not configured_providers():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if _keepalive_task is None or _keepalive_task.done():
        _keepalive_task = loop.create_task(_keepalive_loop())


async def _keepalive_loop() -> None:
    interval = _env_float("INTERVIEW_KEEPALIVE_INTERVAL_S", 25.0)
    try:
        while time.time() - _last_activity < 180:
            await asyncio.sleep(interval)
            await warm_up()
    except asyncio.CancelledError:  # pragma: no cover
        pass
    except Exception:  # pragma: no cover
        pass


class LLMUnavailable(RuntimeError):
    pass


class ProviderError(RuntimeError):
    def __init__(self, status: str, message: str, http_status: Optional[int] = None, retry_after: Optional[float] = None):
        super().__init__(message)
        self.status = status
        self.http_status = http_status
        self.retry_after = retry_after


def _classify_http(code: int, body: str) -> str:
    low = (body or "").lower()
    if code == 429:
        return "rate_limited"
    if code in (401, 403):
        return "auth_error"
    if code == 404 or ("model" in low and ("not found" in low or "does not exist" in low or "decommissioned" in low or "not supported" in low)):
        return "model_not_found"
    if code >= 500:
        return "http_5xx"
    return "http_4xx"


def _retry_after(resp: httpx.Response) -> Optional[float]:
    try:
        v = resp.headers.get("retry-after")
        return float(v) if v else None
    except Exception:
        return None


def _rejects_extra(code: int, body: str, extra: Dict[str, Any]) -> bool:
    return code == 400 and bool(extra) and any(k in (body or "") for k in extra)


@dataclass
class StreamResult:
    provider: str = "none"
    model: str = ""
    ttft_ms: Optional[int] = None
    total_ms: Optional[int] = None
    text: str = ""
    attempts: List[str] = field(default_factory=list)


async def _attempt_stream(idx: int, p: Provider, model: str, messages, temperature: float, max_tokens: int, q: asyncio.Queue) -> None:
    """Stream one provider into the shared queue as (idx, kind, payload)."""
    client = _get_client()
    body: Dict[str, Any] = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens, "stream": True}
    extra = dict(p.extra_body)
    try:
        for _variant in range(2):
            req = {**body, **extra}
            async with client.stream("POST", f"{p.base_url}/chat/completions", headers=p.headers, json=req) as resp:
                if resp.status_code != 200:
                    detail = (await resp.aread())[:400].decode("utf-8", "replace")
                    if _rejects_extra(resp.status_code, detail, extra):
                        extra = {}
                        continue
                    raise ProviderError(_classify_http(resp.status_code, detail), f"HTTP {resp.status_code}: {detail}", resp.status_code, _retry_after(resp))
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(chunk, dict) and chunk.get("error"):
                        raise ProviderError("http_5xx", f"stream error: {chunk.get('error')}")
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = (choices[0].get("delta") or {}).get("content") or ""
                    if delta:
                        await q.put((idx, "tok", delta))
                await q.put((idx, "done", None))
                return
        raise ProviderError("http_4xx", "request rejected")
    except asyncio.CancelledError:
        raise
    except ProviderError as exc:
        await q.put((idx, "err", exc))
    except httpx.ConnectTimeout as exc:
        await q.put((idx, "err", ProviderError("timeout_connect", f"connect timeout: {exc}")))
    except (httpx.TimeoutException, asyncio.TimeoutError) as exc:
        await q.put((idx, "err", ProviderError("timeout_first_token", f"read timeout: {exc}")))
    except Exception as exc:  # network, DNS, protocol…
        await q.put((idx, "err", ProviderError("network", f"{type(exc).__name__}: {exc}")))


async def stream_chat(
    messages: List[Dict[str, str]],
    *,
    smart: bool = False,
    temperature: float = 0.6,
    max_tokens: int = 160,
    first_token_timeout: Optional[float] = None,
    hedge_after: Optional[float] = None,
    result: Optional[StreamResult] = None,
    operation: str = "turn",
) -> AsyncIterator[str]:
    """Yield text deltas from the first provider that starts answering.

    Raises ``LLMUnavailable`` if no provider produced a token."""
    result = result if result is not None else StreamResult()
    provs = providers_by_health()
    if not provs:
        raise LLMUnavailable("no LLM provider configured")
    ftt = first_token_timeout if first_token_timeout is not None else _env_float("INTERVIEW_TTFT_BUDGET_S", 2.5)
    hedge = hedge_after if hedge_after is not None else _env_float("INTERVIEW_HEDGE_AFTER_S", 0.9)
    stall = _env_float("INTERVIEW_STALL_TIMEOUT_S", 8.0)
    loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue()
    active: Dict[int, Tuple[asyncio.Task, Provider, str, float]] = {}
    errors: List[str] = []
    launched = 0
    last_launch = 0.0

    def launch() -> None:
        nonlocal launched, last_launch
        p = provs[launched]
        model = p.model_for(smart)
        t0 = loop.time()
        task = loop.create_task(_attempt_stream(launched, p, model, messages, temperature, max_tokens, q))
        active[launched] = (task, p, model, t0)
        result.attempts.append(p.name)
        launched += 1
        last_launch = t0

    def fail(idx: int, exc: ProviderError) -> None:
        task, p, model, t0 = active.pop(idx)
        ms = int((loop.time() - t0) * 1000)
        mark_failure(p.name, exc.status, exc.retry_after)
        tel.record_llm_event(p.name, model, operation, exc.status, http_status=exc.http_status, total_ms=ms, error=tel.redact(str(exc), _secrets()))
        logger.warning("[LLM] %s/%s %s failed: %s (HTTP %s) after %d ms; failing over", p.name, model, operation, exc.status, exc.http_status, ms)
        errors.append(f"{p.name}: {exc.status}")

    winner: Optional[int] = None
    try:
        launch()
        while winner is None:
            if not active and launched >= len(provs):
                raise LLMUnavailable("; ".join(errors) or "no provider answered")
            now = loop.time()
            waits = [t0 + ftt - now for (_t, _p, _m, t0) in active.values()]
            if launched < len(provs):
                waits.append((last_launch + hedge - now) if active else 0.0)
            wait = max(0.0, min(waits)) if waits else 0.0
            try:
                idx, kind, payload = await asyncio.wait_for(q.get(), timeout=wait)
            except asyncio.TimeoutError:
                now = loop.time()
                for idx in [i for i, (_t, _p, _m, t0) in active.items() if now - t0 >= ftt]:
                    active[idx][0].cancel()
                    fail(idx, ProviderError("timeout_first_token", f"no first token within {ftt:.1f}s"))
                if launched < len(provs) and (not active or now - last_launch >= hedge):
                    launch()
                continue
            if idx not in active:
                continue  # late event from an abandoned attempt
            if kind == "err":
                fail(idx, payload)
                if launched < len(provs):
                    launch()
                continue
            if kind == "done":
                task, p, model, t0 = active.pop(idx)
                tel.record_llm_event(p.name, model, operation, "empty", total_ms=int((loop.time() - t0) * 1000))
                mark_failure(p.name, "empty")
                errors.append(f"{p.name}: empty")
                if launched < len(provs):
                    launch()
                continue
            # first token → winner
            winner = idx
            task, p, model, t0 = active[idx]
            result.provider, result.model = p.name, model
            result.ttft_ms = int((loop.time() - t0) * 1000)
            for other in [i for i in active if i != idx]:
                ot, op_, om, ot0 = active.pop(other)
                ot.cancel()
                mark_failure(op_.name, "hedge_lost")
                tel.record_llm_event(op_.name, om, operation, "hedge_lost", total_ms=int((loop.time() - ot0) * 1000))
            result.text += payload
            yield payload

        # Stream the winner to the end.
        task, p, model, t0 = active[winner]
        while True:
            try:
                idx, kind, payload = await asyncio.wait_for(q.get(), timeout=stall)
            except asyncio.TimeoutError:
                logger.warning("[LLM] %s stalled mid-stream; keeping partial reply", p.name)
                break
            if idx != winner:
                continue
            if kind == "tok":
                result.text += payload
                yield payload
            elif kind == "err":
                logger.warning("[LLM] %s failed mid-stream (%s); keeping partial reply", p.name, payload)
                break
            else:
                break
        result.total_ms = int((loop.time() - t0) * 1000)
        mark_success(p.name)
        tel.record_llm_event(p.name, model, operation, "ok", ttft_ms=result.ttft_ms, total_ms=result.total_ms,
                             extra={"chars": len(result.text), "hedged": len(result.attempts) > 1})
    finally:
        for task, *_rest in list(active.values()):
            if not task.done():
                task.cancel()


async def _one_completion(p: Provider, messages, *, smart: bool, max_tokens: int, timeout: float, json_mode: bool,
                          temperature: float, operation: str) -> Tuple[str, str, str]:
    """One non-streaming call; records telemetry; raises ProviderError."""
    client = _get_client()
    model = p.model_for(smart)
    body: Dict[str, Any] = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens, **p.extra_body}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    t0 = time.perf_counter()
    try:
        resp = None
        for _variant in range(3):
            resp = await client.post(f"{p.base_url}/chat/completions", headers=p.headers, json=body, timeout=timeout)
            if resp.status_code == 400 and "response_format" in body and "response_format" in resp.text:
                body.pop("response_format")
                continue
            if _rejects_extra(resp.status_code, resp.text, {k: v for k, v in p.extra_body.items() if k in body}):
                for k in p.extra_body:
                    body.pop(k, None)
                continue
            break
        if resp.status_code != 200:
            raise ProviderError(_classify_http(resp.status_code, resp.text), f"HTTP {resp.status_code}: {resp.text[:300]}", resp.status_code, _retry_after(resp))
        content = (resp.json().get("choices") or [{}])[0].get("message", {}).get("content") or ""
        if not content.strip():
            raise ProviderError("empty", "empty content")
        ms = int((time.perf_counter() - t0) * 1000)
        mark_success(p.name)
        tel.record_llm_event(p.name, model, operation, "ok", total_ms=ms, ttft_ms=ms, extra={"chars": len(content)})
        return content, p.name, model
    except asyncio.CancelledError:
        mark_failure(p.name, "hedge_lost")
        tel.record_llm_event(p.name, model, operation, "hedge_lost", total_ms=int((time.perf_counter() - t0) * 1000))
        raise
    except Exception as exc:
        if not isinstance(exc, ProviderError):
            status = "timeout_first_token" if isinstance(exc, (httpx.TimeoutException, asyncio.TimeoutError)) else "network"
            exc = ProviderError(status, f"{type(exc).__name__}: {exc}")
        ms = int((time.perf_counter() - t0) * 1000)
        mark_failure(p.name, exc.status, exc.retry_after)
        tel.record_llm_event(p.name, model, operation, exc.status, http_status=exc.http_status, total_ms=ms, error=tel.redact(str(exc), _secrets()))
        logger.warning("[LLM] %s/%s %s failed: %s (HTTP %s) after %d ms", p.name, model, operation, exc.status, exc.http_status, ms)
        raise exc


async def complete_text(
    messages: List[Dict[str, str]],
    *,
    smart: bool = True,
    max_tokens: int = 900,
    timeout: float = 25.0,
    deadline: Optional[float] = None,
    json_mode: bool = True,
    temperature: float = 0.2,
    operation: str = "json",
    providers: Optional[List[Provider]] = None,
    hedge_after: Optional[float] = None,
) -> Optional[Tuple[str, str, str]]:
    """Non-streaming completion with failover inside an overall ``deadline``
    (seconds). A provider that errors fails over at once; with ``hedge_after``
    a slow provider gets a parallel backup request after that many seconds and
    the first good answer wins. Returns (content, provider, model) or None."""
    provs = list(providers or providers_by_health())
    if not provs:
        return None
    loop = asyncio.get_running_loop()
    start = loop.time()
    budget = deadline if deadline is not None else timeout * 2
    pending: Dict[asyncio.Task, Provider] = {}
    launched = 0

    def launch() -> None:
        nonlocal launched
        remaining = budget - (loop.time() - start)
        p = provs[launched]
        launched += 1
        t = loop.create_task(_one_completion(p, messages, smart=smart, max_tokens=max_tokens, timeout=max(0.5, min(timeout, remaining)),
                                             json_mode=json_mode, temperature=temperature, operation=operation))
        pending[t] = p

    try:
        launch()
        while pending or launched < len(provs):
            remaining = budget - (loop.time() - start)
            if remaining <= 0.3:
                break
            if not pending:
                launch()
                continue
            wait = remaining
            if hedge_after is not None and launched < len(provs):
                wait = min(wait, hedge_after)
            done, _ = await asyncio.wait(list(pending), timeout=wait, return_when=asyncio.FIRST_COMPLETED)
            if not done:
                if launched < len(provs):
                    launch()  # hedge: slow provider keeps running, a backup starts
                continue
            for t in done:
                pending.pop(t, None)
                if t.exception() is None:
                    return t.result()
            if launched < len(provs):
                launch()
        return None
    finally:
        for t in pending:
            t.cancel()


async def complete_json(
    messages: List[Dict[str, str]],
    *,
    smart: bool = True,
    max_tokens: int = 900,
    timeout: float = 25.0,
    deadline: Optional[float] = None,
    operation: str = "json",
    return_raw: bool = False,
    hedge_after: Optional[float] = None,
) -> Optional[dict]:
    """Non-streaming JSON completion with provider failover. Returns the parsed
    dict (with ``_provider``/``_model``) or None. With ``return_raw`` an
    unparseable reply comes back as ``{"_raw": text, "_parse_error": True}`` so
    the caller can run a repair round."""
    got = await complete_text(messages, smart=smart, max_tokens=max_tokens, timeout=timeout, deadline=deadline, operation=operation, hedge_after=hedge_after)
    if not got:
        return None
    content, provider, model = got
    parsed = extract_json_object(content)
    if parsed is None:
        tel.record_llm_event(provider, model, operation, "bad_json", error=content[:120].replace("\n", " "))
        if return_raw:
            return {"_raw": content[:4000], "_parse_error": True, "_provider": provider, "_model": model}
        return None
    parsed.setdefault("_provider", provider)
    parsed.setdefault("_model", model)
    return parsed


def extract_json_object(text: str) -> Optional[dict]:
    if not text:
        return None
    text = re.sub(r"<think>[\s\S]*?</think>", "", text).strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    for candidate in _json_candidates(text):
        try:
            val = json.loads(candidate)
            if isinstance(val, dict):
                return val
        except Exception:
            continue
    return None


def _json_candidates(text: str):
    yield text
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        body = text[start : end + 1]
        yield body
        # common small-model slips: trailing commas, smart quotes
        fixed = re.sub(r",\s*([}\]])", r"\1", body).replace("“", '"').replace("”", '"')
        yield fixed


# ── Diagnostics (health check / admin) ────────────────────────────────────────

async def probe_providers(chat: bool = False, timeout: float = 4.0) -> Dict[str, dict]:
    """Check each configured provider with the same endpoint, key and model the
    interviewer uses. ``chat=True`` also sends a 1-token completion to the fast
    model (proves the model name is valid). Never returns keys."""
    client = _get_client()

    async def one(p: Provider) -> Tuple[str, dict]:
        info: Dict[str, Any] = {"configured": True, "reachable": False, "base_url": p.base_url, "fast_model": p.fast_model, "smart_model": p.smart_model}
        t0 = time.perf_counter()
        try:
            r = await client.get(f"{p.base_url}/models", headers=p.headers, timeout=timeout)
            info["http_status"] = r.status_code
            info["latency_ms"] = int((time.perf_counter() - t0) * 1000)
            if r.status_code == 200:
                info["reachable"] = True
                try:
                    ids = {str(m.get("id", "")).split("/")[-1] for m in (r.json().get("data") or []) if isinstance(m, dict)}
                    if ids:
                        info["fast_model_listed"] = p.fast_model.split("/")[-1] in ids
                        info["smart_model_listed"] = p.smart_model.split("/")[-1] in ids
                except Exception:
                    pass
            else:
                info["status"] = _classify_http(r.status_code, r.text)
                info["error"] = tel.redact(r.text[:200], _secrets())
        except Exception as exc:
            info["status"] = "network"
            info["error"] = tel.redact(f"{type(exc).__name__}: {exc}", _secrets())
        if chat and info["reachable"]:
            t1 = time.perf_counter()
            try:
                body = {"model": p.fast_model, "messages": [{"role": "user", "content": "Say OK."}], "max_tokens": 3, "temperature": 0, **p.extra_body}
                r = await client.post(f"{p.base_url}/chat/completions", headers=p.headers, json=body, timeout=timeout + 4)
                if _rejects_extra(r.status_code, r.text, p.extra_body):
                    body = {k: v for k, v in body.items() if k not in p.extra_body}
                    r = await client.post(f"{p.base_url}/chat/completions", headers=p.headers, json=body, timeout=timeout + 4)
                info["chat_ok"] = r.status_code == 200
                info["chat_http_status"] = r.status_code
                info["chat_latency_ms"] = int((time.perf_counter() - t1) * 1000)
                if r.status_code != 200:
                    info["chat_status"] = _classify_http(r.status_code, r.text)
                    info["chat_error"] = tel.redact(r.text[:200], _secrets())
            except Exception as exc:
                info["chat_ok"] = False
                info["chat_error"] = tel.redact(f"{type(exc).__name__}: {exc}", _secrets())
        return p.name, info

    pairs = await asyncio.gather(*[one(p) for p in configured_providers()])
    return dict(pairs)
