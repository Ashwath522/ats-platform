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
from sqlalchemy import delete as sa_delete, func
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
MAX_EVENTS_PER_SESSION = 600
MAX_DIMENSION = 1280
EVENT_TYPE_RE = re.compile(r"^[a-z][a-z0-9_]{1,39}$")
SEVERITIES = {"low", "medium", "high"}
SNAPSHOT_SEVERITIES = {"info", "medium", "high"}
PRACTICE_DETAIL = "Practice sessions are private — no proctoring evidence is stored."


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


def _candidate_session(s: Session, sid: int, username: str) -> InterviewSession:
    cand = s.exec(select(CandidateUser).where(CandidateUser.username == username)).first()
    iv = s.get(InterviewSession, sid)
    if not cand or not iv or iv.candidate_id != cand.id:
        raise HTTPException(status_code=404, detail="Interview session not found")
    if (iv.mode or "application") == "practice":
        raise HTTPException(status_code=400, detail=PRACTICE_DETAIL)
    if iv.status != "active":
        raise HTTPException(status_code=409, detail="This interview is no longer active")
    return iv


def _job_id_for(s: Session, iv: InterviewSession) -> Optional[int]:
    if iv.job_id:
        return iv.job_id
    app = s.get(Application, iv.application_id) if iv.application_id else None
    return app.job_id if app else None


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
    candidate: str = Depends(get_current_candidate),
):
    event_type = (event_type or "").strip().lower()
    if not EVENT_TYPE_RE.match(event_type):
        raise HTTPException(status_code=400, detail="Invalid event type")
    severity = (severity or "info").strip().lower()
    if event_type == "baseline":
        severity = "info"
    elif severity not in {"medium", "high"}:
        raise HTTPException(status_code=400, detail="Snapshots are only stored for medium or high severity events")

    data = await image.read(MAX_SNAPSHOT_BYTES + 1)
    if len(data) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(status_code=413, detail="Snapshot too large (max 150 KB)")
    width, height = _inspect_jpeg(data)

    with Session(engine) as s:
        iv = _candidate_session(s, sid, candidate)
        total = s.exec(select(func.count()).select_from(ProctorSnapshot).where(ProctorSnapshot.session_id == sid)).one()
        if total >= MAX_SNAPSHOTS_PER_SESSION:
            raise HTTPException(status_code=429, detail="Snapshot limit reached for this interview")
        if event_type == "baseline":
            nb = s.exec(select(func.count()).select_from(ProctorSnapshot)
                        .where(ProctorSnapshot.session_id == sid, ProctorSnapshot.kind == "baseline")).one()
            if nb >= MAX_BASELINE_PER_SESSION:
                raise HTTPException(status_code=429, detail="Baseline snapshot already stored")
        snap = ProctorSnapshot(
            session_id=sid,
            application_id=iv.application_id,
            candidate_id=iv.candidate_id,
            job_id=_job_id_for(s, iv),
            kind="baseline" if event_type == "baseline" else "event",
            event_type=event_type,
            severity=severity,
            label=(label or "")[:120] or None,
            client_ts=_parse_ts(client_ts),
            width=width or None,
            height=height or None,
            size_bytes=len(data),
            data=data,
        )
        s.add(snap)
        s.commit()
        s.refresh(snap)
        out = {"id": snap.id, "stored": True, "size_bytes": snap.size_bytes, "remaining": MAX_SNAPSHOTS_PER_SESSION - total - 1}
    _maybe_purge()
    return out


@router.post("/api/interview/{sid}/proctor/events")
@limiter.limit("30/minute")
async def upload_events(request: Request, sid: int, payload: dict = Body(...), candidate: str = Depends(get_current_candidate)):
    events = payload.get("events")
    if not isinstance(events, list):
        raise HTTPException(status_code=400, detail="events must be a list")
    if len(events) > MAX_EVENTS_PER_BATCH:
        raise HTTPException(status_code=400, detail=f"At most {MAX_EVENTS_PER_BATCH} events per request")
    with Session(engine) as s:
        iv = _candidate_session(s, sid, candidate)
        have = s.exec(select(func.count()).select_from(ProctorEvent).where(ProctorEvent.session_id == sid)).one()
        room = max(0, MAX_EVENTS_PER_SESSION - have)
        stored = 0
        own_snaps = None
        for ev in events[:room]:
            if not isinstance(ev, dict):
                continue
            et = str(ev.get("type") or "").strip().lower()
            sev = str(ev.get("severity") or "low").strip().lower()
            if not EVENT_TYPE_RE.match(et) or sev not in SEVERITIES:
                continue
            details = ev.get("details") if isinstance(ev.get("details"), dict) else {}
            dj = json.dumps(details, default=str)[:1000]
            snap_id = ev.get("snapshot_id")
            if snap_id is not None:
                if own_snaps is None:
                    own_snaps = set(s.exec(select(ProctorSnapshot.id).where(ProctorSnapshot.session_id == sid)).all())
                snap_id = snap_id if isinstance(snap_id, int) and snap_id in own_snaps else None
            s.add(ProctorEvent(session_id=sid, application_id=iv.application_id, candidate_id=iv.candidate_id,
                               event_type=et, severity=sev, client_ts=_parse_ts(ev.get("ts")), details_json=dj,
                               snapshot_id=snap_id))
            stored += 1
        s.commit()
    return {"stored": stored, "dropped": len(events) - stored}


# ── reviewers: recruiter (own job) + admin ────────────────────────────────────

def get_reviewer(user: User = Depends(get_current_user)) -> User:
    if user.role not in {"recruiter", "admin"}:
        raise HTTPException(status_code=403, detail="Insufficient role")
    return user


def _assert_can_review(s: Session, user: User, job_id: Optional[int]) -> None:
    if user.role == "admin":
        return
    rec = s.exec(select(RecruiterUser).where(RecruiterUser.username == user.email)).first()
    job = s.get(Job, job_id) if job_id else None
    if not rec or not job or job.recruiter_id != rec.id:
        raise HTTPException(status_code=404, detail="Interview not found")


def _proctoring_summary(iv: InterviewSession, app: Optional[Application]) -> dict:
    ev = {}
    try:
        ev = json.loads(iv.eval_json or "{}") or {}
    except Exception:
        ev = {}
    p = ev.get("proctoring") if isinstance(ev, dict) else None
    p = p if isinstance(p, dict) else {}
    score = p.get("risk_score", app.interview_risk_score if app else None)
    level = p.get("risk_level", app.interview_risk_level if app else None)
    return {
        "risk_score": score,
        "risk_level": level,
        "status": p.get("proctoring_status"),
        "counts": p.get("counts") if isinstance(p.get("counts"), dict) else {},
        "breakdown": p.get("breakdown") if isinstance(p.get("breakdown"), dict) else {},
        "detectors": p.get("detectors") if isinstance(p.get("detectors"), dict) else {},
        "flags": p.get("flags") if isinstance(p.get("flags"), list) else [],
    }


def _report(s: Session, iv: InterviewSession) -> dict:
    app = s.get(Application, iv.application_id) if iv.application_id else None
    job = s.get(Job, _job_id_for(s, iv)) if _job_id_for(s, iv) else None
    prof = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == iv.candidate_id)).first()
    cand = s.get(CandidateUser, iv.candidate_id)
    events = s.exec(select(ProctorEvent).where(ProctorEvent.session_id == iv.id)
                    .order_by(ProctorEvent.client_ts, ProctorEvent.id).limit(MAX_EVENTS_PER_SESSION)).all()
    snaps = s.exec(select(ProctorSnapshot.id, ProctorSnapshot.kind, ProctorSnapshot.event_type, ProctorSnapshot.severity,
                          ProctorSnapshot.label, ProctorSnapshot.client_ts, ProctorSnapshot.created_at,
                          ProctorSnapshot.width, ProctorSnapshot.height, ProctorSnapshot.size_bytes)
                   .where(ProctorSnapshot.session_id == iv.id).order_by(ProctorSnapshot.id)).all()
    by_type: dict = {}
    for e in events:
        by_type[e.event_type] = by_type.get(e.event_type, 0) + 1
    name = (getattr(prof, "full_name", None) if prof else None) or (cand.username if cand else "Candidate")
    return {
        "session": {
            "id": iv.id, "status": iv.status, "application_id": iv.application_id,
            "started_at": _iso(iv.started_at), "completed_at": _iso(iv.completed_at),
            "candidate_name": name, "job_title": job.title if job else None,
        },
        "risk": _proctoring_summary(iv, app),
        "event_counts": by_type,
        "events": [{
            "id": e.id, "type": e.event_type, "severity": e.severity,
            "at": _iso(e.client_ts or e.created_at), "snapshot_id": e.snapshot_id,
            "details": (json.loads(e.details_json) if e.details_json else {}),
        } for e in events],
        "snapshots": [{
            "id": r[0], "kind": r[1], "event_type": r[2], "severity": r[3], "label": r[4],
            "at": _iso(r[5] or r[6]), "width": r[7], "height": r[8], "size_bytes": r[9],
            "url": f"/api/proctoring/snapshots/{r[0]}/image",
        } for r in snaps],
        "retention_days": retention_days(),
        "limits": {"max_snapshots": MAX_SNAPSHOTS_PER_SESSION, "max_bytes": MAX_SNAPSHOT_BYTES},
    }


@router.get("/api/proctoring/sessions/{sid}")
async def session_report(sid: int, user: User = Depends(get_reviewer)):
    with Session(engine) as s:
        iv = s.get(InterviewSession, sid)
        if not iv or (iv.mode or "application") == "practice":
            raise HTTPException(status_code=404, detail="Interview not found")
        _assert_can_review(s, user, _job_id_for(s, iv))
        return _report(s, iv)


@router.get("/api/proctoring/applications/{app_id}")
async def application_report(app_id: int, user: User = Depends(get_reviewer)):
    with Session(engine) as s:
        app = s.get(Application, app_id)
        if not app:
            raise HTTPException(status_code=404, detail="Interview not found")
        _assert_can_review(s, user, app.job_id)
        sessions = s.exec(select(InterviewSession).where(InterviewSession.application_id == app_id)
                          .order_by(InterviewSession.started_at.desc()).limit(10)).all()
        sessions = [x for x in sessions if (x.mode or "application") != "practice"]
        # Prefer the completed run (the one that produced the score).
        chosen = next((x for x in sessions if x.id == app.interview_id), None) or (sessions[0] if sessions else None)
        if not chosen:
            return {"session": None, "risk": {"risk_score": app.interview_risk_score, "risk_level": app.interview_risk_level,
                                              "counts": {}, "breakdown": {}, "flags": []},
                    "event_counts": {}, "events": [], "snapshots": [], "retention_days": retention_days()}
        out = _report(s, chosen)
        out["other_sessions"] = [{"id": x.id, "status": x.status, "started_at": _iso(x.started_at)} for x in sessions if x.id != chosen.id]
        return out


@router.get("/api/proctoring/snapshots/{snap_id}/image")
async def snapshot_image(snap_id: int, user: User = Depends(get_reviewer)):
    with Session(engine) as s:
        snap = s.get(ProctorSnapshot, snap_id)
        if not snap:
            raise HTTPException(status_code=404, detail="Snapshot not found")
        _assert_can_review(s, user, snap.job_id)
        return Response(content=snap.data, media_type=snap.content_type or "image/jpeg",
                        headers={"Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff"})
