"""Dev-only per-request query counter / timer.

Enable with ``PERF_LOG=1``: every request logs one line

    [PERF] GET /api/candidate/profile 200 queries=2 db=4.1ms total=9.8ms

and the response carries ``X-Query-Count`` / ``Server-Timing`` headers so the
numbers are visible in the browser's network tab.

``PERF_SIMULATE_DB_LATENCY_MS=700`` additionally sleeps that long before each
statement, which reproduces the production cross-region round-trip cost
locally (Render Oregon -> Supabase Mumbai is ~0.6-0.9 s per query).

The counter is also used by tests (``count_queries()``) to assert that hot
endpoints stay within their query budget. It is attached once to the shared
engine; when nothing is being counted the listener is a cheap no-op.
"""
from __future__ import annotations

import contextvars
import logging
import os
import time
from contextlib import contextmanager
from typing import Optional

from sqlalchemy import event

logger = logging.getLogger("ats-platform.perf")

_current: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar("perf_counter", default=None)
_installed_on: set = set()


def perf_enabled() -> bool:
    return os.environ.get("PERF_LOG", "").lower() in ("1", "true", "yes")


def _sim_latency() -> float:
    try:
        return max(0.0, float(os.environ.get("PERF_SIMULATE_DB_LATENCY_MS", "0") or 0)) / 1000.0
    except ValueError:
        return 0.0


def install(engine) -> None:
    """Attach the counting listeners to ``engine`` (idempotent)."""
    if id(engine) in _installed_on:
        return
    _installed_on.add(id(engine))

    @event.listens_for(engine, "before_cursor_execute")
    def _before(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        bucket = _current.get()
        if bucket is None:
            return
        delay = bucket.get("sim", 0.0)
        if delay:
            time.sleep(delay)
        conn.info.setdefault("_perf_t0", []).append(time.perf_counter())

    @event.listens_for(engine, "after_cursor_execute")
    def _after(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        bucket = _current.get()
        if bucket is None:
            return
        stack = conn.info.get("_perf_t0") or []
        t0 = stack.pop() if stack else time.perf_counter()
        bucket["count"] += 1
        bucket["ms"] += (time.perf_counter() - t0) * 1000.0
        if bucket.get("keep"):
            bucket["statements"].append(" ".join(statement.split())[:200])

    @event.listens_for(engine, "checkout")
    def _checkout(dbapi_conn, record, proxy):  # noqa: ANN001
        bucket = _current.get()
        if bucket is not None:
            bucket["checkouts"] += 1


def _new_bucket(keep: bool = False) -> dict:
    return {"count": 0, "checkouts": 0, "ms": 0.0, "statements": [], "keep": keep, "sim": _sim_latency() if perf_enabled() else 0.0}


@contextmanager
def count_queries(keep_statements: bool = True):
    """Count SQL statements executed inside the block (tests + scripts).

    Works across FastAPI's threadpool because the bucket is a mutable dict in
    a ContextVar and Starlette copies the context into worker threads."""
    bucket = _new_bucket(keep_statements)
    token = _current.set(bucket)
    try:
        yield bucket
    finally:
        _current.reset(token)


class PerfMiddleware:
    """Pure ASGI middleware (no BaseHTTPMiddleware: keeps streaming + context intact)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        bucket = _new_bucket(keep=os.environ.get("PERF_LOG_SQL", "") == "1")
        token = _current.set(bucket)
        t0 = time.perf_counter()
        status_holder = {"status": 0}

        async def _send(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                total = (time.perf_counter() - t0) * 1000.0
                headers = list(message.get("headers", []))
                headers.append((b"x-query-count", str(bucket["count"]).encode()))
                headers.append((b"x-db-checkouts", str(bucket["checkouts"]).encode()))
                headers.append((b"server-timing", f'db;desc="{bucket["count"]} queries";dur={bucket["ms"]:.1f}, app;dur={total:.1f}'.encode()))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            total = (time.perf_counter() - t0) * 1000.0
            path = scope.get("path", "")
            logger.warning("[PERF] %s %s %s queries=%d conns=%d db=%.1fms total=%.1fms",
                           scope.get("method"), path, status_holder["status"], bucket["count"], bucket["checkouts"], bucket["ms"], total)
            if bucket["keep"]:
                for s in bucket["statements"]:
                    logger.warning("[PERF]    %s", s)
            _current.reset(token)
