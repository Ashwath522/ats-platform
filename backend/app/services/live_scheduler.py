"""Built-in schedule for live jobs/resources - no external cron needed.

While the API is running it:
  * starts a full sync shortly after startup when the last successful sync is
    older than LIVE_SYNC_INTERVAL_HOURS (so a server that just woke up refreshes
    straight away), then every LIVE_SYNC_INTERVAL_HOURS (default 6);
  * optionally pings its own public URL every 10 minutes (KEEP_AWAKE=true and
    RENDER_EXTERNAL_URL / PUBLIC_API_URL set) so a free Render instance does not
    fall asleep between syncs.

Turn it off with LIVE_SYNC_AUTO=false (tests and local dev do).
"""
import asyncio
import logging
import os
from datetime import timedelta
from typing import Optional

import httpx
from sqlmodel import Session, select

from ..db import SyncRun, engine, utc_now

log = logging.getLogger("ats-platform")

TICK_SECONDS = 600            # 10 minutes
FIRST_CHECK_SECONDS = 45      # let the app finish starting first

_state = {"task": None, "last_ping": None, "last_ping_ok": None, "last_auto_start": None}


def _flag(name: str, default: bool) -> bool:
    v = (os.environ.get(name) or "").strip().lower()
    return default if not v else v in ("1", "true", "yes", "on")


def enabled() -> bool:
    return _flag("LIVE_SYNC_AUTO", True)


def interval() -> timedelta:
    try:
        hours = float(os.environ.get("LIVE_SYNC_INTERVAL_HOURS") or 6)
    except ValueError:
        hours = 6
    return timedelta(hours=min(max(hours, 1), 72))


def public_url() -> Optional[str]:
    url = (os.environ.get("PUBLIC_API_URL") or os.environ.get("RENDER_EXTERNAL_URL") or "").strip().rstrip("/")
    return url if url.startswith("https://") else None


def keep_awake() -> bool:
    return _flag("KEEP_AWAKE", True) and bool(public_url())


def last_success():
    with Session(engine) as s:
        row = s.exec(select(SyncRun).where(SyncRun.kind == "jobs", SyncRun.status.in_(["ok", "partial"]))
                     .order_by(SyncRun.finished_at.desc())).first()
        return row.finished_at if row else None


def next_due():
    """When the next scheduled sync is due; None = never synced, due right away."""
    last = last_success()
    return (last + interval()) if last else None


def status() -> dict:
    nxt = next_due() or utc_now()
    last = last_success()
    return {
        "auto": enabled(),
        "interval_hours": interval().total_seconds() / 3600,
        "last_success_at": last.isoformat() + "Z" if last else None,
        "next_run_at": nxt.isoformat() + "Z" if enabled() else None,
        "keep_awake": keep_awake(),
        "last_ping_ok": _state["last_ping_ok"],
        "scheduler_running": bool(_state["task"] and not _state["task"].done()),
    }


async def _maybe_sync() -> bool:
    from . import live_sync
    due = next_due()
    if live_sync.is_running() or (due is not None and utc_now() < due):
        return False
    _state["last_auto_start"] = utc_now()
    log.info("[live-sync] scheduled sync starting")
    await asyncio.to_thread(live_sync.run_sync_blocking, "all", "schedule")
    return True


async def _ping(client: httpx.AsyncClient) -> None:
    url = public_url()
    if not url:
        return
    try:
        r = await client.get(f"{url}/health", timeout=20)
        _state["last_ping_ok"] = r.status_code == 200
    except Exception:
        _state["last_ping_ok"] = False
    _state["last_ping"] = utc_now()


async def _loop() -> None:
    await asyncio.sleep(FIRST_CHECK_SECONDS)
    async with httpx.AsyncClient() as client:
        while True:
            try:
                if keep_awake():
                    await _ping(client)
                await _maybe_sync()
            except asyncio.CancelledError:
                raise
            except Exception:  # never let the scheduler die
                log.exception("[live-sync] scheduler tick failed")
            await asyncio.sleep(TICK_SECONDS)


def start() -> None:
    if not enabled() or (_state["task"] and not _state["task"].done()):
        return
    _state["task"] = asyncio.get_event_loop().create_task(_loop())
    log.info("[live-sync] automatic sync every %.0fh (keep-awake: %s)", interval().total_seconds() / 3600, keep_awake())


async def stop() -> None:
    t = _state["task"]
    if t and not t.done():
        t.cancel()
        try:
            await t
        except (asyncio.CancelledError, Exception):
            pass
    _state["task"] = None
