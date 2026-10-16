"""Connection-pool tuning for hosted Postgres far away from the API.

Production measured ~0.3-0.9 s per network round trip (Render Oregon ->
Supabase Mumbai). With the stock settings every request paid, per Session:

    pre-ping SELECT 1  +  BEGIN  +  <queries>  +  ROLLBACK

i.e. three round trips of pure overhead on top of the real queries. This
module removes them without touching ``db.py``:

* **Idle-aware ping instead of ``pool_pre_ping``** - a pooled connection is
  pinged on checkout only when it has been idle longer than
  ``DB_PING_IDLE_SECONDS`` (default 60 s). Supabase's pooler / NAT drops idle
  sockets after minutes, so a connection reused seconds later (the normal
  case while a page loads) skips the extra round trip, but one that sat idle
  is still checked and transparently replaced (DisconnectionError -> the pool
  reconnects). ``pool_recycle`` from db.py still retires old connections.
* **Read-only autocommit** - psycopg2 sends a separate ``BEGIN`` before the
  first statement and the pool sends ``ROLLBACK`` when the connection is
  returned. A connection is now handed out in autocommit mode and switched
  back to a real transaction right before the first statement that is not a
  plain SELECT (INSERT/UPDATE/DELETE/DDL/SAVEPOINT/SELECT ... FOR UPDATE), so
  writes keep full transactional semantics (BEGIN ... COMMIT) while
  read-only requests cost exactly one round trip per query. Postgres'
  default READ COMMITTED isolation already gives each statement its own
  snapshot, so reads that precede a write behave the same as before.
  Disable with ``DB_READ_AUTOCOMMIT=0``.
* **Retry once on a dropped connection** for idempotent GET requests
  (``DisconnectRetryMiddleware``) so a connection killed mid-flight by the
  pooler does not surface as a 500.

SQLite (local dev + tests) is left untouched.
"""
from __future__ import annotations

import logging
import os
import time

from sqlalchemy import event, exc

logger = logging.getLogger("ats-platform")

_READ_PREFIXES = ("SELECT", "SHOW", "VALUES", "EXPLAIN")


def _flag(name: str, default: str) -> bool:
    return os.environ.get(name, default).strip().lower() not in ("0", "false", "no", "off")


def _is_plain_read(statement: str) -> bool:
    head = statement.lstrip()[:12].upper()
    if not head.startswith(_READ_PREFIXES):
        return False
    tail = statement[-80:].upper()
    return " FOR UPDATE" not in tail and " FOR SHARE" not in tail and " FOR NO KEY UPDATE" not in tail


def tune_engine(engine) -> None:
    if getattr(engine, "_corelink_tuned", False):
        return
    engine._corelink_tuned = True
    if engine.dialect.name != "postgresql":
        return

    idle_limit = float(os.environ.get("DB_PING_IDLE_SECONDS", "60"))
    read_autocommit = _flag("DB_READ_AUTOCOMMIT", "1")
    pool = engine.pool
    # Replace the unconditional pre-ping with the idle-aware one below.
    pool._pre_ping = False

    @event.listens_for(engine, "checkin")
    def _on_checkin(dbapi_conn, record):  # noqa: ANN001
        if record is not None:
            record.info["corelink_last_used"] = time.monotonic()

    @event.listens_for(engine, "checkout")
    def _on_checkout(dbapi_conn, record, proxy):  # noqa: ANN001
        last = record.info.get("corelink_last_used")
        if last is not None and time.monotonic() - last > idle_limit:
            try:
                engine.dialect.do_ping(dbapi_conn)
            except Exception as err:  # connection is dead -> let the pool replace it
                logger.info("[DB] idle connection failed ping, reconnecting: %s", type(err).__name__)
                raise exc.DisconnectionError() from err
        if read_autocommit:
            try:
                if not dbapi_conn.autocommit:
                    dbapi_conn.autocommit = True
            except Exception:  # pragma: no cover - e.g. connection mid-transaction
                pass

    if read_autocommit:
        @event.listens_for(engine, "before_cursor_execute")
        def _begin_before_write(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
            try:
                raw = conn.connection.dbapi_connection
            except Exception:  # pragma: no cover
                return
            if raw is None or not getattr(raw, "autocommit", False):
                return
            stream = bool(context is not None and context.execution_options.get("stream_results"))
            if stream or executemany or not _is_plain_read(statement):
                # psycopg2 issues BEGIN lazily before this statement; everything
                # after it in this Session is one transaction, as before.
                raw.autocommit = False

    logger.info("[DB] pool tuned: idle-ping>%.0fs, read-autocommit=%s", idle_limit, read_autocommit)


class DisconnectRetryMiddleware:
    """Retry an idempotent GET once when the DB connection was dropped under it."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in ("GET", "HEAD"):
            return await self.app(scope, receive, send)
        started = {"v": False}

        async def _send(message):
            if message["type"] == "http.response.start":
                started["v"] = True
            await send(message)

        try:
            return await self.app(scope, receive, _send)
        except exc.DBAPIError as err:
            if started["v"] or not getattr(err, "connection_invalidated", False):
                raise
            logger.warning("[DB] connection dropped during %s, retrying once", scope.get("path"))

        async def _empty_receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        return await self.app(scope, _empty_receive, send)
