"""The only place project analysis talks to AI models.

- Text reasoning (claims, verification) goes through the existing multi-provider
  client (Groq / Gemini / OpenRouter failover) in ``llm_stream``.
- Images and video go to Gemini's native API (free tier), which can read
  inline images and public YouTube links.
- Every call is counted against a daily budget and cached by input hash, so
  free quotas stretch further and repeat analyses cost nothing.
- Failures return None; callers then fall back to deterministic results.

Tests replace ``llm_json`` / ``gemini_json`` with fakes — no network in tests.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import threading
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from sqlmodel import Session, select

from ...db import AnalysisCache, engine

logger = logging.getLogger("ats-platform")
_lock = threading.Lock()


def daily_limit() -> int:
    try:
        return max(0, int(os.environ.get("PROJECT_ANALYSIS_MAX_LLM_CALLS_PER_DAY", "40")))
    except ValueError:
        return 40


def _budget_key() -> str:
    return f"pa:budget:{datetime.utcnow():%Y%m%d}"


def calls_today() -> int:
    with Session(engine) as s:
        row = s.exec(select(AnalysisCache).where(AnalysisCache.cache_key == _budget_key())).first()
        return int(json.loads(row.payload_json).get("n", 0)) if row else 0


def take_budget() -> bool:
    """Reserve one AI call for today. False when the daily budget is used up."""
    with _lock, Session(engine) as s:
        key = _budget_key()
        row = s.exec(select(AnalysisCache).where(AnalysisCache.cache_key == key)).first()
        n = int(json.loads(row.payload_json).get("n", 0)) if row else 0
        if n >= daily_limit():
            return False
        row = row or AnalysisCache(cache_key=key, payload_json="{}")
        row.payload_json = json.dumps({"n": n + 1})
        s.add(row)
        s.commit()
        return True


def cache_get(key: str) -> Optional[dict]:
    with Session(engine) as s:
        row = s.exec(select(AnalysisCache).where(AnalysisCache.cache_key == key)).first()
        return json.loads(row.payload_json) if row else None


def cache_put(key: str, value: dict) -> None:
    with Session(engine) as s:
        row = s.exec(select(AnalysisCache).where(AnalysisCache.cache_key == key)).first() or AnalysisCache(cache_key=key, payload_json="{}")
        row.payload_json = json.dumps(value)
        s.add(row)
        s.commit()


def text_ai_available() -> bool:
    from .. import llm_stream
    return bool(llm_stream.configured_providers())


def gemini_available() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY", "").split(",")[0].strip())


def _run(coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    box: Dict[str, Any] = {}
    t = threading.Thread(target=lambda: box.setdefault("v", asyncio.run(coro)))
    t.start()
    t.join()
    return box.get("v")


def llm_json(system: str, user: str, *, operation: str, max_tokens: int = 1500) -> Optional[dict]:
    """JSON from the text-model failover chain, or None (not configured / quota / error)."""
    if not text_ai_available():
        return None
    key = "pa:llm:" + hashlib.sha256((operation + system + user).encode()).hexdigest()
    hit = cache_get(key)
    if hit is not None:
        return hit
    if not take_budget():
        raise QuotaExceeded()
    from .. import llm_stream
    try:
        out = _run(llm_stream.complete_json([{"role": "system", "content": system}, {"role": "user", "content": user}],
                                            smart=True, max_tokens=max_tokens, timeout=45.0, operation=f"project_{operation}"))
    except Exception as exc:
        logger.warning("[project-analysis] %s failed: %s", operation, exc)
        return None
    if out:
        out = {k: v for k, v in out.items() if not k.startswith("_")}
        cache_put(key, out)
    return out


class QuotaExceeded(RuntimeError):
    """Daily AI budget used up — callers mark the step 'pending' instead of failing."""


def gemini_json(parts: List[dict], *, operation: str, cache_key: str, max_tokens: int = 4096, timeout: float = 120.0) -> Optional[dict]:
    """Call Gemini's native generateContent with images / a YouTube URL; JSON reply or None."""
    if not gemini_available():
        return None
    key = f"pa:gem:{operation}:{cache_key}"
    hit = cache_get(key)
    if hit is not None:
        return hit
    if not take_budget():
        raise QuotaExceeded()
    api_key = os.environ["GEMINI_API_KEY"].split(",")[0].strip()
    model = os.environ.get("PROJECT_ANALYSIS_GEMINI_MODEL", "gemini-2.5-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body = {"contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1, "maxOutputTokens": max_tokens}}
    try:
        r = httpx.post(url, params={"key": api_key}, json=body, timeout=timeout)
        if r.status_code == 429:
            raise QuotaExceeded()
        if r.status_code != 200:
            logger.warning("[project-analysis] gemini %s HTTP %s: %s", operation, r.status_code, r.text[:200].replace(api_key, "***"))
            return None
        cand = (r.json().get("candidates") or [{}])[0]
        text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", []))
        from ..llm_stream import extract_json_object
        out = extract_json_object(text)
    except QuotaExceeded:
        raise
    except Exception as exc:
        logger.warning("[project-analysis] gemini %s failed: %s", operation, type(exc).__name__)
        return None
    if out:
        cache_put(key, out)
    return out


def image_part(data: bytes, mime: str = "image/jpeg") -> dict:
    return {"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}}
