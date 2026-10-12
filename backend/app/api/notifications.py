"""Notification feed for the bell in the top bar (all three roles).

Derived from existing data (applications, audit log, interviews, offers,
recruiter requests) — no separate notification table to keep in sync.
GET /api/notifications → {"items": [{title, at, link, kind}]} newest first.
"""
from datetime import timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session, select

from ..auth import decode_token_payload
from ..db import (
    Application, CandidateUser, ContentFlag, DecisionAuditLog, Job, Offer, RecruiterRequest,
    RecruiterUser, ScheduledInterview, User, engine, utc_now,
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


def _iso(d):
    return d.isoformat() if d else None


@router.get("/api/notifications")
async def notifications(creds: HTTPAuthorizationCredentials = Depends(_bearer)):
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token_payload(creds.credentials)
    role, sub = payload.get("role"), payload.get("sub")
    items: List[dict] = []
    since = utc_now() - timedelta(days=30)
    with Session(engine) as s:
        if role == "candidate":
            cand = s.exec(select(CandidateUser).where(CandidateUser.username == sub)).first()
            if cand:
                jobs = {}
                for ev in s.exec(select(DecisionAuditLog).where(DecisionAuditLog.candidate_id == cand.id, DecisionAuditLog.created_at > since)
                                 .order_by(DecisionAuditLog.created_at.desc()).limit(15)).all():
                    if ev.event_type not in _EVENT_TEXT:
                        continue
                    job = jobs.get(ev.job_id) or (s.get(Job, ev.job_id) if ev.job_id else None)
                    jobs[ev.job_id] = job
                    link = "/candidate/applications" + (f"?interview={ev.application_id}" if ev.event_type == "interview_scheduled" else "")
                    items.append({"title": f"{_EVENT_TEXT[ev.event_type]}{f' — {job.title}' if job else ''}", "at": _iso(ev.created_at), "link": link, "kind": ev.event_type})
                for o in s.exec(select(Offer).where(Offer.candidate_id == cand.id, Offer.status == "sent")).all():
                    job = s.get(Job, o.job_id)
                    items.append({"title": f"Offer received{f' — {job.title}' if job else ''}", "at": _iso(o.offer_date), "link": "/candidate/applications", "kind": "offer"})
                for iv in s.exec(select(ScheduledInterview).where(ScheduledInterview.candidate_id == cand.id, ScheduledInterview.status == "scheduled",
                                                                   ScheduledInterview.starts_at > utc_now())).all():
                    items.append({"title": f"{iv.round_name} on {iv.starts_at.strftime('%d %b, %I:%M %p')}", "at": _iso(iv.created_at), "link": "/candidate/applications", "kind": "interview"})
        elif role == "recruiter":
            rec = s.exec(select(RecruiterUser).where(RecruiterUser.username == sub)).first()
            if rec:
                job_ids = {j.id: j for j in s.exec(select(Job).where(Job.recruiter_id == rec.id)).all()}
                if job_ids:
                    for a in s.exec(select(Application).where(Application.job_id.in_(list(job_ids)), Application.applied_at > since)
                                    .order_by(Application.applied_at.desc()).limit(10)).all():
                        items.append({"title": f"New application — {job_ids[a.job_id].title}", "at": _iso(a.applied_at), "link": "/recruiter/applications", "kind": "application"})
                    for a in s.exec(select(Application).where(Application.job_id.in_(list(job_ids)), Application.interview_status == "completed")
                                    .order_by(Application.id.desc()).limit(5)).all():
                        items.append({"title": f"AI interview completed — {job_ids[a.job_id].title}", "at": None, "link": "/recruiter/interviews", "kind": "interview"})
                for o in s.exec(select(Offer).where(Offer.recruiter_id == rec.id, Offer.responded_at != None)  # noqa: E711
                                .order_by(Offer.responded_at.desc()).limit(5)).all():
                    items.append({"title": f"Offer {o.status}", "at": _iso(o.responded_at), "link": "/recruiter/offers", "kind": "offer"})
        elif role == "admin":
            for r in s.exec(select(RecruiterRequest).where(RecruiterRequest.status == "pending").order_by(RecruiterRequest.submitted_at.desc()).limit(10)).all():
                items.append({"title": f"Recruiter request: {r.company_name or r.name}", "at": _iso(r.submitted_at), "link": "/admin/moderation", "kind": "recruiter_request"})
            for f in s.exec(select(ContentFlag).where(ContentFlag.status == "open").order_by(ContentFlag.created_at.desc()).limit(10)).all():
                items.append({"title": f"Flag: {f.title}", "at": _iso(f.created_at), "link": "/admin/moderation", "kind": "flag"})
            for u in s.exec(select(User).where(User.created_at > since).order_by(User.created_at.desc()).limit(5)).all():
                items.append({"title": f"New {u.role}: {u.email}", "at": _iso(u.created_at), "link": "/admin/users", "kind": "signup"})
    items.sort(key=lambda x: x["at"] or "", reverse=True)
    return {"items": items[:20]}
