"""
AI interview proctoring evidence (real interviews only — never practice).

The candidate's browser runs every computer-vision check on-device; video
never leaves it. Only two things reach the server:

* ``POST /api/interview/{sid}/proctor/events``   – a batched event log
  (``tab_switched``, ``looking_away``, ``phone_detected`` …).
* ``POST /api/interview/{sid}/proctor/snapshot`` – one small JPEG frame when a
  medium/high event fires (client-side cooldown per event type) and one
  baseline "identity" frame at the start.

Reviewers (the recruiter who owns the job, and CoreLink admins) read them via
``GET /api/proctoring/...``. Candidates can never list them. Rows are purged
after ``PROCTOR_RETENTION_DAYS`` (default 90) by :func:`purge_old_proctor_evidence`
(startup + opportunistically at most hourly) and on a candidate's deletion
request (:func:`delete_application_evidence`).
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import delete as sa_delete, func, text, update as sa_update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..auth import get_current_candidate, get_current_user
from ..db import (
    Application,
    CandidateProfile,
    CandidateUser,
    InterviewSession,
    Job,
    ProctorEvent,
    ProctorSnapshot,
    RecruiterUser,
    User,
    engine,
    utc_now,
)
from ..rate_limit import limiter

logger = logging.getLogger("ats-platform.proctoring")
router = APIRouter(tags=["proctoring"])

MAX_SNAPSHOT_BYTES = 150 * 1024
MAX_SNAPSHOTS_PER_SESSION = int(os.environ.get("PROCTOR_MAX_SNAPSHOTS", "32"))
MAX_BASELINE_PER_SESSION = 2
MAX_EVENTS_PER_BATCH = 50
MAX_EVENTS_PER_SESSION = int(os.environ.get("PROCTOR_MAX_EVENTS", "600"))
MAX_DIMENSION = 1280
EVENT_TYPE_RE = re.compile(r"^[a-z][a-z0-9_]{1,39}$")
CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,100}$")
SEVERITIES = {"low", "medium", "high"}
SNAPSHOT_SEVERITIES = {"info", "medium", "high"}
PRACTICE_DETAIL = "Practice sessions are private — no proctoring evidence is stored."
# Advisory-lock namespace ('PRCT'): pg_advisory_xact_lock(namespace, session_id)
# never collides with other features' locks and is released at commit/rollback.
LOCK_NAMESPACE = 0x50524354


def late_sync_minutes() -> int:
    """Evidence still queued in the browser may arrive shortly after /finish."""
    try:
        return max(0, int(os.environ.get("PROCTOR_LATE_SYNC_MINUTES", "30")))
    except ValueError:
        return 30


def retention_days() -> int:
    try:
        return max(1, int(os.environ.get("PROCTOR_RETENTION_DAYS", "90")))
    except ValueError:
        return 90


# ── helpers ───────────────────────────────────────────────────────────────────

def _iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() + "Z" if d else None


def _parse_ts(value: Any) -> Optional[datetime]:
    """Client timestamp (ISO string or epoch ms) → naive UTC, or None."""
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
            dt = datetime.fromtimestamp(float(value) / 1000.0, tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        return None
    # Reject clocks that are wildly off (keeps the timeline sane).
    now = utc_now()
    if abs((dt - now).total_seconds()) > 24 * 3600:
        return None
    return dt


def _candidate_session(s: Session, sid: int, username: str, *, allow_late: bool = False) -> InterviewSession:
    """The candidate's own, non-practice session. Uploads are accepted while it is
    active and — with ``allow_late`` — for a short grace window after /finish so a
    browser that was offline can still deliver queued evidence."""
    cand = s.exec(select(CandidateUser).where(CandidateUser.username == username)).first()
    iv = s.get(InterviewSession, sid)
    if not cand or not iv or iv.candidate_id != cand.id:
        raise HTTPException(status_code=404, detail="Interview session not found")
    if (iv.mode or "application") == "practice":
        raise HTTPException(status_code=400, detail=PRACTICE_DETAIL)
    if iv.status == "active":
        return iv
    if allow_late and iv.status == "completed" and iv.completed_at and utc_now() - iv.completed_at <= timedelta(minutes=late_sync_minutes()):
        return iv
    raise HTTPException(status_code=409, detail="This interview is no longer active")


def _job_id_for(s: Session, iv: InterviewSession) -> Optional[int]:
    """Job of a session, taken from the authoritative application row when there is one."""
    app = s.get(Application, iv.application_id) if iv.application_id else None
    if app:
        return app.job_id
    return iv.job_id


def _lock_proctor_session(s: Session, sid: int) -> None:
    """Serialize quota allocation + duplicate checks for one interview session
    across Postgres connections and workers. Transaction-scoped: released on
    commit or rollback. SQLite (tests/dev) serializes writers itself."""
    bind = s.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        s.execute(text("SELECT pg_advisory_xact_lock(:ns, :sid)"), {"ns": LOCK_NAMESPACE, "sid": int(sid)})


# ── server-derived risk (the only authoritative score) ───────────────────────

RISK_WEIGHTS = {"low": 2, "medium": 8, "high": 18}


def server_risk(events) -> dict:
    """Risk computed by the server from persisted event rows only. Client-sent
    scores/levels are never inputs. Event *severity* is classified by the browser
    detector; the server validates it against an allow-list."""
    score = min(100, sum(RISK_WEIGHTS.get(e.severity, 0) for e in events))
    return {"score": score, "level": "high" if score >= 60 else "medium" if score >= 30 else "low",
            "event_count": len(events),
            "formula": "sum over persisted events: low=2, medium=8, high=18, capped at 100; client-reported scores are not used"}


def _refresh_application_risk(s: Session, iv: InterviewSession) -> None:
    """Evidence that arrives after /finish updates the stored server-derived risk."""
    if iv.status != "completed" or not iv.application_id:
        return
    app = s.get(Application, iv.application_id)
    if not app or app.interview_id != iv.id:
        return
    risk = server_risk(s.exec(select(ProctorEvent).where(ProctorEvent.session_id == iv.id)).all())
    app.interview_risk_score, app.interview_risk_level = risk["score"], risk["level"]
    try:
        ev = json.loads(iv.eval_json or "{}") or {}
        p = ev.get("proctoring") if isinstance(ev.get("proctoring"), dict) else {}
        p.update({"server_derived_risk_score": risk["score"], "server_derived_risk_level": risk["level"], "server_event_count": risk["event_count"]})
        ev["proctoring"] = p
        iv.eval_json = json.dumps(ev)
        s.add(iv)
    except Exception:
        pass
    s.add(app)


_last_purge = 0.0


def _maybe_purge() -> None:
    """Opportunistic retention sweep, at most once an hour per process."""
    global _last_purge
    if time.monotonic() - _last_purge < 3600:
        return
    _last_purge = time.monotonic()
    try:
        purge_old_proctor_evidence()
    except Exception:  # pragma: no cover - never fail an upload over cleanup
        logger.exception("proctor retention sweep failed")


def purge_old_proctor_evidence(days: Optional[int] = None) -> dict:
    """Delete snapshots + events older than the retention window."""
    days = days or retention_days()
    cutoff = utc_now() - timedelta(days=days)
    with Session(engine) as s:
        snaps = s.exec(sa_delete(ProctorSnapshot).where(ProctorSnapshot.created_at < cutoff)).rowcount or 0
        events = s.exec(sa_delete(ProctorEvent).where(ProctorEvent.created_at < cutoff)).rowcount or 0
        s.commit()
    if snaps or events:
        logger.info("[PROCTOR] retention purge: %s snapshots, %s events older than %s days", snaps, events, days)
    return {"snapshots_deleted": snaps, "events_deleted": events, "retention_days": days, "cutoff": _iso(cutoff)}


def delete_application_evidence(s: Session, application_id: int) -> int:
    """Candidate deletion request: drop all snapshots/events for an application
    (caller commits)."""
    n = s.exec(sa_delete(ProctorSnapshot).where(ProctorSnapshot.application_id == application_id)).rowcount or 0
    s.exec(sa_delete(ProctorEvent).where(ProctorEvent.application_id == application_id))
    return n


def _inspect_jpeg(data: bytes) -> tuple[int, int]:
    """Validate a JPEG (magic bytes + decodable) and return (width, height)."""
    if len(data) < 128 or not data.startswith(b"\xff\xd8\xff") or b"\xff\xd9" not in data[-64:]:
        raise HTTPException(status_code=400, detail="Snapshot must be a JPEG image")
    try:
        from PIL import Image  # Pillow is already a dependency (avatars)

        with Image.open(io.BytesIO(data)) as im:
            if im.format != "JPEG":
                raise ValueError("not jpeg")
            w, h = im.size
            im.verify()
    except HTTPException:
        raise
    except ImportError:  # pragma: no cover
        return 0, 0
    except Exception:
        raise HTTPException(status_code=400, detail="Snapshot must be a valid JPEG image")
    if w > MAX_DIMENSION or h > MAX_DIMENSION or w < 16 or h < 16:
        raise HTTPException(status_code=400, detail=f"Snapshot must be between 16 and {MAX_DIMENSION}px")
    return w, h


# ── candidate: upload ─────────────────────────────────────────────────────────

def _link_snapshot_to_events(s: Session, sid: int, snap_id: int, client_event_id: Optional[str]) -> None:
    """A snapshot and the event that triggered it share client_event_id; link them
    server-side so the link survives browser refreshes and upload ordering."""
    if client_event_id:
        s.exec(sa_update(ProctorEvent).where(ProctorEvent.session_id == sid, ProctorEvent.client_event_id == client_event_id,
                                             ProctorEvent.snapshot_id.is_(None)).values(snapshot_id=snap_id))


@router.post("/api/interview/{sid}/proctor/snapshot")
@limiter.limit("20/minute")
async def upload_snapshot(
    request: Request,
    sid: int,
    image: UploadFile = File(...),
    event_type: str = Form("baseline"),
    severity: str = Form("info"),
    label: Optional[str] = Form(None),
    client_ts: Optional[str] = Form(None),
    client_event_id: Optional[str] = Form(None),
    candidate: str = Depends(get_current_candidate),
):
    """Store one evidence frame. Outcomes: stored (200), exact duplicate of an
    already-stored frame (200, deduplicated), same id with different bytes (409),
    quota reached (429). Quota and duplicate checks run under the session lock."""
    event_type = (event_type or "").strip().lower()
    if not EVENT_TYPE_RE.match(event_type):
        raise HTTPException(status_code=400, detail="Invalid event type")
    severity = (severity or "info").strip().lower()
    client_event_id = client_event_id.strip() if client_event_id else None
    if client_event_id and not CLIENT_ID_RE.fullmatch(client_event_id):
        raise HTTPException(status_code=400, detail="Invalid client_event_id")
    if event_type == "baseline":
        severity = "info"
    elif severity not in {"medium", "high"}:
        raise HTTPException(status_code=400, detail="Snapshots are only stored for medium or high severity events")

    data = await image.read(MAX_SNAPSHOT_BYTES + 1)
    if len(data) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(status_code=413, detail="Snapshot too large (max 150 KB)")
    width, height = _inspect_jpeg(data)

    def duplicate_or_conflict(existing: ProctorSnapshot) -> dict:
        if bytes(existing.data or b"") != data or existing.event_type != event_type:
            raise HTTPException(status_code=409, detail="A different snapshot was already stored with this client_event_id")
        return {"id": existing.id, "stored": True, "deduplicated": True, "status": "duplicate", "size_bytes": existing.size_bytes}

    with Session(engine) as s:
        iv = _candidate_session(s, sid, candidate, allow_late=True)
        _lock_proctor_session(s, sid)
        if client_event_id:
            existing = s.exec(select(ProctorSnapshot).where(ProctorSnapshot.session_id == sid, ProctorSnapshot.client_event_id == client_event_id)).first()
            if existing:
                return duplicate_or_conflict(existing)
        total = s.exec(select(func.count()).select_from(ProctorSnapshot).where(ProctorSnapshot.session_id == sid)).one()
        if total >= MAX_SNAPSHOTS_PER_SESSION:
            raise HTTPException(status_code=429, detail="Snapshot limit reached for this interview")
        if event_type == "baseline":
            nb = s.exec(select(func.count()).select_from(ProctorSnapshot)
                        .where(ProctorSnapshot.session_id == sid, ProctorSnapshot.kind == "baseline")).one()
            if nb >= MAX_BASELINE_PER_SESSION:
                raise HTTPException(status_code=429, detail="Baseline snapshot already stored")
        snap = ProctorSnapshot(
            session_id=sid, client_event_id=client_event_id, application_id=iv.application_id, candidate_id=iv.candidate_id,
            job_id=_job_id_for(s, iv), kind="baseline" if event_type == "baseline" else "event", event_type=event_type,
            severity=severity, label=(label or "")[:120] or None, client_ts=_parse_ts(client_ts),
            width=width or None, height=height or None, size_bytes=len(data), data=data,
        )
        s.add(snap)
        try:
            s.flush()
            _link_snapshot_to_events(s, sid, snap.id, client_event_id)
            s.commit()
        except IntegrityError:
            # Only reachable without the advisory lock (SQLite) — re-check, never assume.
            s.rollback()
            existing = s.exec(select(ProctorSnapshot).where(ProctorSnapshot.session_id == sid, ProctorSnapshot.client_event_id == client_event_id)).first() if client_event_id else None
            if existing:
                return duplicate_or_conflict(existing)
            logger.exception("snapshot insert failed for session %s", sid)
            raise HTTPException(status_code=503, detail="Snapshot could not be stored — retry")
        s.refresh(snap)
        out = {"id": snap.id, "stored": True, "status": "persisted", "size_bytes": snap.size_bytes,
               "remaining": MAX_SNAPSHOTS_PER_SESSION - total - 1, "received_at": _iso(snap.created_at)}
    _maybe_purge()
    return out


def _same_event(row: ProctorEvent, et: str, sev: str, ts: Optional[datetime]) -> bool:
    return row.event_type == et and row.severity == sev and (row.client_ts == ts or ts is None or row.client_ts is None)


@router.post("/api/interview/{sid}/proctor/events")
@limiter.limit("30/minute")
async def upload_events(request: Request, sid: int, payload: dict = Body(...), candidate: str = Depends(get_current_candidate)):
    """Store a batch of events with an explicit outcome per record:

    * ``persisted`` – written in this request (acknowledged)
    * ``duplicate`` – an identical event with this client_event_id is already stored (acknowledged)
    * ``invalid``   – will never be accepted (bad type/severity/id, id reused for a
      different event, session quota full) – not acknowledged, do not retry
    * ``failed``    – not stored because of a server-side problem – retry later

    Only acknowledged ids may be removed from the browser queue. Each insert runs
    in its own savepoint, so one bad row can never roll back (and falsely report)
    the rest of the batch.
    """
    events = payload.get("events")
    if not isinstance(events, list):
        raise HTTPException(status_code=400, detail="events must be a list")
    if len(events) > MAX_EVENTS_PER_BATCH:
        raise HTTPException(status_code=400, detail=f"At most {MAX_EVENTS_PER_BATCH} events per request")
    results: list[dict] = []
    with Session(engine) as s:
        iv = _candidate_session(s, sid, candidate, allow_late=True)
        _lock_proctor_session(s, sid)
        have = s.exec(select(func.count()).select_from(ProctorEvent).where(ProctorEvent.session_id == sid)).one()
        room = max(0, MAX_EVENTS_PER_SESSION - have)
        own_snaps: Optional[dict] = None
        seen_batch: dict = {}
        pending: list[tuple[dict, ProctorEvent]] = []
        for ev in events:
            if not isinstance(ev, dict):
                results.append({"client_event_id": None, "status": "invalid", "reason": "not_an_object"})
                continue
            cid = str(ev.get("client_event_id") or "").strip() or None
            if cid and not CLIENT_ID_RE.fullmatch(cid):
                results.append({"client_event_id": cid[:100], "status": "invalid", "reason": "invalid_client_event_id"})
                continue
            et = str(ev.get("type") or "").strip().lower()
            sev = str(ev.get("severity") or "low").strip().lower()
            if not EVENT_TYPE_RE.match(et) or sev not in SEVERITIES:
                results.append({"client_event_id": cid, "status": "invalid", "reason": "invalid_event"})
                continue
            ts = _parse_ts(ev.get("ts"))
            if cid and cid in seen_batch:
                first = seen_batch[cid]
                same = first["et"] == et and first["sev"] == sev and first["ts"] == ts
                results.append({"client_event_id": cid, "status": "duplicate" if same else "invalid",
                                "reason": None if same else "client_event_id_reused_in_batch", "_wait": first["result"] if same else None})
                continue
            if cid:
                existing = s.exec(select(ProctorEvent).where(ProctorEvent.session_id == sid, ProctorEvent.client_event_id == cid)).first()
                if existing:
                    ok = _same_event(existing, et, sev, ts)
                    results.append({"client_event_id": cid, "status": "duplicate" if ok else "invalid", "id": existing.id if ok else None,
                                    "reason": None if ok else "client_event_id_conflict"})
                    seen_batch[cid] = {"et": et, "sev": sev, "ts": ts, "result": results[-1]}
                    continue
            if room <= 0:
                results.append({"client_event_id": cid, "status": "invalid", "reason": "session_event_limit"})
                continue
            details = ev.get("details") if isinstance(ev.get("details"), dict) else {}
            snap_id = ev.get("snapshot_id")
            if own_snaps is None:
                own_snaps = {row[0]: row[1] for row in s.exec(select(ProctorSnapshot.id, ProctorSnapshot.client_event_id).where(ProctorSnapshot.session_id == sid)).all()}
            if not (isinstance(snap_id, int) and snap_id in own_snaps):
                snap_id = next((k for k, v in own_snaps.items() if cid and v == cid), None)
            row = ProctorEvent(session_id=sid, application_id=iv.application_id, candidate_id=iv.candidate_id, client_event_id=cid,
                               event_type=et, severity=sev, client_ts=ts, details_json=json.dumps(details, default=str)[:1000], snapshot_id=snap_id)
            result = {"client_event_id": cid, "status": "persisted"}
            try:
                with s.begin_nested():
                    s.add(row)
                    s.flush()
                result["id"] = row.id
                room -= 1
            except IntegrityError:
                existing = s.exec(select(ProctorEvent).where(ProctorEvent.session_id == sid, ProctorEvent.client_event_id == cid)).first() if cid else None
                if existing and _same_event(existing, et, sev, ts):
                    result = {"client_event_id": cid, "status": "duplicate", "id": existing.id}
                elif existing:
                    result = {"client_event_id": cid, "status": "invalid", "reason": "client_event_id_conflict"}
                else:
                    logger.exception("proctor event insert failed (session %s)", sid)
                    result = {"client_event_id": cid, "status": "failed", "reason": "storage_error"}
            results.append(result)
            if cid:
                seen_batch[cid] = {"et": et, "sev": sev, "ts": ts, "result": result}
            if result["status"] == "persisted":
                pending.append((result, row))
        if pending:
            _refresh_application_risk(s, iv)
        try:
            s.commit()
        except Exception:
            s.rollback()
            logger.exception("proctor event batch commit failed (session %s)", sid)
            for r in results:
                if r["status"] == "persisted":
                    r.update(status="failed", reason="storage_error")
                    r.pop("id", None)
        received = _iso(utc_now())
    for r in results:   # in-batch duplicates are only safe if their first copy was stored
        first = r.pop("_wait", None)
        if first is not None and first["status"] not in {"persisted", "duplicate"}:
            r.update(status=first["status"], reason=first.get("reason"))
    stored = [r for r in results if r["status"] == "persisted"]
    dups = [r for r in results if r["status"] == "duplicate"]
    return {
        "results": results,
        "received_at": received,
        "stored": len(stored),
        "dropped": sum(1 for r in results if r["status"] == "invalid"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "stored_ids": [r["client_event_id"] for r in stored if r["client_event_id"]],
        "duplicate_ids": [r["client_event_id"] for r in dups if r["client_event_id"]],
        "acknowledged": [r["client_event_id"] for r in stored + dups if r["client_event_id"]],
        "rejected": [{"client_event_id": r["client_event_id"], "reason": r.get("reason")} for r in results if r["status"] == "invalid"],
        "capacity_dropped": [r["client_event_id"] for r in results if r.get("reason") == "session_event_limit" and r["client_event_id"]],
    }


# ── reviewers: recruiter (own job) + admin ────────────────────────────────────

def get_reviewer(user: User = Depends(get_current_user)) -> User:
    if user.role not in {"recruiter", "admin"}:
        raise HTTPException(status_code=403, detail="Insufficient role")
    return user


NOT_FOUND = HTTPException(status_code=404, detail="Interview not found")


def _authorized_chain(s: Session, user: User, iv: InterviewSession, snap: Optional[ProctorSnapshot] = None) -> Optional[Job]:
    """Authorize via persisted relationships only:
    reviewer → recruiter account → job (owned) → application → interview session → snapshot.
    Every denormalized copy (session.job_id, snapshot.application_id/job_id/candidate_id)
    must agree with the authoritative rows, otherwise access is refused (404, no leak)."""
    if (iv.mode or "application") == "practice":
        raise NOT_FOUND
    app = s.get(Application, iv.application_id) if iv.application_id else None
    if iv.application_id and not app:
        raise NOT_FOUND
    if app and (app.candidate_id != iv.candidate_id or (iv.job_id is not None and iv.job_id != app.job_id)):
        logger.warning("proctoring: inconsistent session %s / application %s", iv.id, app.id)
        raise NOT_FOUND
    job_id = app.job_id if app else iv.job_id
    if snap is not None:
        if (snap.session_id != iv.id or snap.candidate_id != iv.candidate_id
                or (snap.application_id is not None and snap.application_id != iv.application_id)
                or (snap.job_id is not None and snap.job_id != job_id)):
            logger.warning("proctoring: snapshot %s does not match session %s", snap.id, iv.id)
            raise NOT_FOUND
    job = s.get(Job, job_id) if job_id else None
    if user.role == "admin":
        return job
    rec = s.exec(select(RecruiterUser).where(RecruiterUser.username == user.email)).first()
    if not rec or not job or job.recruiter_id != rec.id:
        raise NOT_FOUND
    return job


def _proctoring_summary(iv: InterviewSession, events: list) -> dict:
    try:
        ev = json.loads(iv.eval_json or "{}") or {}
    except Exception:
        ev = {}
    p = ev.get("proctoring") if isinstance(ev, dict) else None
    p = p if isinstance(p, dict) else {}
    derived = server_risk(events)
    client = {
        "risk_score": p.get("risk_score"), "risk_level": p.get("risk_level"), "status": p.get("proctoring_status"),
        "counts": p.get("counts") if isinstance(p.get("counts"), dict) else {},
        "breakdown": p.get("breakdown") if isinstance(p.get("breakdown"), dict) else {},
        "detectors": p.get("detectors") if isinstance(p.get("detectors"), dict) else {},
        "detector_health": p.get("detector_health") if isinstance(p.get("detector_health"), dict) else {},
        "flags": p.get("flags") if isinstance(p.get("flags"), list) else [],
        "sync": p.get("sync") if isinstance(p.get("sync"), dict) else None,
    }
    return {
        # authoritative
        "risk_score": derived["score"], "risk_level": derived["level"], "scoring": derived,
        "server_verified": {"risk_score": derived["score"], "risk_level": derived["level"], "persisted_events": derived["event_count"],
                            "formula": derived["formula"]},
        # browser telemetry — never used for scoring
        "client_reported": client,
        "integrity_status": "client_unverified",
        # legacy flat keys kept for existing UIs (clearly client-reported)
        "client_reported_risk_score": client["risk_score"], "client_reported_risk_level": client["risk_level"],
        "status": client["status"], "counts": client["counts"], "breakdown": client["breakdown"],
        "detectors": client["detectors"], "flags": client["flags"],
    }


def _report(s: Session, iv: InterviewSession, job: Optional[Job]) -> dict:
    prof = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == iv.candidate_id)).first()
    cand = s.get(CandidateUser, iv.candidate_id)
    events = s.exec(select(ProctorEvent).where(ProctorEvent.session_id == iv.id)
                    .order_by(ProctorEvent.created_at, ProctorEvent.id).limit(MAX_EVENTS_PER_SESSION)).all()
    snaps = s.exec(select(ProctorSnapshot.id, ProctorSnapshot.kind, ProctorSnapshot.event_type, ProctorSnapshot.severity,
                          ProctorSnapshot.label, ProctorSnapshot.client_ts, ProctorSnapshot.created_at,
                          ProctorSnapshot.width, ProctorSnapshot.height, ProctorSnapshot.size_bytes)
                   .where(ProctorSnapshot.session_id == iv.id).order_by(ProctorSnapshot.id)).all()
    by_type: dict = {}
    for e in events:
        by_type[e.event_type] = by_type.get(e.event_type, 0) + 1
    name = (getattr(prof, "full_name", None) if prof else None) or (cand.username if cand else "Candidate")
    done = iv.completed_at

    def late(received: Optional[datetime]) -> bool:
        return bool(done and received and received > done)

    return {
        "session": {
            "id": iv.id, "status": iv.status, "application_id": iv.application_id,
            "started_at": _iso(iv.started_at), "completed_at": _iso(iv.completed_at),
            "candidate_name": name, "job_title": job.title if job else None,
        },
        "risk": _proctoring_summary(iv, events),
        "event_counts": by_type,
        "events": [{
            "id": e.id, "type": e.event_type, "severity": e.severity,
            "at": _iso(e.client_ts or e.created_at), "received_at": _iso(e.created_at), "snapshot_id": e.snapshot_id,
            "details": (json.loads(e.details_json) if e.details_json else {}),
            "evidence_source": "client_reported",
            "server": {"id": e.id, "received_at": _iso(e.created_at), "persisted": True, "late_sync": late(e.created_at), "snapshot_id": e.snapshot_id},
            "client": {"type": e.event_type, "severity": e.severity, "ts": _iso(e.client_ts), "client_event_id": e.client_event_id},
        } for e in events],
        "snapshots": [{
            "id": r[0], "kind": r[1], "event_type": r[2], "severity": r[3], "label": r[4],
            "at": _iso(r[5] or r[6]), "received_at": _iso(r[6]), "late_sync": late(r[6]), "width": r[7], "height": r[8], "size_bytes": r[9],
            "url": f"/api/proctoring/snapshots/{r[0]}/image",
        } for r in snaps],
        "trust_note": "Server-verified: receipt times, stored ids, persistence and the risk score computed from stored events. "
                      "Client-reported: event type/severity/time chosen by the candidate's browser, detector status and the browser's own risk estimate.",
        "retention_days": retention_days(),
        "limits": {"max_snapshots": MAX_SNAPSHOTS_PER_SESSION, "max_bytes": MAX_SNAPSHOT_BYTES, "max_events": MAX_EVENTS_PER_SESSION},
    }


@router.get("/api/proctoring/sessions/{sid}")
async def session_report(sid: int, user: User = Depends(get_reviewer)):
    with Session(engine) as s:
        iv = s.get(InterviewSession, sid)
        if not iv:
            raise NOT_FOUND
        job = _authorized_chain(s, user, iv)
        return _report(s, iv, job)


@router.get("/api/proctoring/applications/{app_id}")
async def application_report(app_id: int, user: User = Depends(get_reviewer)):
    with Session(engine) as s:
        app = s.get(Application, app_id)
        if not app:
            raise NOT_FOUND
        job = s.get(Job, app.job_id) if app.job_id else None
        if user.role != "admin":
            rec = s.exec(select(RecruiterUser).where(RecruiterUser.username == user.email)).first()
            if not rec or not job or job.recruiter_id != rec.id:
                raise NOT_FOUND
        sessions = s.exec(select(InterviewSession).where(InterviewSession.application_id == app_id)
                          .order_by(InterviewSession.started_at.desc()).limit(10)).all()
        sessions = [x for x in sessions if (x.mode or "application") != "practice" and x.candidate_id == app.candidate_id]
        chosen = next((x for x in sessions if x.id == app.interview_id), None) or (sessions[0] if sessions else None)
        if not chosen:
            return {"session": None, "risk": {"risk_score": app.interview_risk_score, "risk_level": app.interview_risk_level,
                                              "counts": {}, "breakdown": {}, "flags": []},
                    "event_counts": {}, "events": [], "snapshots": [], "retention_days": retention_days()}
        job = _authorized_chain(s, user, chosen)
        out = _report(s, chosen, job)
        out["other_sessions"] = [{"id": x.id, "status": x.status, "started_at": _iso(x.started_at)} for x in sessions if x.id != chosen.id]
        return out


@router.get("/api/proctoring/snapshots/{snap_id}/image")
async def snapshot_image(snap_id: int, user: User = Depends(get_reviewer)):
    """Image bytes are served only after the full relationship chain is verified."""
    with Session(engine) as s:
        snap = s.get(ProctorSnapshot, snap_id)
        iv = s.get(InterviewSession, snap.session_id) if snap else None
        if not snap or not iv:
            raise HTTPException(status_code=404, detail="Snapshot not found")
        try:
            _authorized_chain(s, user, iv, snap)
        except HTTPException:
            raise HTTPException(status_code=404, detail="Snapshot not found")
        return Response(content=snap.data, media_type="image/jpeg",
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
                                 "Content-Disposition": "inline", "Cross-Origin-Resource-Policy": "same-site"})
