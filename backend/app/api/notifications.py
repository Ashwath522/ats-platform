"""Notification feed for the bell in the top bar (all three roles).

Derived from existing data (applications, audit log, interviews, offers,
recruiter requests) — no separate notification table to keep in sync.
GET /api/notifications → {"items": [{title, at, link, kind}]} newest first.

Performance: the feed is ONE ``UNION ALL`` query per role (the account id
comes from the auth principal cache). It used to be 3-6 sequential queries
plus one extra query per audit event / offer (N+1), i.e. 3-10 s from India.
"""
from datetime import timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import String, and_, cast, literal, null, select as sa_select, union_all
from sqlmodel import Session

from ..auth import _principal, decode_token_payload
from ..db import (
    Application, CompanyFollow, ContentFlag, DecisionAuditLog, Job, Offer, RecruiterRequest,
    ScheduledInterview, User, engine, utc_now,
)

router = APIRouter(tags=["notifications"])
_bearer = HTTPBearer(auto_error=False)

_EVENT_TEXT = {
    "interview_scheduled": "Your AI interview is unlocked",
    "interview_evaluation": "Your interview was submitted for review",
    "recruiter_decision": "Your application status was updated",
    "recruiter_confirmation": "A recruiter reviewed your application",
    "project_score": "Your project was verified",
}
MAX_ITEMS = 20


def _iso(d) -> Optional[str]:
    """Naive UTC -> ISO with explicit Z (the bell shows 'x min ago' in local time)."""
    if not d:
        return None
    if getattr(d, "tzinfo", None) is not None:
        d = d.astimezone(timezone.utc).replace(tzinfo=None)
    return d.isoformat() + "Z"


def _part(kind, at, a=None, b=None, c=None, limit=None, order=None, where=(), joins=(), source=None):
    """One UNION branch with a fixed shape: (kind, at, a, b, c)."""
    def col(v, label):
        if v is None:
            return cast(null(), String).label(label)
        return cast(v, String).label(label)
    stmt = sa_select(literal(kind).label("kind"), at.label("at"), col(a, "a"), col(b, "b"), col(c, "c"))
    if source is not None:
        stmt = stmt.select_from(source)
    for target, on in joins:
        stmt = stmt.outerjoin(target, on)
    for w in where:
        stmt = stmt.where(w)
    if order is not None:
        stmt = stmt.order_by(order)
    if limit:
        stmt = stmt.limit(limit)
    # wrap so per-branch ORDER BY/LIMIT is valid inside UNION on SQLite too
    sub = stmt.subquery()
    return sa_select(sub.c.kind, sub.c.at, sub.c.a, sub.c.b, sub.c.c)


def _ist_label(dt) -> str:
    from datetime import timezone as tz, timedelta as td
    local = dt.replace(tzinfo=tz.utc).astimezone(tz(td(hours=5, minutes=30)))
    return local.strftime("%d %b, %I:%M %p IST")


def candidate_feed(s: Session, cid: int) -> List[dict]:
    since = utc_now() - timedelta(days=30)
    now = utc_now()
    parts = [
        _part("ev", DecisionAuditLog.created_at, DecisionAuditLog.event_type, Job.title, DecisionAuditLog.application_id,
              source=DecisionAuditLog, joins=[(Job, Job.id == DecisionAuditLog.job_id)],
              where=[DecisionAuditLog.candidate_id == cid, DecisionAuditLog.created_at > since,
                     DecisionAuditLog.event_type.in_(list(_EVENT_TEXT))],
              order=DecisionAuditLog.created_at.desc(), limit=15),
        _part("offer", Offer.offer_date, Job.title, source=Offer, joins=[(Job, Job.id == Offer.job_id)],
              where=[Offer.candidate_id == cid, Offer.status == "sent"], order=Offer.offer_date.desc(), limit=10),
        _part("iv", ScheduledInterview.created_at, ScheduledInterview.round_name, ScheduledInterview.starts_at,
              source=ScheduledInterview,
              where=[ScheduledInterview.candidate_id == cid, ScheduledInterview.status == "scheduled",
                     ScheduledInterview.starts_at > now],
              order=ScheduledInterview.starts_at, limit=10),
        # followed companies (same round trip) -> "New role at <company>" items below
        _part("follow", CompanyFollow.created_at, CompanyFollow.company_slug, source=CompanyFollow,
              where=[CompanyFollow.candidate_id == cid], order=CompanyFollow.created_at.desc(), limit=100),
    ]
    items = []
    follows = []
    for kind, at, a, b, c in s.execute(union_all(*parts)).all():
        at = _as_dt(at)
        if kind == "follow":
            follows.append((a, at))
            continue
        if kind == "ev":
            link = "/candidate/applications" + (f"?interview={c}" if a == "interview_scheduled" and c else "")
            items.append({"title": f"{_EVENT_TEXT.get(a, 'Update')}{f' — {b}' if b else ''}", "at": _iso(at), "link": link, "kind": a})
        elif kind == "offer":
            items.append({"title": f"Offer received{f' — {a}' if a else ''}", "at": _iso(at), "link": "/candidate/applications", "kind": "offer"})
        else:
            starts = _as_dt(b)
            items.append({"title": f"{a} on {_ist_label(starts)}" if starts else str(a), "at": _iso(at),
                          "starts_at": _iso(starts), "link": "/candidate/applications", "kind": "interview"})
    # New roles at companies the student follows (derived from jobs created after the follow)
    try:
        if follows:
            from ..services.company_directory import follow_feed
            items.extend(follow_feed(s, cid, follows=follows))
    except Exception:  # pragma: no cover - never break the bell
        import logging
        logging.getLogger("ats-platform").exception("[NOTIFY] follow feed failed")
    return items


def recruiter_feed(s: Session, rid: int) -> List[dict]:
    since = utc_now() - timedelta(days=30)
    parts = [
        _part("app", Application.applied_at, Job.title, source=Application, joins=[(Job, Job.id == Application.job_id)],
              where=[Job.recruiter_id == rid, Application.applied_at > since], order=Application.applied_at.desc(), limit=10),
        # AI interview completions: timestamp = when the session finished (was: no time at all,
        # so these always sorted last and showed no age)
        _part("ai", Application.applied_at, Job.title, Application.id, source=Application,
              joins=[(Job, Job.id == Application.job_id)],
              where=[Job.recruiter_id == rid, Application.interview_status == "completed"],
              order=Application.id.desc(), limit=5),
        _part("offer", Offer.responded_at, Offer.status, Job.title, source=Offer, joins=[(Job, Job.id == Offer.job_id)],
              where=[Offer.recruiter_id == rid, Offer.responded_at != None],  # noqa: E711
              order=Offer.responded_at.desc(), limit=5),
    ]
    rows = s.execute(union_all(*parts)).all()
    # completion time of the AI interviews (one extra indexed lookup, only when there are any)
    done = [int(r[3]) for r in rows if r[0] == "ai" and r[3]]
    finished = {}
    if done:
        from ..db import InterviewSession
        for app_id, completed_at in s.execute(sa_select(InterviewSession.application_id, InterviewSession.completed_at)
                                              .where(InterviewSession.application_id.in_(done),
                                                     InterviewSession.completed_at != None)).all():  # noqa: E711
            if completed_at and (app_id not in finished or completed_at > finished[app_id]):
                finished[app_id] = completed_at
    items = []
    for kind, at, a, b, c in rows:
        at = _as_dt(at)
        if kind == "app":
            items.append({"title": f"New application — {a}", "at": _iso(at), "link": "/recruiter/applications", "kind": "application"})
        elif kind == "ai":
            items.append({"title": f"AI interview completed — {a}", "at": _iso(finished.get(int(b))) if b else None,
                          "link": "/recruiter/interviews", "kind": "interview"})
        else:
            items.append({"title": f"Offer {a}{f' — {b}' if b else ''}", "at": _iso(at), "link": "/recruiter/offers", "kind": "offer"})
    return items


def admin_feed(s: Session) -> List[dict]:
    since = utc_now() - timedelta(days=30)
    parts = [
        _part("req", RecruiterRequest.submitted_at, RecruiterRequest.company_name, RecruiterRequest.name, source=RecruiterRequest,
              where=[RecruiterRequest.status == "pending"], order=RecruiterRequest.submitted_at.desc(), limit=10),
        _part("flag", ContentFlag.created_at, ContentFlag.title, source=ContentFlag,
              where=[ContentFlag.status == "open"], order=ContentFlag.created_at.desc(), limit=10),
        _part("user", User.created_at, User.role, User.email, source=User,
              where=[User.created_at > since], order=User.created_at.desc(), limit=5),
    ]
    items = []
    for kind, at, a, b, c in s.execute(union_all(*parts)).all():
        at = _as_dt(at)
        if kind == "req":
            items.append({"title": f"Recruiter request: {a or b}", "at": _iso(at), "link": "/admin/moderation", "kind": "recruiter_request"})
        elif kind == "flag":
            items.append({"title": f"Flag: {a}", "at": _iso(at), "link": "/admin/moderation", "kind": "flag"})
        else:
            items.append({"title": f"New {a}: {b}", "at": _iso(at), "link": "/admin/users", "kind": "signup"})
    return items


def _as_dt(v):
    """UNION columns come back as datetimes (Postgres) or strings (SQLite)."""
    if v is None or hasattr(v, "year"):
        return v
    from datetime import datetime
    try:
        return datetime.fromisoformat(str(v).replace("Z", "").replace(" ", "T"))
    except ValueError:
        return None


@router.get("/api/notifications")
def notifications(creds: HTTPAuthorizationCredentials = Depends(_bearer)):
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token_payload(creds.credentials)
    role, sub = payload.get("role"), payload.get("sub")
    items: List[dict] = []
    with Session(engine) as s:
        if role == "candidate":
            cand = _principal("candidate", sub)
            if cand:
                if cand.status == "suspended":
                    raise HTTPException(status_code=403, detail="This account is suspended")
                items = candidate_feed(s, cand.id)
        elif role == "recruiter":
            user = _principal("user", sub)
            if user and user.role != "recruiter":
                raise HTTPException(status_code=401, detail="Invalid or expired token")
            rec = _principal("recruiter", sub)
            if rec:
                items = recruiter_feed(s, rec.id)
        elif role == "admin":
            user = _principal("user", sub)
            if not user or user.role != "admin":
                raise HTTPException(status_code=401, detail="Invalid or expired token")
            items = admin_feed(s)
    # newest first; undated items last
    items.sort(key=lambda x: x["at"] or "", reverse=True)
    return {"items": items[:MAX_ITEMS]}
