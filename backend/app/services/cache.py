"""Tiny in-process TTL caches with automatic invalidation on table writes.

Read-mostly data (open job board, company names/logos, public stats, branch
vocabulary) is requested by almost every page, but changes rarely. Each
cache declares the tables it depends on; any INSERT/UPDATE/DELETE that goes
through the shared engine on one of those tables clears it - immediately
(before the statement runs) and again when that connection commits, so a
concurrent reader cannot re-fill the cache with pre-commit data.

The API runs as one uvicorn worker (Dockerfile ``--workers 1``) so a process
cache is coherent; the TTL bounds staleness for anything written outside the
engine (another process, manual SQL).

    jobs_cache = TTLCache("open_jobs", ttl=60, tables={"job"})
    rows = jobs_cache.get_or_set("all", loader)
"""
from __future__ import annotations

import re
import threading
import time
from typing import Any, Callable, Dict, Hashable, Iterable, List, Optional, Set

from sqlalchemy import event

_WRITE_RE = re.compile(r'^\s*(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+"?([A-Za-z_][\w]*)"?', re.I)

_registry: List["TTLCache"] = []
_registry_lock = threading.Lock()
_installed: set = set()


def written_table(statement: str) -> Optional[str]:
    m = _WRITE_RE.match(statement[:200])
    return m.group(1).lower() if m else None


class TTLCache:
    def __init__(self, name: str, ttl: float, tables: Iterable[str] = (), max_entries: int = 512):
        self.name = name
        self.ttl = float(ttl)
        self.tables: Set[str] = {t.lower() for t in tables}
        self.max_entries = max_entries
        self._data: Dict[Hashable, tuple] = {}
        self._lock = threading.Lock()
        self._gen = 0  # bumped on every invalidation; stale loads are not stored
        self.hits = 0
        self.misses = 0
        with _registry_lock:
            _registry.append(self)

    def get(self, key: Hashable, default: Any = None) -> Any:
        hit = self._data.get(key)
        if hit and hit[0] > time.monotonic():
            self.hits += 1
            return hit[1]
        return default

    def set(self, key: Hashable, value: Any, gen: Optional[int] = None) -> None:
        if self.ttl <= 0:
            return
        with self._lock:
            if gen is not None and gen != self._gen:
                return  # invalidated while loading -> don't cache possibly stale data
            if len(self._data) >= self.max_entries:
                self._data.clear()
            self._data[key] = (time.monotonic() + self.ttl, value)

    def get_or_set(self, key: Hashable, loader: Callable[[], Any]) -> Any:
        hit = self._data.get(key)
        if hit and hit[0] > time.monotonic():
            self.hits += 1
            return hit[1]
        self.misses += 1
        gen = self._gen
        value = loader()
        self.set(key, value, gen)
        return value

    def invalidate(self, key: Optional[Hashable] = None) -> None:
        with self._lock:
            self._gen += 1
            if key is None:
                self._data.clear()
            else:
                self._data.pop(key, None)


def invalidate_tables(tables: Iterable[str]) -> None:
    tables = {t.lower() for t in tables}
    for c in list(_registry):
        if c.tables & tables:
            c.invalidate()


def clear_all() -> None:
    for c in list(_registry):
        c.invalidate()


def install(engine) -> None:
    """Hook table-write detection into ``engine`` (idempotent)."""
    if id(engine) in _installed:
        return
    _installed.add(id(engine))

    @event.listens_for(engine, "before_cursor_execute")
    def _sniff(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        table = written_table(statement)
        if not table:
            return
        invalidate_tables((table,))
        conn.info.setdefault("corelink_dirty_tables", set()).add(table)

    def _flush_dirty(conn):  # noqa: ANN001
        dirty = conn.info.pop("corelink_dirty_tables", None)
        if dirty:
            invalidate_tables(dirty)

    event.listen(engine, "commit", _flush_dirty)
    event.listen(engine, "rollback", _flush_dirty)
