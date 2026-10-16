"""v2 portal API — recruiter_portal (pages 13–17: Dashboard, Jobs & Requisitions,
Candidate Management, Applications Management, Shortlisted Candidates).

Every query is scoped to the logged-in recruiter's own jobs
(Job.recruiter_id == RecruiterUser.id). Platform-wide candidate search respects
CandidateProfile.privacy_json:
  * {"visibility": "private"} → hidden from search unless the candidate applied
    to one of this recruiter's jobs;
  * contact details (email / phone) are only returned when privacy.show_contact
    is true or the candidate applied to one of this recruiter's jobs.
EEO fields (gender) are never returned.
"""
from __future__ import annotations

import json
import math
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..auth import get_current_recruiter
from ..db import (
    Application,
    CandidateProfile,
    CandidateUser,
    CompanyProfile,
    DecisionAuditLog,
    InterviewSession,
    Job,
    Offer,
    RecruiterNote,
    RecruiterUser,
    Resume,
    SavedJob,
    ScheduledInterview,
    StudentProject,
    engine,
    utc_now,
)
from ..services.audit import record_audit_event

router = APIRouter(prefix="/api/recruiter/portal", tags=["recruiter_portal"])

MAX_APPS = 5000
MAX_PAGE_SIZE = 500

# ─── Branch helpers ──────────────────────────────────────────────────────────
CORE_BRANCHES = ["mechanical", "civil", "eee", "ece", "chemical", "aerospace", "automobile", "metallurgy"]
BRANCH_LABELS = {
    "mechanical": "Mechanical", "civil": "Civil", "eee": "Electrical", "ece": "Electronics & Comm.",
    "chemical": "Chemical", "aerospace": "Aerospace", "automobile": "Automobile",
    "metallurgy": "Metallurgy & Materials", "software": "CS / Software",
}
_BRANCH_ALIASES = {
    "mech": "mechanical", "mechanical engineering": "mechanical",
    "civil engineering": "civil",
    "electrical": "eee", "electrical / eee": "eee", "electrical & electronics": "eee", "electrical engineering": "eee",
    "electronics": "ece", "electronics & communication": "ece", "electronics and communication": "ece", "electronics & comm.": "ece",
    "chemical engineering": "chemical",
    "aero": "aerospace", "aeronautical": "aerospace",
    "automotive": "automobile", "auto": "automobile",
    "materials": "metallurgy", "metallurgy & materials": "metallurgy",
    "cs": "software", "cse": "software", "computer science": "software", "it": "software", "cs / software": "software",
}


def norm_branch(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    key = str(value).strip().lower()
    if key in BRANCH_LABELS:
        return key
    return _BRANCH_ALIASES.get(key, key)


# ─── Generic helpers ─────────────────────────────────────────────────────────
def _loads(raw, default):
    if raw in (None, ""):
        return default
    try:
        v = json.loads(raw)
        return v if isinstance(v, type(default)) else default
    except (TypeError, ValueError):
        return default


def _iso(d: Optional[datetime]) -> Optional[str]:
    """Naive UTC -> ISO with an explicit Z (without it browsers read the time as
    local: next-round times on Shortlisted / candidate detail were 5h30 off in India)."""
    if not d:
        return None
    if d.tzinfo is not None:
        from datetime import timezone as _tz
        d = d.astimezone(_tz.utc).replace(tzinfo=None)
    return d.isoformat() + "Z"


def _split_skills(text: Optional[str]) -> List[str]:
    if not text:
        return []
    out, seen = [], set()
    for part in re.split(r"[,;\n•|]+", text):
        s = part.strip(" .-\t")
        if s and len(s) <= 40 and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    return out


def _pct_delta(cur: int, prev: int) -> Optional[int]:
    if not prev:
        return None
    return round((cur - prev) * 100 / prev)


def _kpi(value: int, cur: int, prev: int) -> dict:
    return {"value": value, "current_period": cur, "previous_period": prev, "delta_pct": _pct_delta(cur, prev)}


def _in(d: Optional[datetime], start: datetime, end: datetime) -> bool:
    return bool(d) and start <= d < end


def _me(session: Session, username: str) -> RecruiterUser:
    user = session.exec(select(RecruiterUser).where(RecruiterUser.username == username)).first()
    if not user:
        raise HTTPException(status_code=404, detail="Recruiter user not found")
    return user


def _company_prefix(session: Session, rec: RecruiterUser) -> str:
    from ..services.hot_data import company_directory

    rp = company_directory()[0].get(rec.id)   # cached; no query
    name = (rp[0] if rp else "") or ""
    words = [w for w in re.split(r"[^A-Za-z0-9]+", name) if w and w.lower() not in {"pvt", "ltd", "limited", "private", "inc", "the", "and", "of"}]
    if len(words) >= 2:
        return "".join(w[0] for w in words[:4]).upper()
    if words:
        return words[0][:6].upper()
    domain = rec.username.split("@")[-1].split(".")[0] if "@" in rec.username else rec.username
    return (re.sub(r"[^A-Za-z0-9]", "", domain)[:6] or "JOB").upper()


_TYPE_CODES = {"internship": "INT", "full-time": "FT", "part-time": "PT", "apprenticeship": "APP", "contract": "CT"}


def job_code(prefix: str, job: Job) -> str:
    return f"{prefix}-{_TYPE_CODES.get((job.job_type or '').lower(), 'JOB')}-{job.id:03d}"


def _display_name(profile: Optional[CandidateProfile], user: Optional[CandidateUser]) -> str:
    if profile and profile.full_name and profile.full_name.strip():
        return profile.full_name.strip()
    if user and user.username:
        return user.username.split("@")[0]
    return "Candidate"


def _privacy(profile: Optional[CandidateProfile]) -> dict:
    p = _loads(profile.privacy_json if profile else None, {})
    return {
        "visibility": (p.get("visibility") or "public"),
        "show_contact": bool(p.get("show_contact", False)),
    }


def _match(app: Application) -> Optional[int]:
    if app.final_score is not None:
        return int(round(app.final_score))
    if app.ats_score is not None:
        return int(app.ats_score)
    return None


STAGE_LABELS = {
    "under_review": "Under Review", "shortlisted": "Shortlisted", "interview": "Interview Scheduled",
    "offer": "Offer", "rejected": "Rejected", "hired": "Hired",
}
STAGE_RANK = {"rejected": -1, "under_review": 0, "shortlisted": 1, "interview": 2, "offer": 3, "hired": 4}
LIVE_SI = ("scheduled", "completed")


def stage_of(app: Application, sis: List[ScheduledInterview], offers: List[Offer]) -> str:
    if any(o.status in ("accepted", "joined") for o in offers):
        return "hired"
    if any(o.status not in ("declined", "withdrawn") for o in offers):
        return "offer"
    if app.status == "rejected":
        return "rejected"
    if (
        any(s.status in LIVE_SI for s in sis)
        or app.status == "automated_interview"
        or app.interview_status in ("unlocked", "in_progress", "completed")
    ):
        return "interview"
    if app.status == "shortlisted":
        return "shortlisted"
    return "under_review"


def interview_state(app: Application, sis: List[ScheduledInterview], now: datetime) -> dict:
    live = [s for s in sis if s.status in LIVE_SI]
    completed = any(s.status == "completed" for s in live) or app.interview_status == "completed"
    upcoming = sorted([s for s in live if s.status == "scheduled" and s.starts_at >= now], key=lambda s: s.starts_at)
    if completed:
        status = "interview_completed"
    elif upcoming or live or app.interview_status in ("unlocked", "in_progress"):
        status = "interview_scheduled"
    else:
        status = "under_review"
    nxt = None
    if upcoming:
        s = upcoming[0]
        nxt = {"kind": "round", "round_name": s.round_name, "starts_at": _iso(s.starts_at), "interview_id": s.id, "mode": s.mode}
    elif app.interview_status in ("unlocked", "in_progress"):
        nxt = {"kind": "ai", "label": "AI interview pending"}
    elif completed:
        nxt = {"kind": "decision", "label": "Ready for decision"}
    return {"status": status, "next": nxt, "has_hr_round": any("hr" in (s.round_name or "").lower() for s in live)}


# ─── Per-request data context ────────────────────────────────────────────────
# Large text columns that list pages never show (loaded lazily if touched).
_HEAVY_APP_COLS = ("interview_transcript_json", "skills_matched_detail", "skills_gap_detail", "project_summary",
                   "risk_notes", "repo_match_reasoning", "human_decision_notes", "ai_recommendation",
                   "interview_recommendation")


def _recruiter_jobs(rid: int) -> List[Job]:
    """Recruiter's jobs, newest first - cached (cleared on any job write). Read-only rows."""
    from ..services.hot_data import recruiter_jobs

    return recruiter_jobs(rid)


def _as_dt(v):
    if v is None or isinstance(v, datetime):
        return v
    try:
        return datetime.fromisoformat(str(v).replace("Z", "").replace(" ", "T"))
    except ValueError:
        return None


class Ctx:
    """Loads the recruiter's jobs + applications (+ related rows) once."""

    def __init__(self, session: Session, username: str, with_apps: bool = True, light: bool = False):
        """``light=True`` (read-only list pages): the job list comes from a
        per-recruiter cache, heavy Application text columns are deferred and
        applications + candidate profiles + scheduled rounds + offers + verified
        project counts arrive in ONE joined query. Never mutate ``ctx.jobs``
        of a light context."""
        from ..auth import cached_recruiter

        self.session = session
        self.username = username
        self.light = light
        self.me = cached_recruiter(username) if light else _me(session, username)
        self.now = utc_now()
        if light:
            self.jobs = _recruiter_jobs(self.me.id)
        else:
            self.jobs: List[Job] = session.exec(select(Job).where(Job.recruiter_id == self.me.id).order_by(Job.created_at.desc())).all()
        self.job_by_id: Dict[int, Job] = {j.id: j for j in self.jobs}
        self.prefix = _company_prefix(session, self.me)
        self.apps: List[Application] = []
        self.sis: Dict[int, List[ScheduledInterview]] = defaultdict(list)
        self.offers: Dict[int, List[Offer]] = defaultdict(list)
        self.profiles: Dict[int, CandidateProfile] = {}
        self.users: Dict[int, CandidateUser] = {}
        self.verified: Dict[int, int] = {}
        self.has_transcript: Dict[int, bool] = {}
        self.ai_done: Dict[int, Optional[datetime]] = {}
        if with_apps and self.job_by_id:
            if light:
                self._load_light()
            else:
                ids = list(self.job_by_id)
                self.apps = session.exec(
                    select(Application).where(Application.job_id.in_(ids)).order_by(Application.applied_at.desc()).limit(MAX_APPS)
                ).all()
                for s in session.exec(select(ScheduledInterview).where(ScheduledInterview.recruiter_id == self.me.id)).all():
                    self.sis[s.application_id].append(s)
                for o in session.exec(select(Offer).where(Offer.recruiter_id == self.me.id)).all():
                    self.offers[o.application_id].append(o)
                self.load_candidates({a.candidate_id for a in self.apps})
        for lst in self.offers.values():
            lst.sort(key=lambda o: (o.created_at or self.now, o.id or 0), reverse=True)   # latest offer first
        self.app_by_id = {a.id: a for a in self.apps}
        self.applicant_ids = {a.candidate_id for a in self.apps}

    def _load_light(self):
        from sqlalchemy import and_, func, select as sa_select
        from sqlalchemy.orm import defer

        rid = self.me.id
        ids = list(self.job_by_id)
        top = (sa_select(Application.id).where(Application.job_id.in_(ids))
               .order_by(Application.applied_at.desc()).limit(MAX_APPS).scalar_subquery())
        verified = (sa_select(func.count(StudentProject.id))
                    .where(StudentProject.candidate_id == Application.candidate_id, StudentProject.status == "verified")
                    .scalar_subquery())
        ai_done = (sa_select(func.max(func.coalesce(InterviewSession.completed_at, InterviewSession.started_at)))
                   .where(InterviewSession.application_id == Application.id, InterviewSession.status == "completed")
                   .scalar_subquery())
        has_tx = func.length(func.coalesce(Application.interview_transcript_json, "")) > 2
        q = (sa_select(Application, has_tx, ai_done, verified, CandidateProfile, CandidateUser, ScheduledInterview, Offer)
             .options(*(defer(getattr(Application, c)) for c in _HEAVY_APP_COLS))
             .outerjoin(CandidateProfile, CandidateProfile.candidate_id == Application.candidate_id)
             .outerjoin(CandidateUser, CandidateUser.id == Application.candidate_id)
             .outerjoin(ScheduledInterview, and_(ScheduledInterview.application_id == Application.id,
                                                 ScheduledInterview.recruiter_id == rid))
             .outerjoin(Offer, and_(Offer.application_id == Application.id, Offer.recruiter_id == rid))
             .where(Application.id.in_(top)))
        apps: Dict[int, Application] = {}
        seen_si, seen_of = set(), set()
        for a, htx, done, nver, prof, user, si, off in self.session.execute(q).all():
            if a.id not in apps:
                apps[a.id] = a
                self.has_transcript[a.id] = bool(htx)
                if done is not None:
                    self.ai_done[a.id] = _as_dt(done)
                if prof is not None:
                    self.profiles[a.candidate_id] = prof
                if user is not None:
                    self.users[a.candidate_id] = user
                self.verified[a.candidate_id] = int(nver or 0)
            if si is not None and si.id not in seen_si:
                seen_si.add(si.id)
                self.sis[si.application_id].append(si)
            if off is not None and off.id not in seen_of:
                seen_of.add(off.id)
                self.offers[off.application_id].append(off)
        self.apps = sorted(apps.values(), key=lambda a: (a.applied_at, a.id), reverse=True)

    def undefer(self, apps: Iterable[Application]) -> None:
        """Load the deferred heavy columns of ``apps`` in ONE query (light ctx)."""
        if not self.light:
            return
        from sqlalchemy.orm import attributes
        from sqlalchemy.orm.base import instance_state

        todo = {a.id: a for a in apps if any(c in instance_state(a).unloaded for c in _HEAVY_APP_COLS)}
        if not todo:
            return
        cols = [getattr(Application, c) for c in _HEAVY_APP_COLS]
        for row in self.session.exec(select(Application.id, *cols).where(Application.id.in_(list(todo)))).all():
            a = todo.get(row[0])
            for name, value in zip(_HEAVY_APP_COLS, row[1:]):
                attributes.set_committed_value(a, name, value)

    def load_candidates(self, cids: Iterable[int]):
        cids = [c for c in set(cids) if c not in self.users]
        if not cids:
            return
        # ONE query: user + profile + verified-project count per candidate
        from sqlalchemy import func, select as sa_select

        verified = (sa_select(func.count(StudentProject.id))
                    .where(StudentProject.candidate_id == CandidateUser.id, StudentProject.status == "verified")
                    .scalar_subquery())
        for u, p, nver in self.session.execute(
            sa_select(CandidateUser, CandidateProfile, verified)
            .outerjoin(CandidateProfile, CandidateProfile.candidate_id == CandidateUser.id)
            .where(CandidateUser.id.in_(cids))
        ).all():
            self.users[u.id] = u
            if p is not None:
                self.profiles.setdefault(u.id, p)
            if nver:
                self.verified[u.id] = int(nver)

    def name(self, cid: int) -> str:
        return _display_name(self.profiles.get(cid), self.users.get(cid))

    def stage(self, app: Application) -> str:
        return stage_of(app, self.sis.get(app.id, []), self.offers.get(app.id, []))

    def contact_email(self, cid: int) -> Optional[str]:
        p, u = self.profiles.get(cid), self.users.get(cid)
        return (p.contact_email if p and p.contact_email else None) or (u.username if u else None)

    def app_item(self, a: Application) -> dict:
        p = self.profiles.get(a.candidate_id)
        j = self.job_by_id.get(a.job_id)
        st = self.stage(a)
        iv = interview_state(a, self.sis.get(a.id, []), self.now)
        offers = self.offers.get(a.id, [])
        return {
            "application_id": a.id,
            "id": a.id,
            "candidate_id": a.candidate_id,
            "candidate_name": self.name(a.candidate_id),
            "avatar_path": p.avatar_path if p else None,
            "cgpa": p.cgpa if p else None,
            "college": p.college if p else None,
            "branch": norm_branch(p.branch) if p else None,
            "location": p.location_text if p else None,
            "current_year": p.current_year if p else None,
            "grad_year": p.grad_year if p else None,
            "skills": _loads(p.skills_json, [])[:6] if p else [],
            "verified": self.verified.get(a.candidate_id, 0) > 0,
            "verified_projects": self.verified.get(a.candidate_id, 0),
            "job_id": a.job_id,
            "job_title": j.title if j else None,
            "job_code": job_code(self.prefix, j) if j else None,
            "job_branch": norm_branch(j.branch) if j else None,
            "job_location": j.location_text if j else None,
            "job_type": j.job_type if j else None,
            "experience_level": j.experience_level if j else None,
            "match": _match(a),
            "ats_score": a.ats_score,
            "project_score": a.project_score,
            "repo_match_score": a.repo_match_score,
            "final_score": a.final_score,
            "interview_eval_score": a.interview_eval_score,
            "interview_risk_level": a.interview_risk_level,
            "status": a.status,
            "interview_status": a.interview_status,
            "interview_state": iv["status"],
            "next_step": iv["next"],
            "stage": st,
            "stage_label": STAGE_LABELS[st],
            "applied_at": _iso(a.applied_at),
            "can_unlock": a.status == "shortlisted" and (a.repo_match_score is not None or a.project_score is not None) and (a.interview_status in (None, "locked")),
            "has_ai_result": a.interview_status == "completed" or (self.has_transcript.get(a.id, False) if self.light else bool(a.interview_transcript_json)),
            "offer_id": offers[0].id if offers else None,
            "offer_status": offers[0].status if offers else None,
            "pending_human_review": a.pending_human_review,
        }

    def owned_app(self, app_id: int) -> Application:
        a = self.app_by_id.get(app_id)
        if a is None:
            # Not in my (capped) list — check directly to give the right error.
            a = self.session.get(Application, app_id)
            if not a or a.job_id not in self.job_by_id:
                raise HTTPException(status_code=404, detail="Application not found")
        return a


def _window(days: int, now: datetime):
    cur_start = now - timedelta(days=days)
    prev_start = now - timedelta(days=2 * days)
    return cur_start, prev_start


def _count_windows(dates: Iterable[Optional[datetime]], now: datetime, days: int = 30):
    cur_start, prev_start = _window(days, now)
    end = now + timedelta(days=1)
    cur = prev = 0
    for d in dates:
        if _in(d, cur_start, end):
            cur += 1
        elif _in(d, prev_start, cur_start):
            prev += 1
    return cur, prev


def _ai_completed_dates(session: Session, app_ids: List[int]) -> Dict[int, Optional[datetime]]:
    out: Dict[int, Optional[datetime]] = {}
    if not app_ids:
        return out
    for s in session.exec(
        select(InterviewSession).where(InterviewSession.application_id.in_(app_ids)).where(InterviewSession.status == "completed")
    ).all():
        out[s.application_id] = s.completed_at or s.started_at
    return out


def _pipeline_kpis(ctx: Ctx, days: int = 30) -> dict:
    apps = ctx.apps
    now = ctx.now
    stages = {a.id: ctx.stage(a) for a in apps}
    first_apply: Dict[int, datetime] = {}
    for a in apps:
        if a.candidate_id not in first_apply or a.applied_at < first_apply[a.candidate_id]:
            first_apply[a.candidate_id] = a.applied_at
    shortlisted = [a for a in apps if stages[a.id] in ("shortlisted", "interview", "offer", "hired")]
    si_all = [s for lst in ctx.sis.values() for s in lst if s.status != "cancelled"]
    ai_done = ctx.ai_done if ctx.light else _ai_completed_dates(ctx.session, [a.id for a in apps if a.interview_status == "completed"])
    ai_apps = [a for a in apps if a.interview_status == "completed"]
    offers_all = [o for lst in ctx.offers.values() for o in lst if o.status != "draft"]
    hired = [o for o in offers_all if o.status in ("accepted", "joined")]
    upcoming = [s for s in si_all if s.status == "scheduled" and s.starts_at >= now]
    c = lambda dates: _count_windows(dates, now, days)  # noqa: E731
    return {
        "total_candidates": _kpi(len(first_apply), *c(first_apply.values())),
        "applications": _kpi(len(apps), *c(a.applied_at for a in apps)),
        "shortlisted": _kpi(len(shortlisted), *c(a.applied_at for a in shortlisted)),
        "interviews": _kpi(len(si_all) + len(ai_apps), *c([s.created_at for s in si_all] + [ai_done.get(a.id) for a in ai_apps])),
        "interviews_scheduled": _kpi(len(si_all), *c(s.created_at for s in si_all)),
        "upcoming_interviews": len(upcoming),
        "offers": _kpi(len(offers_all), *c(o.offer_date or o.created_at for o in offers_all)),
        "hired": _kpi(len(hired), *c(o.responded_at or o.updated_at for o in hired)),
    }


# ─── Overview (Dashboard, page 13) ───────────────────────────────────────────
def _activity(ctx: Ctx, limit: int = 10) -> List[dict]:
    items: List[dict] = []
    job_ids = list(ctx.job_by_id)
    if job_ids:
        logs = ctx.session.exec(
            select(DecisionAuditLog).where(DecisionAuditLog.job_id.in_(job_ids)).order_by(DecisionAuditLog.created_at.desc()).limit(40)
        ).all()
        ctx.load_candidates({l.candidate_id for l in logs if l.candidate_id})
        for l in logs:
            job = ctx.job_by_id.get(l.job_id)
            who = ctx.name(l.candidate_id) if l.candidate_id else "Candidate"
            action = l.human_action or ""
            if l.event_type in ("recruiter_decision", "recruiter_confirmation") and action:
                target = action.replace("status_change_", "").replace("confirmed_", "")
                title = f"{who} moved to {STAGE_LABELS.get(target, target.replace('_', ' ').title())}"
                if target == "rejected":
                    title = f"{who} marked as rejected"
                kind = "status"
            elif l.event_type == "recruiter_interview_unlock":
                title, kind = f"AI interview unlocked for {who}", "interview"
            elif l.event_type == "interview_evaluation":
                title, kind = f"{who} completed the AI interview", "interview"
            elif l.event_type == "interview_scheduled":
                title, kind = f"AI interview invitation sent to {who}", "interview"
            elif l.event_type == "ats_score":
                title, kind = f"{who}'s resume scored {l.ats_score if l.ats_score is not None else ''}".strip(), "application"
            elif l.event_type == "project_score":
                title, kind = f"{who}'s project evaluated", "project"
            elif l.event_type in ("repo_verify_batch", "final_shortlist"):
                title, kind = f"{who} ranked in shortlist", "status"
            else:
                title, kind = f"{l.event_type.replace('_', ' ').capitalize()} · {who}", "other"
            items.append({"kind": kind, "title": title, "sub": f"for {job.title}" if job else None, "at": _iso(l.created_at),
                          "candidate_id": l.candidate_id, "application_id": l.application_id})
    for a in ctx.apps[:20]:
        j = ctx.job_by_id.get(a.job_id)
        items.append({"kind": "application", "title": f"New application from {ctx.name(a.candidate_id)}", "sub": f"for {j.title}" if j else None,
                      "at": _iso(a.applied_at), "candidate_id": a.candidate_id, "application_id": a.id})
    for lst in ctx.sis.values():
        for s in lst:
            j = ctx.job_by_id.get(s.job_id)
            items.append({"kind": "interview", "title": f"{s.round_name} scheduled", "sub": f"with {ctx.name(s.candidate_id)}" + (f" · {j.title}" if j else ""),
                          "at": _iso(s.created_at), "candidate_id": s.candidate_id, "application_id": s.application_id})
    for lst in ctx.offers.values():
        for o in lst:
            verb = {"accepted": "Offer accepted", "joined": "Candidate joined", "declined": "Offer declined", "negotiation": "Offer in negotiation"}.get(o.status, "Offer sent")
            items.append({"kind": "offer", "title": verb, "sub": f"by {ctx.name(o.candidate_id)}" if o.status in ("accepted", "declined", "joined") else f"to {ctx.name(o.candidate_id)}",
                          "at": _iso(o.responded_at or o.updated_at or o.created_at), "candidate_id": o.candidate_id, "application_id": o.application_id})
    items.sort(key=lambda x: x["at"] or "", reverse=True)
    return items[:limit]


def _top_skills(jobs: List[Job], limit: int = 8) -> dict:
    open_jobs = [j for j in jobs if j.status == "open"]
    counts: Counter = Counter()
    display: Dict[str, str] = {}
    for j in open_jobs:
        for s in {x.lower(): x for x in _split_skills(j.requirements)}.items():
            counts[s[0]] += 1
            display.setdefault(s[0], s[1])
    n = len(open_jobs)
    return {
        "open_jobs": n,
        "skills": [{"skill": display[k], "jobs": v, "pct": round(v * 100 / n) if n else 0} for k, v in counts.most_common(limit)],
    }


@router.get("/overview")
def overview(days: int = Query(30), recruiter: str = Depends(get_current_recruiter)):
    if days not in (7, 30, 90):
        raise HTTPException(status_code=400, detail="days must be 7, 30 or 90")
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, light=True)
        kpis = _pipeline_kpis(ctx, 30)
        # Applications trend — daily counts for the selected window.
        today = ctx.now.date()
        start = today - timedelta(days=days - 1)
        per_day = Counter(a.applied_at.date() for a in ctx.apps if a.applied_at and a.applied_at.date() >= start)
        trend = [{"date": (start + timedelta(days=i)).isoformat(), "count": per_day.get(start + timedelta(days=i), 0)} for i in range(days)]
        prev_start = start - timedelta(days=days)
        prev_total = sum(1 for a in ctx.apps if a.applied_at and prev_start <= a.applied_at.date() < start)
        # Candidates by branch (distinct applicants).
        by_branch: Counter = Counter()
        best: Dict[int, Application] = {}
        for a in ctx.apps:
            cur = best.get(a.candidate_id)
            if a.status != "rejected" and (cur is None or (_match(a) or 0) > (_match(cur) or 0) or cur.status == "rejected"):
                best[a.candidate_id] = a
            elif cur is None:
                best[a.candidate_id] = a
        for cid in best:
            p = ctx.profiles.get(cid)
            by_branch[norm_branch(p.branch) if p and p.branch else "unknown"] += 1
        top = []
        for cid, a in best.items():
            if a.status == "rejected":
                continue
            item = ctx.app_item(a)
            item["top_skills"] = item["skills"][:3]
            top.append(item)
        top.sort(key=lambda x: (x["match"] or 0), reverse=True)
        shortlisted_apps = [ctx.app_item(a) for a in ctx.apps if ctx.stage(a) in ("shortlisted", "interview")][:100]
        return {
            "days": days,
            "kpis": kpis,
            "trend": trend,
            "trend_total": sum(t["count"] for t in trend),
            "trend_previous_total": prev_total,
            "branches": [{"branch": b, "label": BRANCH_LABELS.get(b, (b or "Other").title()), "count": n} for b, n in by_branch.most_common()],
            "top_candidates": top[:50],
            "activity": _activity(ctx, 8),
            "top_skills": _top_skills(ctx.jobs),
            "schedulable": [{"application_id": x["application_id"], "candidate_name": x["candidate_name"], "job_title": x["job_title"], "stage": x["stage"]} for x in shortlisted_apps],
            "has_jobs": bool(ctx.jobs),
        }


# ─── Jobs & Requisitions (page 14) ───────────────────────────────────────────
JOB_STATUSES = ("open", "closed", "draft", "paused", "archived")


def _job_item(ctx: Ctx, j: Job, apps_by_job: Dict[int, List[Application]]) -> dict:
    apps = apps_by_job.get(j.id, [])
    stages = Counter(ctx.stage(a) for a in apps)
    return {
        "id": j.id,
        "code": job_code(ctx.prefix, j),
        "title": j.title,
        "description": j.description,
        "branch": norm_branch(j.branch),
        "salary_min": j.salary_min,
        "salary_max": j.salary_max,
        "currency": j.currency,
        "location_text": j.location_text,
        "requirements": j.requirements,
        "skills": _split_skills(j.requirements),
        "remote_type": j.remote_type,
        "status": j.status,
        "job_type": j.job_type,
        "experience_level": j.experience_level,
        "openings": j.openings,
        "eligibility": j.eligibility,
        "target_colleges": _loads(j.target_colleges_json, []),
        "created_at": _iso(j.created_at),
        "updated_at": _iso(j.updated_at),
        "applications": len(apps),
        "shortlisted": stages["shortlisted"] + stages["interview"] + stages["offer"] + stages["hired"],
        "interviews": stages["interview"],
        "offers": stages["offer"] + stages["hired"],
        "new_7d": sum(1 for a in apps if a.applied_at and a.applied_at >= ctx.now - timedelta(days=7)),
    }


@router.get("/jobs")
def list_jobs(recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, light=True)
        by_job: Dict[int, List[Application]] = defaultdict(list)
        for a in ctx.apps:
            by_job[a.job_id].append(a)
        items = [_job_item(ctx, j, by_job) for j in ctx.jobs]
        status_counts = Counter(j.status for j in ctx.jobs)
        k = _pipeline_kpis(ctx, 30)
        open_jobs = [j for j in ctx.jobs if j.status == "open"]
        k["active_jobs"] = _kpi(len(open_jobs), *_count_windows((j.created_at for j in open_jobs), ctx.now))
        return {
            "jobs": items,
            "counts": {
                "all": len(ctx.jobs) - status_counts.get("archived", 0),
                "draft": status_counts.get("draft", 0),
                "closed": status_counts.get("closed", 0),
                "archived": status_counts.get("archived", 0),
                "open": status_counts.get("open", 0),
                "paused": status_counts.get("paused", 0),
            },
            "kpis": k,
            "prefix": ctx.prefix,
        }


def _owned_job(ctx: Ctx, job_id: int) -> Job:
    j = ctx.job_by_id.get(job_id)
    if not j:
        # 404 for both "missing" and "someone else's" — never leak existence.
        raise HTTPException(status_code=404, detail="Job not found")
    return j


@router.post("/jobs/{job_id}/duplicate")
def duplicate_job(job_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, with_apps=False)
        src = _owned_job(ctx, job_id)
        now = utc_now()
        copy = Job(
            recruiter_id=ctx.me.id, company_id=src.company_id, title=f"{src.title} (Copy)"[:200], description=src.description,
            branch=src.branch, salary_min=src.salary_min, salary_max=src.salary_max, currency=src.currency,
            location_text=src.location_text, latitude=src.latitude, longitude=src.longitude, requirements=src.requirements,
            remote_type=src.remote_type, status="draft", job_type=src.job_type, experience_level=src.experience_level,
            openings=src.openings, target_colleges_json=src.target_colleges_json, eligibility=src.eligibility,
            created_at=now, updated_at=now,
        )
        session.add(copy)
        session.commit()
        session.refresh(copy)
        return {"id": copy.id, "code": job_code(ctx.prefix, copy), "title": copy.title, "status": copy.status, "message": "Job duplicated as a draft"}


class BulkStatusIn(BaseModel):
    ids: List[int] = Field(..., min_length=1, max_length=100)
    status: str


@router.post("/jobs/bulk-status")
def bulk_job_status(body: BulkStatusIn, recruiter: str = Depends(get_current_recruiter)):
    if body.status not in JOB_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(JOB_STATUSES)}")
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, with_apps=False)
        jobs = [_owned_job(ctx, i) for i in set(body.ids)]
        reopened = [j.id for j in jobs if j.status != "open" and body.status == "open"]
        for j in jobs:
            j.status = body.status
            j.updated_at = utc_now()
            session.add(j)
        session.commit()
        if reopened:   # followers of this company hear about newly opened roles
            from ..services.company_directory import notify_new_internal_job
            for j in jobs:
                if j.id in reopened:
                    session.refresh(j)
                    notify_new_internal_job(j)
        return {"updated": len(jobs), "status": body.status}


@router.delete("/jobs/{job_id}")
def delete_job_safe(job_id: int, recruiter: str = Depends(get_current_recruiter)):
    """Delete a requisition that never received applications. Jobs with
    applicants keep their (audited) hiring history — archive those instead."""
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, with_apps=False)
        j = _owned_job(ctx, job_id)
        n = session.exec(select(Application.id).where(Application.job_id == j.id)).all()
        if n:
            raise HTTPException(status_code=409, detail=f"This job has {len(n)} application(s). Archive it instead so the hiring history is kept.")
        for s in session.exec(select(SavedJob).where(SavedJob.job_id == j.id)).all():
            session.delete(s)
        session.delete(j)
        session.commit()
        return {"deleted": True, "job_id": job_id}


@router.get("/jobs/colleges")
def recommended_colleges(recruiter: str = Depends(get_current_recruiter)):
    """Colleges of (non-private) candidates in the branches this recruiter hires for."""
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, with_apps=False)
        branches = {norm_branch(j.branch) for j in ctx.jobs if j.branch}
        profiles = session.exec(select(CandidateProfile).where(CandidateProfile.college.is_not(None))).all()
        agg: Dict[str, dict] = {}
        for p in profiles:
            b = norm_branch(p.branch)
            if branches and b not in branches:
                continue
            if _privacy(p)["visibility"] == "private":
                continue
            name = (p.college or "").strip()
            if not name:
                continue
            key = name.lower()
            row = agg.setdefault(key, {"college": name, "branches": Counter(), "candidates": 0})
            row["candidates"] += 1
            if b:
                row["branches"][b] += 1
        out = sorted(agg.values(), key=lambda r: (-r["candidates"], r["college"]))[:12]
        targeted = {c.lower() for j in ctx.jobs for c in _loads(j.target_colleges_json, [])}
        return {
            "colleges": [
                {"college": r["college"], "candidates": r["candidates"], "branches": [b for b, _ in r["branches"].most_common()],
                 "branch_labels": [BRANCH_LABELS.get(b, b.title()) for b, _ in r["branches"].most_common()],
                 "targeted": r["college"].lower() in targeted}
                for r in out
            ],
            "branches": sorted(branches),
        }


class TargetCollegeIn(BaseModel):
    college: str = Field(..., min_length=2, max_length=120)


@router.post("/jobs/{job_id}/target-colleges")
def add_target_college(job_id: int, body: TargetCollegeIn, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, with_apps=False)
        j = _owned_job(ctx, job_id)
        lst = _loads(j.target_colleges_json, [])
        name = body.college.strip()
        if name.lower() not in {c.lower() for c in lst}:
            if len(lst) >= 30:
                raise HTTPException(status_code=400, detail="A job can target at most 30 colleges")
            lst.append(name)
        j.target_colleges_json = json.dumps(lst)
        j.updated_at = utc_now()
        session.add(j)
        session.commit()
        return {"job_id": j.id, "target_colleges": lst}


# ─── Candidates (page 15) ────────────────────────────────────────────────────
def _skill_match(profile: CandidateProfile, jobs: List[Job]) -> Optional[int]:
    skills = {s.lower() for s in _loads(profile.skills_json, []) if isinstance(s, str)}
    if not skills:
        return None
    b = norm_branch(profile.branch)
    pool = [j for j in jobs if j.status == "open" and norm_branch(j.branch) == b] or [j for j in jobs if j.status == "open"]
    best = None
    for j in pool:
        req = {s.lower() for s in _split_skills(j.requirements)}
        if not req:
            continue
        score = round(len(skills & req) * 100 / len(req))
        best = score if best is None else max(best, score)
    return best


def _best_app(apps: List[Application], ctx: Ctx) -> Optional[Application]:
    if not apps:
        return None
    return max(apps, key=lambda a: (STAGE_RANK[ctx.stage(a)], _match(a) or 0))


def _candidate_item(ctx: Ctx, cid: int, apps: List[Application], jobs: List[Job]) -> dict:
    p = ctx.profiles.get(cid)
    best = _best_app(apps, ctx)
    match = max((m for m in (_match(a) for a in apps) if m is not None), default=None) if apps else (_skill_match(p, jobs) if p else None)
    stage = ctx.stage(best) if best else None
    return {
        "candidate_id": cid,
        "name": ctx.name(cid),
        "avatar_path": p.avatar_path if p else None,
        "headline": p.headline if p else None,
        "college": p.college if p else None,
        "branch": norm_branch(p.branch) if p else None,
        "location": p.location_text if p else None,
        "cgpa": p.cgpa if p else None,
        "grad_year": p.grad_year if p else None,
        "current_year": p.current_year if p else None,
        "skills": _loads(p.skills_json, [])[:8] if p else [],
        "verified": ctx.verified.get(cid, 0) > 0,
        "verified_projects": ctx.verified.get(cid, 0),
        "match": match,
        "match_source": "application" if apps else "skills",
        "applied": bool(apps),
        "application_ids": [a.id for a in apps],
        "best_application_id": best.id if best else None,
        "stage": stage,
        "stage_label": STAGE_LABELS.get(stage) if stage else None,
        "last_applied_at": _iso(max((a.applied_at for a in apps), default=None)) if apps else None,
        "created_at": _iso(p.created_at) if p else None,
    }


def _paginate(items: list, page: int, page_size: int) -> dict:
    total = len(items)
    pages = max(1, math.ceil(total / page_size))
    page = min(max(1, page), pages)
    return {"items": items[(page - 1) * page_size: page * page_size], "total": total, "page": page, "pages": pages, "page_size": page_size}


def _text_hit(q: str, *fields) -> bool:
    q = q.lower()
    return any(q in str(f).lower() for f in fields if f)


@router.get("/candidates")
def list_candidates(
    view: str = Query("mine"),
    q: str = Query("", max_length=120),
    branch: str = Query(""),
    location: str = Query("", max_length=80),
    status: str = Query(""),
    sort: str = Query("match"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=MAX_PAGE_SIZE),
    recruiter: str = Depends(get_current_recruiter),
):
    if view not in ("mine", "search"):
        raise HTTPException(status_code=400, detail="view must be 'mine' or 'search'")
    if sort not in ("match", "cgpa", "newest", "name"):
        raise HTTPException(status_code=400, detail="sort must be match, cgpa, newest or name")
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, light=True)
        apps_by_cand: Dict[int, List[Application]] = defaultdict(list)
        for a in ctx.apps:
            apps_by_cand[a.candidate_id].append(a)
        if view == "search":
            # ONE query: every profile with its account + verified-project count.
            # (Previously the accounts of non-applicants were never loaded, so
            # suspended students still showed up in platform search.)
            from sqlalchemy import func, select as sa_select

            verified = (sa_select(func.count(StudentProject.id))
                        .where(StudentProject.candidate_id == CandidateProfile.candidate_id, StudentProject.status == "verified")
                        .scalar_subquery())
            cids = []
            for p, u, nver in session.execute(
                sa_select(CandidateProfile, CandidateUser, verified)
                .join(CandidateUser, CandidateUser.id == CandidateProfile.candidate_id)
            ).all():
                mine = p.candidate_id in ctx.applicant_ids
                if not mine and (_privacy(p)["visibility"] == "private" or u.status == "suspended"):
                    continue
                cids.append(p.candidate_id)
                ctx.profiles.setdefault(p.candidate_id, p)
                ctx.users.setdefault(u.id, u)
                if nver and u.id not in ctx.verified:
                    ctx.verified[u.id] = int(nver)
        else:
            cids = list(apps_by_cand)
        items = [_candidate_item(ctx, cid, apps_by_cand.get(cid, []), ctx.jobs) for cid in cids]
        if q.strip():
            qq = q.strip()
            items = [i for i in items if _text_hit(qq, i["name"], i["college"], i["branch"], BRANCH_LABELS.get(i["branch"] or ""), i["location"], i["headline"], " ".join(map(str, ctx.profiles.get(i["candidate_id"]) and _loads(ctx.profiles[i["candidate_id"]].skills_json, []) or [])))]
        if branch:
            nb = norm_branch(branch)
            items = [i for i in items if i["branch"] == nb]
        if location.strip():
            items = [i for i in items if i["location"] and location.strip().lower() in i["location"].lower()]
        if status:
            items = [i for i in items if i["stage"] == status]
        if sort == "match":
            items.sort(key=lambda i: (i["match"] is not None, i["match"] or 0), reverse=True)
        elif sort == "cgpa":
            items.sort(key=lambda i: (i["cgpa"] is not None, i["cgpa"] or 0), reverse=True)
        elif sort == "newest":
            items.sort(key=lambda i: i["last_applied_at"] or i["created_at"] or "", reverse=True)
        else:
            items.sort(key=lambda i: i["name"].lower())
        locations = sorted({(ctx.profiles[c].location_text or "").split(",")[0].strip() for c in cids if c in ctx.profiles and ctx.profiles[c].location_text})
        out = _paginate(items, page, page_size)
        out.update({"view": view, "locations": locations, "stage_counts": dict(Counter(i["stage"] for i in items if i["stage"]))})
        return out


def _visible_candidate(ctx: Ctx, cid: int) -> CandidateProfile:
    ctx.load_candidates([cid])
    user = ctx.users.get(cid)
    p = ctx.profiles.get(cid)
    if not user:
        raise HTTPException(status_code=404, detail="Candidate not found")
    applied = cid in ctx.applicant_ids
    if not applied and (p is None or _privacy(p)["visibility"] == "private" or user.status == "suspended"):
        raise HTTPException(status_code=404, detail="Candidate not found")
    if p is None:
        p = CandidateProfile(candidate_id=cid)
        ctx.profiles[cid] = p
    return p


def _transcript_pairs(raw: Optional[str]) -> List[dict]:
    data = _loads(raw, [])
    out = []
    if data and isinstance(data[0], dict) and "question" in data[0]:
        for t in data:
            out.append({"question": t.get("question"), "answer": t.get("answer"), "kind": t.get("kind"),
                        "follow_ups": [{"question": f.get("question"), "answer": f.get("answer")} for f in (t.get("follow_ups") or []) if isinstance(f, dict)]})
        return out
    pending = None
    for t in data:
        if not isinstance(t, dict):
            continue
        role, text = t.get("role"), t.get("text")
        if role in ("ai", "assistant", "interviewer"):
            if pending:
                out.append(pending)
            pending = {"question": text, "answer": None, "kind": t.get("kind"), "follow_ups": []}
        elif role in ("candidate", "user") and pending:
            pending["answer"] = ((pending["answer"] + " ") if pending["answer"] else "") + (text or "")
    if pending:
        out.append(pending)
    return out


def _si_dict(s: ScheduledInterview, ctx: Ctx) -> dict:
    j = ctx.job_by_id.get(s.job_id)
    return {
        "id": s.id, "application_id": s.application_id, "job_title": j.title if j else None, "round_name": s.round_name,
        "starts_at": _iso(s.starts_at), "duration_min": s.duration_min, "mode": s.mode, "meeting_link": s.meeting_link,
        "location": s.location, "interviewers": s.interviewers, "status": s.status, "feedback": _loads(s.feedback_json, {}),
        "candidate_id": s.candidate_id, "candidate_name": ctx.name(s.candidate_id),
    }


@router.get("/candidates/{candidate_id}")
def candidate_detail(candidate_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, light=True)
        p = _visible_candidate(ctx, candidate_id)
        user = ctx.users.get(candidate_id)
        my_apps = [a for a in ctx.apps if a.candidate_id == candidate_id]
        ctx.undefer(my_apps)
        applied = bool(my_apps)
        priv = _privacy(p)
        contact_visible = applied or priv["show_contact"]
        projects = session.exec(
            select(StudentProject).where(StudentProject.candidate_id == candidate_id).where(StudentProject.status != "draft").order_by(StudentProject.created_at.desc()).limit(50)
        ).all()
        resume_id = next((a.resume_id for a in my_apps if a.resume_id), None) or p.resume_id
        resume = session.get(Resume, resume_id) if resume_id else None
        notes_count = len(session.exec(select(RecruiterNote.id).where(RecruiterNote.recruiter_id == ctx.me.id).where(RecruiterNote.candidate_id == candidate_id)).all())
        item = _candidate_item(ctx, candidate_id, my_apps, ctx.jobs)
        ai = []
        for a in my_apps:
            if a.interview_status in ("completed", "in_progress", "unlocked") or a.interview_transcript_json or a.interview_eval_score is not None:
                j = ctx.job_by_id.get(a.job_id)
                ai.append({
                    "application_id": a.id, "job_title": j.title if j else None, "status": a.interview_status,
                    "eval_score": a.interview_eval_score, "recommendation": a.interview_recommendation,
                    "risk_level": a.interview_risk_level, "risk_score": a.interview_risk_score,
                    "evidence_url": a.interview_evidence_url, "transcript": _transcript_pairs(a.interview_transcript_json),
                })
        scheduled = sorted([_si_dict(s, ctx) for a in my_apps for s in ctx.sis.get(a.id, [])], key=lambda x: x["starts_at"] or "")
        applied_job_ids = {a.job_id for a in my_apps}
        item.update({
            "headline": p.headline, "bio": p.bio, "degree": p.degree, "cover_photo_path": p.cover_photo_path,
            "email": (p.contact_email or (user.username if user else None)) if contact_visible else None,
            "phone": (p.contact_phone or None) if contact_visible else None,
            "contact_visible": contact_visible,
            "contact_hidden_reason": None if contact_visible else "Contact details are private until the candidate applies to one of your jobs.",
            "linkedin_url": p.linkedin_url, "github_url": p.github_url, "portfolio_url": p.portfolio_url,
            "skills": _loads(p.skills_json, []), "skill_levels": _loads(p.skill_levels_json, {}),
            "interests": _loads(p.interests_json, []),
            "education": _loads(p.education_json, []), "experience": _loads(p.experience_json, []),
            "achievements": _loads(p.achievements_json, []), "certifications": [
                {k: c.get(k) for k in ("name", "issuing_organization", "issue_date", "credential_url")} for c in _loads(p.certifications_json, []) if isinstance(c, dict)
            ],
            "projects": [{
                "id": pr.id, "title": pr.title, "description": pr.description, "category": pr.category,
                "tags": _loads(pr.tags_json, []), "tools": _loads(pr.tools_json, []), "image_path": pr.image_path,
                "links": _loads(pr.links_json, []), "status": pr.status, "month": pr.month, "team_size": pr.team_size,
            } for pr in projects],
            "project_score": p.project_score, "project_summary": p.project_summary,
            "applications": [ctx.app_item(a) for a in my_apps],
            "interviews": {"ai": ai, "scheduled": scheduled},
            "resume": {"available": bool(resume) and applied, "filename": resume.filename if resume else None,
                       "uploaded_at": _iso(resume.uploaded_at) if resume else None, "exists": bool(resume)},
            "notes_count": notes_count,
            "invitable_jobs": [{"id": j.id, "title": j.title, "code": job_code(ctx.prefix, j)} for j in ctx.jobs if j.status == "open" and j.id not in applied_job_ids],
        })
        return item


def _resume_for(ctx: Ctx, cid: int) -> Resume:
    _visible_candidate(ctx, cid)
    my_apps = [a for a in ctx.apps if a.candidate_id == cid]
    if not my_apps:
        raise HTTPException(status_code=403, detail="The resume is available once the candidate applies to one of your jobs.")
    p = ctx.profiles.get(cid)
    rid = next((a.resume_id for a in my_apps if a.resume_id), None) or (p.resume_id if p else None)
    r = ctx.session.get(Resume, rid) if rid else None
    if not r:
        raise HTTPException(status_code=404, detail="This candidate has not uploaded a resume")
    return r


@router.get("/candidates/{candidate_id}/resume")
def candidate_resume(candidate_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, light=True)
        r = _resume_for(ctx, candidate_id)
        text = None
        try:
            from ..resume_utils import vector_store
            doc = vector_store.get_document("resumes", r.vector_doc_id)
            if isinstance(doc, dict):
                text = doc.get("document") or doc.get("text")
            elif isinstance(doc, str):
                text = doc
        except Exception:  # pragma: no cover - vector store optional
            text = None
        if not text and r.file_path and os.path.exists(r.file_path):
            try:
                from ..services.extract import extract_text_from_file
                text = extract_text_from_file(r.file_path)
            except Exception:
                text = None
        return {"filename": r.filename, "uploaded_at": _iso(r.uploaded_at), "text": (text or "")[:60000],
                "file_available": bool(r.file_path and os.path.exists(r.file_path))}


@router.get("/candidates/{candidate_id}/resume/file")
def candidate_resume_file(candidate_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, light=True)
        r = _resume_for(ctx, candidate_id)
        if not r.file_path or not os.path.exists(r.file_path):
            raise HTTPException(status_code=404, detail="The resume file is no longer stored; view the extracted text instead")
        return FileResponse(r.file_path, filename=r.filename or "resume")


class CompareIn(BaseModel):
    candidate_ids: List[int] = Field(..., min_length=1, max_length=3)


@router.post("/candidates/compare")
def compare_candidates(body: CompareIn, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, light=True)
        out = []
        for cid in dict.fromkeys(body.candidate_ids):
            p = _visible_candidate(ctx, cid)
            apps = [a for a in ctx.apps if a.candidate_id == cid]
            item = _candidate_item(ctx, cid, apps, ctx.jobs)
            best = _best_app(apps, ctx)
            item.update({
                "skills": _loads(p.skills_json, []),
                "ats_score": best.ats_score if best else None,
                "project_score": (best.project_score if best and best.project_score is not None else p.project_score),
                "interview_score": best.interview_eval_score if best else None,
                "job_title": ctx.job_by_id[best.job_id].title if best and best.job_id in ctx.job_by_id else None,
                "degree": p.degree,
            })
            out.append(item)
        return {"candidates": out}


# Notes
class NoteIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    application_id: Optional[int] = None


def _note_dict(n: RecruiterNote) -> dict:
    return {"id": n.id, "candidate_id": n.candidate_id, "application_id": n.application_id, "text": n.text, "created_at": _iso(n.created_at)}


@router.get("/candidates/{candidate_id}/notes")
def list_notes(candidate_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, light=True)
        _visible_candidate(ctx, candidate_id)
        rows = session.exec(
            select(RecruiterNote).where(RecruiterNote.recruiter_id == ctx.me.id).where(RecruiterNote.candidate_id == candidate_id).order_by(RecruiterNote.created_at.desc()).limit(200)
        ).all()
        return {"notes": [_note_dict(n) for n in rows]}


@router.post("/candidates/{candidate_id}/notes")
def create_note(candidate_id: int, body: NoteIn, recruiter: str = Depends(get_current_recruiter)):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Note text is required")
    with Session(engine) as session:
        ctx = Ctx(session, recruiter)
        _visible_candidate(ctx, candidate_id)
        if body.application_id is not None:
            a = ctx.owned_app(body.application_id)
            if a.candidate_id != candidate_id:
                raise HTTPException(status_code=400, detail="Application does not belong to this candidate")
        n = RecruiterNote(recruiter_id=ctx.me.id, candidate_id=candidate_id, application_id=body.application_id, text=text)
        session.add(n)
        session.commit()
        session.refresh(n)
        return _note_dict(n)


def _owned_note(session: Session, rec: RecruiterUser, note_id: int) -> RecruiterNote:
    n = session.get(RecruiterNote, note_id)
    if not n or n.recruiter_id != rec.id:
        raise HTTPException(status_code=404, detail="Note not found")
    return n


@router.put("/notes/{note_id}")
def update_note(note_id: int, body: NoteIn, recruiter: str = Depends(get_current_recruiter)):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Note text is required")
    with Session(engine) as session:
        n = _owned_note(session, _me(session, recruiter), note_id)
        n.text = text
        session.add(n)
        session.commit()
        session.refresh(n)
        return _note_dict(n)


@router.delete("/notes/{note_id}")
def delete_note(note_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        n = _owned_note(session, _me(session, recruiter), note_id)
        session.delete(n)
        session.commit()
        return {"deleted": True, "id": note_id}


class InviteIn(BaseModel):
    job_id: int
    message: Optional[str] = Field(None, max_length=1500)


@router.post("/candidates/{candidate_id}/invite")
def invite_candidate(candidate_id: int, body: InviteIn, recruiter: str = Depends(get_current_recruiter)):
    from ..services import email_templates
    from ..services.email_delivery import queue_email

    with Session(engine) as session:
        ctx = Ctx(session, recruiter)
        _visible_candidate(ctx, candidate_id)
        job = _owned_job(ctx, body.job_id)
        if job.status != "open":
            raise HTTPException(status_code=400, detail="Only open jobs can be shared with candidates")
        if any(a.candidate_id == candidate_id and a.job_id == job.id for a in ctx.apps):
            raise HTTPException(status_code=400, detail="This candidate has already applied to that job")
        to = ctx.contact_email(candidate_id)
        if not to:
            raise HTTPException(status_code=400, detail="This candidate has no email address on file")
        cp = session.exec(select(CompanyProfile).where(CompanyProfile.owner_recruiter_id == ctx.me.id)).first()
        subject, text, html = email_templates.job_invitation(ctx.name(candidate_id), job.title, job.id, cp.name if cp and cp.name else None, (body.message or "").strip() or None)
        queue_email(to, subject, text, html=html, category="job_invitation")
        return {"queued": True, "job_id": job.id, "message": f"Invitation to apply for {job.title} sent to {ctx.name(candidate_id)}"}


# ─── Applications (page 16) ──────────────────────────────────────────────────
STAGE_FILTERS = ("under_review", "shortlisted", "interview", "offer", "rejected", "hired")


def _parse_date(s: str, field: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field} must be YYYY-MM-DD")


def _filter_apps(ctx: Ctx, job: Optional[int], branch: str, location: str, experience: str, q: str,
                 min_match: Optional[int], min_cgpa: Optional[float], date_from: str, date_to: str) -> List[Application]:
    apps = ctx.apps
    if job is not None:
        _owned_job(ctx, job)
        apps = [a for a in apps if a.job_id == job]
    if branch:
        nb = norm_branch(branch)
        apps = [a for a in apps if norm_branch((ctx.profiles.get(a.candidate_id) or CandidateProfile(candidate_id=0)).branch) == nb]
    if location.strip():
        loc = location.strip().lower()
        apps = [a for a in apps if loc in (ctx.job_by_id[a.job_id].location_text or "").lower()]
    if experience:
        apps = [a for a in apps if (ctx.job_by_id[a.job_id].experience_level or "") == experience]
    df, dt = _parse_date(date_from, "date_from"), _parse_date(date_to, "date_to")
    if df:
        apps = [a for a in apps if a.applied_at and a.applied_at >= df]
    if dt:
        apps = [a for a in apps if a.applied_at and a.applied_at < dt + timedelta(days=1)]
    if min_match is not None:
        apps = [a for a in apps if (_match(a) or 0) >= min_match]
    if min_cgpa is not None:
        apps = [a for a in apps if (ctx.profiles.get(a.candidate_id) and (ctx.profiles[a.candidate_id].cgpa or 0) >= min_cgpa)]
    if q.strip():
        qq = q.strip()

        def hit(a):
            p = ctx.profiles.get(a.candidate_id)
            j = ctx.job_by_id.get(a.job_id)
            return _text_hit(qq, ctx.name(a.candidate_id), p and p.college, p and p.branch, j and j.title,
                             " ".join(_loads(p.skills_json, [])) if p else "", " ".join(_loads(a.matched_skills_json, [])))
        apps = [a for a in apps if hit(a)]
    return apps


def _sort_items(items: List[dict], sort: str) -> List[dict]:
    if sort == "oldest":
        items.sort(key=lambda i: i["applied_at"] or "")
    elif sort == "match":
        items.sort(key=lambda i: (i["match"] is not None, i["match"] or 0), reverse=True)
    elif sort == "match_asc":
        items.sort(key=lambda i: (i["match"] is None, i["match"] or 0))
    elif sort == "cgpa":
        items.sort(key=lambda i: (i["cgpa"] is not None, i["cgpa"] or 0), reverse=True)
    elif sort == "name":
        items.sort(key=lambda i: i["candidate_name"].lower())
    else:
        items.sort(key=lambda i: i["applied_at"] or "", reverse=True)
    return items


SORTS = ("newest", "oldest", "match", "match_asc", "cgpa", "name")


@router.get("/applications")
def list_applications(
    job: Optional[int] = Query(None),
    branch: str = Query(""),
    location: str = Query("", max_length=80),
    status: str = Query(""),
    experience: str = Query(""),
    date_from: str = Query(""),
    date_to: str = Query(""),
    q: str = Query("", max_length=120),
    min_match: Optional[int] = Query(None, ge=0, le=100),
    min_cgpa: Optional[float] = Query(None, ge=0, le=10),
    sort: str = Query("newest"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=MAX_PAGE_SIZE),
    recruiter: str = Depends(get_current_recruiter),
):
    if status and status not in STAGE_FILTERS:
        raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(STAGE_FILTERS)}")
    if sort not in SORTS:
        raise HTTPException(status_code=400, detail=f"sort must be one of: {', '.join(SORTS)}")
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, light=True)
        apps = _filter_apps(ctx, job, branch, location, experience, q, min_match, min_cgpa, date_from, date_to)
        stages = {a.id: ctx.stage(a) for a in apps}
        counts = Counter(stages.values())
        tab_counts = {
            "all": len(apps), "under_review": counts["under_review"], "shortlisted": counts["shortlisted"],
            "interview": counts["interview"], "offer": counts["offer"] + counts["hired"], "rejected": counts["rejected"], "hired": counts["hired"],
        }
        if status == "offer":
            apps = [a for a in apps if stages[a.id] in ("offer", "hired")]
        elif status:
            apps = [a for a in apps if stages[a.id] == status]
        items = _sort_items([ctx.app_item(a) for a in apps], sort)
        out = _paginate(items, page, page_size)
        # Pipeline over all of my applications (or the selected job).
        base = [a for a in ctx.apps if job is None or a.job_id == job]
        all_st = Counter(ctx.stage(a) for a in base)
        n = len(base)
        reached = lambda *ks: sum(all_st[k] for k in ks)  # noqa: E731
        pipeline = [
            {"key": "applied", "label": "Applied", "count": n},
            {"key": "under_review", "label": "Under Review", "count": all_st["under_review"]},
            {"key": "shortlisted", "label": "Shortlisted", "count": reached("shortlisted", "interview", "offer", "hired")},
            {"key": "interview", "label": "Interview", "count": reached("interview", "offer", "hired")},
            {"key": "offer", "label": "Offer", "count": reached("offer", "hired")},
            {"key": "rejected", "label": "Rejected", "count": all_st["rejected"]},
        ]
        for p_ in pipeline:
            p_["pct"] = round(p_["count"] * 100 / n) if n else 0
        out.update({
            "counts": tab_counts,
            "kpis": _pipeline_kpis(ctx, 30),
            "pipeline": pipeline,
            "recent": [ctx.app_item(a) for a in ctx.apps[:5]],
            "jobs": [{"id": j.id, "title": j.title, "code": job_code(ctx.prefix, j), "status": j.status} for j in ctx.jobs],
            "locations": sorted({(j.location_text or "").split(",")[0].strip() for j in ctx.jobs if j.location_text}),
        })
        return out


@router.get("/applications/{application_id}")
def application_detail(application_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, light=True)
        a = ctx.owned_app(application_id)
        ctx.undefer([a])
        item = ctx.app_item(a)
        j = ctx.job_by_id[a.job_id]
        item.update({
            "matched_skills": _loads(a.matched_skills_json, []), "missing_skills": _loads(a.missing_skills_json, []),
            "project_summary": a.project_summary, "repo_match_reasoning": a.repo_match_reasoning,
            "ai_recommendation": a.ai_recommendation, "interview_recommendation": a.interview_recommendation,
            "interview_risk_score": a.interview_risk_score, "interview_evidence_url": a.interview_evidence_url,
            "transcript": _transcript_pairs(a.interview_transcript_json),
            "human_decision_notes": a.human_decision_notes, "human_reviewer": a.human_reviewer,
            "scheduled_interviews": [_si_dict(s, ctx) for s in ctx.sis.get(a.id, [])],
            "job": {"id": j.id, "title": j.title, "code": job_code(ctx.prefix, j), "branch": norm_branch(j.branch), "location_text": j.location_text,
                    "job_type": j.job_type, "remote_type": j.remote_type, "created_at": _iso(j.created_at), "status": j.status},
        })
        return item


def _set_status(ctx: Ctx, a: Application, status: str, note: Optional[str], action: str):
    a.status = status
    a.pending_human_review = False
    a.human_reviewer = ctx.username
    if note:
        a.human_decision_notes = note
    ctx.session.add(a)
    ctx.session.commit()
    ctx.session.refresh(a)
    record_audit_event(
        session=ctx.session, event_type="recruiter_decision", application_id=a.id, candidate_id=a.candidate_id,
        job_id=a.job_id, ats_score=a.ats_score, project_score=a.project_score, final_score=a.final_score,
        human_reviewer=ctx.username, human_action=action,
        final_recommendation=note or f"Status changed to {status} by {ctx.username}",
    )


def _project_verified(ctx: Ctx, a: Application) -> bool:
    return a.repo_match_score is not None or a.project_score is not None


def advance(ctx: Ctx, a: Application) -> dict:
    """Single source of truth for "Move to next stage" (used everywhere)."""
    name = ctx.name(a.candidate_id)
    base = {"application_id": a.id, "candidate_name": name}
    st = ctx.stage(a)
    if st == "rejected":
        return {**base, "ok": False, "changed": False, "action": "none", "new_status": a.status,
                "message": f"{name} was rejected — shortlist them first if you want to reconsider."}
    if st in ("offer", "hired"):
        return {**base, "ok": True, "changed": False, "action": "offer", "new_status": a.status, "navigate": f"/recruiter/offers?application={a.id}",
                "message": f"{name} already has an offer — opening Offers & Hiring."}
    if a.status in ("ats_check", "repo_verification"):
        _set_status(ctx, a, "shortlisted", None, "status_change_shortlisted")
        return {**base, "ok": True, "changed": True, "action": "shortlisted", "new_status": "shortlisted",
                "message": f"{name} moved to Shortlisted."}
    if a.status == "automated_interview" or a.interview_status == "completed":
        return {**base, "ok": True, "changed": False, "action": "offer", "new_status": a.status, "navigate": f"/recruiter/offers?application={a.id}",
                "message": f"{name} has completed the interview stage — continue with an offer."}
    if a.status == "shortlisted":
        if a.interview_status in ("unlocked", "in_progress"):
            return {**base, "ok": True, "changed": False, "action": "none", "new_status": a.status,
                    "message": f"The AI interview is already unlocked — waiting for {name} to complete it."}
        if not _project_verified(ctx, a):
            return {**base, "ok": False, "changed": False, "action": "none", "new_status": a.status,
                    "message": f"{name} stays Shortlisted: the project/repo verification hasn't been completed yet, so the AI interview can't be unlocked."}
        a.interview_status = "unlocked"
        a.human_reviewer = ctx.username
        ctx.session.add(a)
        ctx.session.commit()
        ctx.session.refresh(a)
        record_audit_event(
            session=ctx.session, event_type="recruiter_interview_unlock", application_id=a.id, candidate_id=a.candidate_id,
            job_id=a.job_id, ats_score=a.ats_score, project_score=a.project_score or a.repo_match_score, final_score=a.final_score,
            human_reviewer=ctx.username, human_action="unlocked_interview",
            final_recommendation=f"Recruiter {ctx.username} moved candidate to interview stage (project score {a.repo_match_score}).",
        )
        return {**base, "ok": True, "changed": True, "action": "interview_unlocked", "new_status": a.status,
                "message": f"AI interview unlocked for {name} — moved to Interview."}
    return {**base, "ok": False, "changed": False, "action": "none", "new_status": a.status, "message": "No next stage available."}


@router.post("/applications/{application_id}/next-stage")
def next_stage(application_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        ctx = Ctx(session, recruiter)
        return advance(ctx, ctx.owned_app(application_id))


class BulkIn(BaseModel):
    ids: List[int] = Field(..., min_length=1, max_length=200)
    action: str
    subject: Optional[str] = Field(None, max_length=200)
    body: Optional[str] = Field(None, max_length=5000)
    reason: Optional[str] = Field(None, max_length=1000)


BULK_ACTIONS = ("shortlist", "reject", "email", "next_stage", "unshortlist")


@router.post("/applications/bulk")
def bulk_applications(body: BulkIn, recruiter: str = Depends(get_current_recruiter)):
    if body.action not in BULK_ACTIONS:
        raise HTTPException(status_code=400, detail=f"action must be one of: {', '.join(BULK_ACTIONS)}")
    if body.action == "email" and (not (body.subject or "").strip() or not (body.body or "").strip()):
        raise HTTPException(status_code=400, detail="Subject and message are required to send an email")
    with Session(engine) as session:
        ctx = Ctx(session, recruiter)
        apps = [ctx.owned_app(i) for i in dict.fromkeys(body.ids)]  # validate ownership of ALL first
        results = []
        if body.action == "shortlist":
            for a in apps:
                if a.status == "shortlisted":
                    results.append({"application_id": a.id, "ok": True, "changed": False, "message": "Already shortlisted"})
                    continue
                if ctx.stage(a) in ("interview", "offer", "hired") and a.status != "rejected":
                    results.append({"application_id": a.id, "ok": False, "changed": False, "message": "Already past the shortlist stage"})
                    continue
                _set_status(ctx, a, "shortlisted", None, "status_change_shortlisted")
                results.append({"application_id": a.id, "ok": True, "changed": True, "message": "Shortlisted"})
        elif body.action == "reject":
            reason = (body.reason or "").strip() or None
            for a in apps:
                if a.status == "rejected":
                    results.append({"application_id": a.id, "ok": True, "changed": False, "message": "Already rejected"})
                    continue
                _set_status(ctx, a, "rejected", reason, "status_change_rejected")
                results.append({"application_id": a.id, "ok": True, "changed": True, "message": "Rejected"})
        elif body.action == "unshortlist":
            for a in apps:
                if a.status != "shortlisted" or ctx.stage(a) != "shortlisted":
                    results.append({"application_id": a.id, "ok": False, "changed": False, "message": "Only candidates in the Shortlisted stage can be removed"})
                    continue
                _set_status(ctx, a, "ats_check", body.reason, "status_change_ats_check")
                results.append({"application_id": a.id, "ok": True, "changed": True, "message": "Removed from shortlist"})
        elif body.action == "next_stage":
            results = [advance(ctx, a) for a in apps]
        else:  # email
            from ..services import email_templates
            from ..services.email_delivery import queue_email
            cp = session.exec(select(CompanyProfile).where(CompanyProfile.owner_recruiter_id == ctx.me.id)).first()
            company = cp.name if cp and cp.name else None
            for a in apps:
                to = ctx.contact_email(a.candidate_id)
                if not to:
                    results.append({"application_id": a.id, "ok": False, "changed": False, "message": "No email on file"})
                    continue
                j = ctx.job_by_id.get(a.job_id)
                subject, text, html = email_templates.recruiter_message(ctx.name(a.candidate_id), body.subject.strip(), body.body.strip(), company, j.title if j else None)
                queue_email(to, subject, text, html=html, category="recruiter_message")
                results.append({"application_id": a.id, "ok": True, "changed": False, "message": "Email queued"})
        ok = sum(1 for r in results if r.get("ok"))
        changed = sum(1 for r in results if r.get("changed"))
        verb = {"shortlist": "shortlisted", "reject": "rejected", "unshortlist": "removed from shortlist", "next_stage": "moved forward", "email": "emailed"}[body.action]
        n = ok if body.action == "email" else changed
        summary = f"{n} of {len(results)} candidate{'s' if len(results) != 1 else ''} {verb}"
        skipped = [r for r in results if not r.get("ok")]
        if skipped and body.action != "next_stage":
            summary += f" · {len(skipped)} skipped"
        if body.action == "next_stage" and len(results) == 1:
            summary = results[0]["message"]
        return {"action": body.action, "results": results, "ok": ok, "changed": changed, "message": summary}


# ─── Shortlisted (page 17) ───────────────────────────────────────────────────
INTERVIEW_STATES = ("interview_scheduled", "interview_completed", "under_review")


@router.get("/shortlisted")
def list_shortlisted(
    job: Optional[int] = Query(None),
    branch: str = Query(""),
    location: str = Query("", max_length=80),
    experience: str = Query(""),
    interview_status: str = Query(""),
    q: str = Query("", max_length=120),
    min_match: Optional[int] = Query(None, ge=0, le=100),
    min_cgpa: Optional[float] = Query(None, ge=0, le=10),
    sort: str = Query("match"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=MAX_PAGE_SIZE),
    recruiter: str = Depends(get_current_recruiter),
):
    if interview_status and interview_status not in INTERVIEW_STATES:
        raise HTTPException(status_code=400, detail=f"interview_status must be one of: {', '.join(INTERVIEW_STATES)}")
    if sort not in SORTS:
        raise HTTPException(status_code=400, detail=f"sort must be one of: {', '.join(SORTS)}")
    with Session(engine) as session:
        ctx = Ctx(session, recruiter, light=True)
        SHORT = ("shortlisted", "interview", "offer", "hired")
        all_short = [a for a in ctx.apps if ctx.stage(a) in SHORT]
        apps = [a for a in _filter_apps(ctx, job, branch, location, experience, q, min_match, min_cgpa, "", "") if ctx.stage(a) in SHORT]
        items = [ctx.app_item(a) for a in apps]
        if interview_status:
            items = [i for i in items if i["interview_state"] == interview_status]
        items = _sort_items(items, sort)
        out = _paginate(items, page, page_size)
        # KPIs / pipeline over all shortlisted (unfiltered).
        n = len(all_short)
        states = {a.id: interview_state(a, ctx.sis.get(a.id, []), ctx.now) for a in all_short}
        st = {a.id: ctx.stage(a) for a in all_short}
        sched = sum(1 for a in all_short if states[a.id]["status"] in ("interview_scheduled", "interview_completed") or ctx.sis.get(a.id))
        done = sum(1 for a in all_short if states[a.id]["status"] == "interview_completed")
        hr = sum(1 for a in all_short if states[a.id]["has_hr_round"])
        offer = sum(1 for a in all_short if st[a.id] in ("offer", "hired"))
        hired = sum(1 for a in all_short if st[a.id] == "hired")
        pipeline = [
            {"key": "shortlisted", "label": "Shortlisted", "count": n},
            {"key": "interview_scheduled", "label": "Interview Scheduled", "count": sched},
            {"key": "interview_completed", "label": "Interview Completed", "count": done},
            {"key": "hr_round", "label": "HR Round", "count": hr},
            {"key": "offer", "label": "Offer Made", "count": offer},
            {"key": "hired", "label": "Hired", "count": hired},
        ]
        for p_ in pipeline:
            p_["pct"] = round(p_["count"] * 100 / n) if n else 0
        upcoming = sorted(
            [s for a in ctx.apps for s in ctx.sis.get(a.id, []) if s.status == "scheduled" and s.starts_at >= ctx.now],
            key=lambda s: s.starts_at,
        )[:6]
        k = _pipeline_kpis(ctx, 30)
        out.update({
            "kpis": {"shortlisted": k["shortlisted"], "interviews_scheduled": k["interviews_scheduled"], "offers": k["offers"], "hired": k["hired"]},
            "pipeline": pipeline,
            "upcoming": [_si_dict(s, ctx) for s in upcoming],
            "insights": _insights(ctx, all_short),
            "jobs": [{"id": j.id, "title": j.title, "code": job_code(ctx.prefix, j)} for j in ctx.jobs],
            "locations": sorted({(j.location_text or "").split(",")[0].strip() for j in ctx.jobs if j.location_text}),
        })
        return out


def _avg(xs: List[float]) -> Optional[float]:
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 1) if xs else None


def _insights(ctx: Ctx, short: List[Application]) -> List[dict]:
    out: List[dict] = []
    allc = {a.candidate_id for a in ctx.apps}
    sc = {a.candidate_id for a in short}
    if not sc:
        return [{"title": "No shortlist yet", "text": "Shortlist candidates from Applications to see selection insights here.", "kind": "info"}]
    v_short = sum(1 for c in sc if ctx.verified.get(c))
    v_all = sum(1 for c in allc if ctx.verified.get(c))
    share_s = round(v_short * 100 / len(sc))
    share_a = round(v_all * 100 / len(allc)) if allc else 0
    out.append({
        "title": "Verified projects matter", "kind": "projects", "value": share_s,
        "text": f"{share_s}% of your shortlisted candidates have at least one verified project, versus {share_a}% of all applicants"
                + (" — verified project work is a strong signal in your selections." if share_s > share_a else "."),
    })
    by_b: Dict[str, List[float]] = defaultdict(list)
    for a in short:
        p = ctx.profiles.get(a.candidate_id)
        by_b[norm_branch(p.branch) if p and p.branch else "unknown"].append(_match(a) or 0)
    if by_b:
        b, vals = max(by_b.items(), key=lambda kv: (_avg(kv[1]) or 0, len(kv[1])))
        overall = _avg([_match(a) or 0 for a in short])
        out.append({
            "title": "Strongest branch", "kind": "branch", "value": _avg(vals),
            "text": f"{BRANCH_LABELS.get(b, b.title())} candidates have the highest average match on your shortlist ({_avg(vals)}% across {len(vals)}, vs {overall}% overall).",
        })
    with_v = [_match(a) or 0 for a in short if ctx.verified.get(a.candidate_id)]
    without = [_match(a) or 0 for a in short if not ctx.verified.get(a.candidate_id)]
    if with_v and without:
        diff = round((_avg(with_v) or 0) - (_avg(without) or 0), 1)
        out.append({"title": "Match vs. verification", "kind": "match", "value": diff,
                    "text": f"Shortlisted candidates with verified projects average {_avg(with_v)}% match vs {_avg(without)}% without ({'+' if diff >= 0 else ''}{diff} pts)."})
    reached = sum(1 for a in short if ctx.stage(a) in ("interview", "offer", "hired"))
    out.append({"title": "Shortlist → interview", "kind": "conversion", "value": round(reached * 100 / len(short)),
                "text": f"{round(reached * 100 / len(short))}% of shortlisted applications have reached the interview stage ({reached} of {len(short)})."})
    return out
