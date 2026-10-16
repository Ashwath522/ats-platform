import json
import logging
import time
from contextlib import contextmanager
from typing import Optional, Dict, Any

telemetry_logger = logging.getLogger("ai_telemetry")
if not telemetry_logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[AI_TELEMETRY] %(message)s"))
    telemetry_logger.addHandler(handler)
    telemetry_logger.setLevel(logging.INFO)


@contextmanager
def trace_llm_call(provider: str, model: str, operation: str, extra: Optional[Dict[str, Any]] = None):
    """
    Context manager for measuring and logging structured telemetry for an LLM call.
    Logs provider, model, latency_ms, status, error, and metadata.
    """
    start = time.perf_counter()
    record = {
        "timestamp": time.time(),
        "provider": provider,
        "model": model,
        "operation": operation,
        "success": False,
        "latency_ms": 0.0,
        "error": None,
    }
    if extra:
        record.update(extra)

    try:
        yield record
        record["success"] = True
    except Exception as exc:
        record["success"] = False
        record["error"] = str(exc)
        raise
    finally:
        record["latency_ms"] = round((time.perf_counter() - start) * 1000, 2)
        try:
            telemetry_logger.info(json.dumps(record))
        except Exception:
            telemetry_logger.info(str(record))


# ── Live LLM call log (interviewer + scoring) ─────────────────────────────────
# A small in-process ring buffer so admins can see which provider actually
# answered, how fast, and why a provider failed — without ever storing keys or
# prompt/answer text. Every event is also emitted as one structured log line.

import re as _re
import threading as _threading
from collections import deque as _deque

_EVENTS: "_deque[dict]" = _deque(maxlen=400)
_EVENTS_LOCK = _threading.Lock()
_KEY_PAT = _re.compile(r"(gsk_|AIza|sk-or-v1-|sk-or-|sk-|xai-|Bearer\s+)[A-Za-z0-9_\-\.]{6,}")


def redact(text: Any, secrets: Optional[list] = None) -> str:
    """Strip anything that looks like an API key (and any explicitly passed secret)."""
    s = str(text or "")
    for sec in secrets or []:
        if sec and len(sec) >= 6:
            s = s.replace(sec, "[redacted]")
    return _KEY_PAT.sub("[redacted]", s)[:300]


def record_llm_event(
    provider: str,
    model: str,
    operation: str,
    status: str,
    *,
    http_status: Optional[int] = None,
    ttft_ms: Optional[int] = None,
    total_ms: Optional[int] = None,
    error: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> dict:
    """status: ok | rate_limited | http_4xx | http_5xx | auth_error | model_not_found |
    timeout_connect | timeout_first_token | network | empty | bad_json | hedge_lost"""
    ev = {
        "ts": round(time.time(), 3),
        "provider": provider,
        "model": model,
        "operation": operation,
        "status": status,
        "success": status == "ok",
        "http_status": http_status,
        "ttft_ms": ttft_ms,
        "latency_ms": total_ms,
        "error": redact(error) if error else None,
    }
    if extra:
        ev.update(extra)
    with _EVENTS_LOCK:
        _EVENTS.append(ev)
    try:
        if status in ("ok", "hedge_lost"):
            telemetry_logger.info(json.dumps(ev))
        else:
            telemetry_logger.warning(json.dumps(ev))
    except Exception:  # pragma: no cover
        pass
    return ev


def recent_llm_events(limit: int = 50) -> list:
    with _EVENTS_LOCK:
        items = list(_EVENTS)
    return items[-max(1, min(limit, 400)):][::-1]


def llm_stats(window_s: float = 3600.0) -> Dict[str, dict]:
    """Per-provider success/failure counts, median first-token latency and last error."""
    cutoff = time.time() - window_s
    with _EVENTS_LOCK:
        items = [e for e in _EVENTS if e["ts"] >= cutoff]
    out: Dict[str, dict] = {}
    for e in items:
        st = out.setdefault(e["provider"], {"ok": 0, "failed": 0, "hedge_lost": 0, "ttft_ms": [], "last_error": None, "last_ok_ts": None, "models": set()})
        st["models"].add(e.get("model") or "")
        if e["status"] == "ok":
            st["ok"] += 1
            st["last_ok_ts"] = e["ts"]
            if e.get("ttft_ms") is not None:
                st["ttft_ms"].append(e["ttft_ms"])
        elif e["status"] == "hedge_lost":
            st["hedge_lost"] += 1
        else:
            st["failed"] += 1
            st["last_error"] = {"status": e["status"], "http_status": e.get("http_status"), "error": e.get("error"), "ts": e["ts"], "operation": e["operation"]}
    for st in out.values():
        xs = sorted(st.pop("ttft_ms"))
        st["ttft_p50_ms"] = xs[len(xs) // 2] if xs else None
        st["ttft_p90_ms"] = xs[min(len(xs) - 1, int(len(xs) * 0.9))] if xs else None
        st["models"] = sorted(m for m in st["models"] if m)
    return out


def clear_llm_events() -> None:
    with _EVENTS_LOCK:
        _EVENTS.clear()
