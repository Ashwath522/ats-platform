"""v2 portal API — admin area (pages 23 Platform Dashboard, 24 User Management
and the supporting admin pages). Routes are registered in app/main.py with no
prefix; everything lives under /api/admin/portal/... and is admin-only.

Data model notes
----------------
* Two account tables: staff (recruiters / admins) live in ``User`` (recruiters
  also have a legacy ``RecruiterUser`` row with the same username); students
  mostly live only in ``CandidateUser`` + ``CandidateProfile``. User
  Management presents one unified list with composite ids:
  ``c-<CandidateUser.id>``, ``u-<User.id>`` and ``r-<RecruiterRequest.id>``
  (a recruiter access request that has not been approved yet, so no account).
* A candidate is *verified* when they have a resume and an email address, when
  their optional ``User`` row is email-verified, or when an admin verified them
  (recorded as an ``admin_action`` audit event ``verify_user:c-<id>`` — there is
  no verified column on CandidateUser).
* Admin notes: for candidates they are ``RecruiterNote`` rows with
  ``recruiter_id = 0`` (0 is never a real RecruiterUser id, so recruiter-scoped
  queries never see them); for staff they are stored in
  ``User.settings_json['admin_notes']``.
* Every mutating admin action writes ``record_audit_event`` with
  ``event_type='admin_action'``, ``human_reviewer=<admin email>`` and
  ``human_action='<action>:<target id>'``.
"""
from __future__ import annotations

import json
import logging
import re
import secrets
import string
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field as PField
from sqlalchemy import delete as sa_delete, func, or_, text
from sqlmodel import Session, select
from starlette.concurrency import run_in_threadpool

from ..auth import get_current_admin, hash_password
from ..db import (
    Application, CandidateProfile, CandidateUser, Company, CompanyProfile, ContentFlag, DecisionAuditLog,
    EmailLog, EmailToken, InterviewSession, Job, Offer, Post, RecruiterNote, RecruiterPost, RecruiterProfile,
    RecruiterRequest, RecruiterUser, Resume, SavedJob, ScheduledInterview, StudentProject, TeamMember, User, PlatformSetting,
    engine, utc_now,
)
from ..services.audit import record_audit_event

router = APIRouter(tags=["admin_portal"])
log = logging.getLogger("ats-platform.admin_portal")

P = "/api/admin/portal"
_PROCESS_STARTED = time.time()
MAX_PAGE = 100
MAX_EXPORT = 5000
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# ── small helpers ─────────────────────────────────────────────────────────────


def _iso(d: Optional[datetime]) -> Optional[str]:
    if not d:
        return None
    if isinstance(d, datetime):
        return d.replace(microsecond=0).isoformat() + "Z"
    return str(d)


def _jl(raw: Optional[str], default):
    if not raw:
        return default
    try:
        v = json.loads(raw)
        return v if v is not None else default
    except (TypeError, ValueError):
        return default


def _parse_day(value: Optional[str], name: str) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{name} must be a date (YYYY-MM-DD)")


def _range(start: Optional[str], end: Optional[str], default_days: int = 120) -> Tuple[datetime, datetime]:
    """Inclusive [start, end] day range → [start 00:00, end+1 00:00) naive UTC datetimes."""
    today = utc_now().date()
    e = _parse_day(end, "end") or today
    s = _parse_day(start, "start")
    if s is None:
        first = date(e.year, e.month, 1)
        # default: the current month and the three before it
        m = first.month - 3
        y = first.year + (m - 1) // 12
        m = (m - 1) % 12 + 1
        s = date(y, m, 1) if default_days else first
    if s > e:
        raise HTTPException(status_code=400, detail="start must be on or before end")
    if (e - s).days > 3 * 366:
        raise HTTPException(status_code=400, detail="Date range is limited to 3 years")
    return datetime.combine(s, datetime.min.time()), datetime.combine(e + timedelta(days=1), datetime.min.time())


def _pct_change(cur: int, prev: int) -> Optional[int]:
    if prev == 0:
        return None if cur == 0 else None
    return round((cur - prev) * 100 / prev)


def _page(items: List[Any], page: int, page_size: int) -> Tuple[List[Any], int]:
    page_size = max(1, min(MAX_PAGE, page_size))
    page = max(1, page)
    return items[(page - 1) * page_size: page * page_size], len(items)


def _admin_user(s: Session, admin_email: str) -> User:
    me = s.exec(select(User).where(User.email == admin_email)).first()
    if not me:
        raise HTTPException(status_code=401, detail="Admin account not found")
    return me


def _audit(s: Session, admin: str, action: str, target: Optional[str] = None, candidate_id: Optional[int] = None,
           job_id: Optional[int] = None, details: Optional[dict] = None, summary: Optional[str] = None) -> None:
    record_audit_event(
        s,
        event_type="admin_action",
        candidate_id=candidate_id,
        job_id=job_id,
        human_reviewer=admin,
        human_action=f"{action}:{target}" if target else action,
        raw_verdicts=details,
        final_recommendation=summary,
        human_confirmed_at=utc_now(),
    )


def _temp_password(n: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(n))
        if any(c.isdigit() for c in pw) and any(c.isupper() for c in pw) and any(c.islower() for c in pw):
            return pw


def _dev_mode() -> bool:
    from .auth import _dev_mode_enabled
    return _dev_mode_enabled()


# ── branches ──────────────────────────────────────────────────────────────────

CORE_BRANCHES = [
    ("mechanical", "Mechanical"), ("eee", "Electrical"), ("ece", "Electronics & Comm."), ("civil", "Civil"),
    ("chemical", "Chemical"), ("aerospace", "Aerospace"), ("automobile", "Automotive"), ("metallurgy", "Metallurgy"),
]
BRANCH_LABEL = dict(CORE_BRANCHES) | {"cs": "Computer Science", "other": "Others"}


def branch_id(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    k = str(raw).strip().lower()
    if not k:
        return None
    if k in BRANCH_LABEL:
        return k
    if "electronic" in k or "communication" in k or k in {"ec", "ece", "etc", "entc"}:
        return "ece"
    if "electric" in k or k in {"ee", "eee", "eie"}:
        return "eee"
    if k.startswith("mech") or "mechatronic" in k or "production" in k or "industrial" in k:
        return "mechanical"
    if "civil" in k or "structur" in k or "construction" in k:
        return "civil"
    if "chem" in k or "process" in k:
        return "chemical"
    if "aero" in k or "aviation" in k or "space" in k:
        return "aerospace"
    if "auto" in k or "vehicle" in k:
        return "automobile"
    if "metal" in k or "material" in k:
        return "metallurgy"
    if "software" in k or "computer" in k or k in {"cs", "cse", "it", "information technology"} or "information" in k:
        return "cs"
    return "other"


def branch_label(raw: Optional[str]) -> Optional[str]:
    b = branch_id(raw)
    if not b:
        return None
    return BRANCH_LABEL.get(b) if b != "other" else str(raw).strip().title()


# ── shared index (companies, recruiters) ──────────────────────────────────────


class _Index:
    """Lookups built once per request (all tables involved are small)."""

    def __init__(self, s: Session):
        self.s = s
        self.ru_by_name = {r.username.lower(): r for r in s.exec(select(RecruiterUser)).all()}
        self.ru_by_id = {r.id: r for r in self.ru_by_name.values()}
        self.cp_by_owner = {c.owner_recruiter_id: c for c in s.exec(select(CompanyProfile)).all()}
        self.rp_by_rid = {p.recruiter_id: p for p in s.exec(select(RecruiterProfile)).all()}
        self.req_by_email: Dict[str, RecruiterRequest] = {}
        self.requests = s.exec(select(RecruiterRequest).order_by(RecruiterRequest.submitted_at.asc())).all()
        for r in self.requests:
            self.req_by_email[r.email.lower()] = r  # latest wins
        self.team_owner_by_email = {}
        for t in s.exec(select(TeamMember)).all():
            if t.status != "inactive":
                self.team_owner_by_email.setdefault(t.email.lower(), t.owner_recruiter_id)
        self.legacy_company = {c.id: c.name for c in s.exec(select(Company)).all()}

    def company_for_recruiter_id(self, rid: Optional[int]) -> Optional[str]:
        if rid is None:
            return None
        cp = self.cp_by_owner.get(rid)
        if cp and cp.name:
            return cp.name
        rp = self.rp_by_rid.get(rid)
        if rp and rp.company_name:
            return rp.company_name
        ru = self.ru_by_id.get(rid)
        if ru:
            req = self.req_by_email.get(ru.username.lower())
            if req and req.company_name:
                return req.company_name
            owner = self.team_owner_by_email.get(ru.username.lower())
            if owner and owner != rid:
                return self.company_for_recruiter_id(owner)
            return _domain_company(ru.username)
        return None

    def company_for_email(self, email: str) -> Optional[str]:
        ru = self.ru_by_name.get(email.lower())
        if ru:
            return self.company_for_recruiter_id(ru.id)
        req = self.req_by_email.get(email.lower())
        if req and req.company_name:
            return req.company_name
        return None

    def company_for_job(self, job: Job) -> str:
        if job.company_id and self.legacy_company.get(job.company_id):
            return self.legacy_company[job.company_id]
        return self.company_for_recruiter_id(job.recruiter_id) or "Unknown company"


_FREE_MAIL = {"gmail", "yahoo", "outlook", "hotmail", "icloud", "proton", "protonmail", "live", "rediffmail"}


def _domain_company(email: str) -> Optional[str]:
    if "@" not in email:
        return None
    dom = email.split("@", 1)[1].split(".")[0]
    if dom in _FREE_MAIL or dom in {"corelink", "demo", "example", "test"}:
        return None
    return dom.upper() if len(dom) <= 4 else dom.title()


def _norm_company(name: Optional[str]) -> str:
    n = (name or "").lower()
    n = re.sub(r"\b(private|pvt|limited|ltd|inc|llp|corporation|corp|co)\b\.?", "", n)
    return re.sub(r"[^a-z0-9]+", "", n)


# ── unified users ─────────────────────────────────────────────────────────────


def _admin_verified_ids(s: Session) -> set:
    rows = s.exec(
        select(DecisionAuditLog.human_action).where(
            DecisionAuditLog.event_type == "admin_action", DecisionAuditLog.human_action.like("verify_user:%")
        )
    ).all()
    return {r.split(":", 1)[1] for r in rows if r and ":" in r}


def _build_users(s: Session, ix: _Index, include_requests: bool = True) -> List[dict]:
    verified_ids = _admin_verified_ids(s)
    cands = s.exec(select(CandidateUser)).all()
    profiles = {p.candidate_id: p for p in s.exec(select(CandidateProfile)).all()}
    users = s.exec(select(User)).all()
    users_by_email = {u.email.lower(): u for u in users}
    owner_ids = set(ix.cp_by_owner)
    rows: List[dict] = []
    cand_names = set()
    for c in cands:
        cand_names.add(c.username.lower())
        p = profiles.get(c.id)
        u = users_by_email.get(c.username.lower())
        u = u if u and u.role == "candidate" else None
        email = c.username if "@" in c.username else (p.contact_email if p and p.contact_email else None)
        uid = f"c-{c.id}"
        verified = bool(p and p.resume_id and email) or bool(u and u.email_verified) or uid in verified_ids
        name = (p.full_name if p and p.full_name else None) or (u.name if u and u.name and u.name != u.email else None) \
            or re.sub(r"[._]+", " ", c.username.split("@")[0]).title()
        status = "suspended" if (c.status or "active") == "suspended" or (u and u.status == "suspended") else "active"
        rows.append({
            "id": uid, "kind": "c", "pk": c.id, "type": "candidate", "role": "student", "name": name,
            "email": email, "username": c.username, "phone": (p.contact_phone if p else None) or (u.phone if u else None),
            "org": p.college if p else None, "dept": branch_label(p.branch) if p else None,
            "branch": branch_id(p.branch) if p else None, "branch_raw": p.branch if p else None,
            "college": p.college if p else None, "cgpa": p.cgpa if p else None,
            "location": p.location_text if p else None, "degree": p.degree if p else None,
            "grad_year": p.grad_year if p else None, "headline": p.headline if p else None,
            "joined": c.created_at, "last_login": c.last_login_at, "profile_updated": p.updated_at if p else None,
            "status": status, "verification": "verified" if verified else "pending",
            "has_resume": bool(p and p.resume_id), "avatar": p.avatar_path if p else None,
        })
    for u in users:
        if u.role == "candidate" and u.email.lower() in cand_names:
            continue
        uid = f"u-{u.id}"
        org = dept = None
        role = u.role
        verdict = None
        if u.role == "recruiter":
            ru = ix.ru_by_name.get(u.email.lower())
            org = ix.company_for_email(u.email)
            req = ix.req_by_email.get(u.email.lower())
            verdict = req.verification_verdict if req else None
            dept = (req.designation if req and req.designation else None) or "Recruitment"
            role = "company_owner" if ru and ru.id in owner_ids else "recruiter"
            verified = (bool(u.email_verified) and (req is None or req.status == "approved")) or uid in verified_ids
        elif u.role == "admin":
            org, dept, verified = "CoreLink", "Platform Admin", True
        else:
            verified = bool(u.email_verified) or uid in verified_ids
        rows.append({
            "id": uid, "kind": "u", "pk": u.id, "type": u.role if u.role in {"recruiter", "admin", "candidate"} else "candidate",
            "role": role if u.role != "candidate" else "student", "name": u.name if u.name and u.name != u.email else u.email.split("@")[0].title(),
            "email": u.email, "username": u.email, "phone": u.phone, "org": org, "dept": dept, "branch": None, "branch_raw": None,
            "college": None, "cgpa": None, "location": None, "joined": u.created_at, "last_login": u.last_login_at,
            "profile_updated": None, "status": "suspended" if u.status == "suspended" else "active",
            "verification": "verified" if verified else "pending", "verdict": verdict, "avatar": None,
        })
    if include_requests:
        for r in ix.requests:
            if r.status != "pending" or r.email.lower() in users_by_email:
                continue
            rows.append({
                "id": f"r-{r.id}", "kind": "r", "pk": r.id, "type": "recruiter", "role": "recruiter", "name": r.name,
                "email": r.email, "username": r.email, "phone": r.phone, "org": r.company_name, "dept": r.designation or "Recruitment",
                "branch": None, "branch_raw": None, "college": None, "cgpa": None, "location": None,
                "joined": r.submitted_at, "last_login": None, "profile_updated": None, "status": "awaiting_approval",
                "verification": "pending", "verdict": r.verification_verdict, "avatar": None,
            })
    return rows


def _public_user(r: dict) -> dict:
    out = {k: v for k, v in r.items() if k not in {"pk", "kind", "username", "branch_raw"}}
    for k in ("joined", "last_login", "profile_updated"):
        out[k] = _iso(r.get(k))
    return out


def _user_kpis(rows: List[dict]) -> dict:
    accts = [r for r in rows if r["kind"] != "r"]
    total = len(accts)
    active = [r for r in accts if r["status"] == "active"]
    cand = sum(1 for r in accts if r["type"] == "candidate")
    rec = sum(1 for r in accts if r["type"] == "recruiter")
    adm = sum(1 for r in accts if r["type"] == "admin")
    ver = sum(1 for r in active if r["verification"] == "verified")
    pend = sum(1 for r in rows if r["verification"] == "pending" and r["status"] != "suspended")
    susp = sum(1 for r in accts if r["status"] == "suspended")
    pc = lambda a, b: round(a * 100 / b) if b else 0  # noqa: E731
    return {
        "total": total, "candidates": cand, "candidates_pct": pc(cand, total), "recruiters": rec,
        "recruiters_pct": pc(rec, total), "admins": adm, "verified": ver, "verified_pct_active": pc(ver, len(active)),
        "pending": pend, "pending_pct": pc(pend, total), "suspended": susp, "suspended_pct": pc(susp, total),
    }


TABS = {
    "all": lambda r: r["kind"] != "r",
    "candidates": lambda r: r["type"] == "candidate" and r["kind"] != "r",
    "recruiters": lambda r: r["type"] == "recruiter" and r["kind"] != "r",
    "admins": lambda r: r["type"] == "admin",
    "pending": lambda r: r["verification"] == "pending" and r["status"] != "suspended",
    "suspended": lambda r: r["status"] == "suspended",
}


def _find_user(s: Session, uid: str) -> Tuple[str, Any]:
    m = re.fullmatch(r"([cur])-(\d+)", uid or "")
    if not m:
        raise HTTPException(status_code=400, detail="Invalid user id")
    kind, pk = m.group(1), int(m.group(2))
    model = {"c": CandidateUser, "u": User, "r": RecruiterRequest}[kind]
    obj = s.get(model, pk)
    if not obj:
        raise HTTPException(status_code=404, detail="User not found")
    return kind, obj


def _row_for(s: Session, uid: str) -> dict:
    ix = _Index(s)
    for r in _build_users(s, ix):
        if r["id"] == uid:
            return r
    raise HTTPException(status_code=404, detail="User not found")


def _active_admins(s: Session) -> List[User]:
    return [u for u in s.exec(select(User).where(User.role == "admin")).all() if u.status != "suspended"]


def _guard_staff_change(s: Session, me: User, target: User, action: str) -> None:
    if target.id == me.id and action in {"suspend", "delete", "change_role"}:
        raise HTTPException(status_code=400, detail=f"You cannot {action.replace('_', ' ')} your own account")
    if target.role == "admin" and action in {"suspend", "delete", "change_role"} and target.status != "suspended":
        if len(_active_admins(s)) <= 1:
            raise HTTPException(status_code=400, detail="This is the last active admin account")


# ── platform health ───────────────────────────────────────────────────────────


def _health(s: Session) -> dict:
    t0 = time.perf_counter()
    db_ok = True
    try:
        s.exec(text("SELECT 1")).all()
    except Exception:  # pragma: no cover
        db_ok = False
    db_ms = round((time.perf_counter() - t0) * 1000, 1)
    since = utc_now() - timedelta(days=7)
    email_rows = s.exec(select(EmailLog.status, func.count()).where(EmailLog.created_at >= since).group_by(EmailLog.status)).all()
    by = {k: n for k, n in email_rows}
    sent = by.get("sent", 0) + by.get("logged", 0)
    failed = by.get("failed", 0)
    try:
        from ..services.llm_stream import configured_providers
        providers = [p.name for p in configured_providers()]
    except Exception:  # pragma: no cover
        providers = []
    try:
        from ..services.embeddings import EmbeddingModel
        inst = getattr(EmbeddingModel, "_instance", None)
        embedding = getattr(inst, "backend_name", None) if inst else None
    except Exception:  # pragma: no cover
        embedding = None
    try:
        from ..services import email_delivery
        email_provider = email_delivery.provider_name()
        email_ok = email_delivery.email_configured()
    except Exception:  # pragma: no cover
        email_provider, email_ok = "unknown", False
    return {
        "database": {"ok": db_ok, "ping_ms": db_ms, "engine": engine.url.get_backend_name()},
        "uptime_seconds": int(time.time() - _PROCESS_STARTED),
        "started_at": _iso(datetime.utcfromtimestamp(_PROCESS_STARTED)),
        "email": {"provider": email_provider, "configured": email_ok, "sent_7d": sent, "failed_7d": failed,
                  "failure_rate": round(failed * 100 / (sent + failed)) if (sent + failed) else 0},
        "llm_providers": providers,
        "embedding_backend": embedding,
    }


# ── overview (page 23) ────────────────────────────────────────────────────────


def _buckets(start: datetime, end: datetime, gran: str) -> List[Tuple[datetime, datetime, str]]:
    out = []
    if gran == "weekly":
        cur = start - timedelta(days=start.weekday())
        while cur < end and len(out) < 60:
            nxt = cur + timedelta(days=7)
            out.append((cur, nxt, cur.strftime("%d %b")))
            cur = nxt
    else:
        cur = datetime(start.year, start.month, 1)
        multi_year = start.year != (end - timedelta(seconds=1)).year
        while cur < end and len(out) < 40:
            nxt = datetime(cur.year + (cur.month // 12), cur.month % 12 + 1, 1)
            out.append((cur, nxt, cur.strftime("%b %y" if multi_year else "%b")))
            cur = nxt
    return out


def _count_in(dates: Iterable[Optional[datetime]], a: datetime, b: datetime) -> int:
    return sum(1 for d in dates if d and a <= d < b)


def _count_before(dates: Iterable[Optional[datetime]], b: datetime) -> int:
    return sum(1 for d in dates if d and d < b)


def _companies(s: Session, ix: _Index) -> List[dict]:
    """CompanyProfile rows + companies of approved/pending recruiter requests (deduplicated by name)."""
    jobs = s.exec(select(Job)).all()
    app_counts = dict(s.exec(select(Application.job_id, func.count()).group_by(Application.job_id)).all())
    users = s.exec(select(User).where(User.role == "recruiter")).all()
    out: Dict[str, dict] = {}

    def entry(key: str, name: str) -> dict:
        n = _norm_company(name)
        if n in out:
            return out[n]
        out[n] = {"id": key, "name": name, "industry": None, "location": None, "website": None, "size": None,
                  "logo": None, "registered": None, "status": "unverified", "verdict": None, "score": None,
                  "recruiters": set(), "jobs": 0, "open_jobs": 0, "applications": 0, "request_id": None, "profile_id": None}
        return out[n]

    for cp in ix.cp_by_owner.values():
        if not cp.name:
            continue
        e = entry(f"p-{cp.id}", cp.name)
        inds = _jl(cp.industries_json, [])
        e.update(industry=inds[0] if inds else cp.company_type, location=cp.location_text or cp.headquarters,
                 website=cp.website, size=cp.size, logo=cp.logo_path, profile_id=cp.id)
        ru = ix.ru_by_id.get(cp.owner_recruiter_id)
        if ru:
            e["registered"] = ru.created_at
    for r in ix.requests:
        if not r.company_name or r.status == "rejected":
            continue
        e = entry(f"r-{r.id}", r.company_name)
        if r.status == "pending":
            if e["status"] in {"unverified", "rejected"}:
                e.update(status="pending", request_id=r.id, verdict=r.verification_verdict, score=r.verification_score)
        elif r.status == "approved":
            e.update(status="verified" if r.verification_verdict in {"verified", None} else "approved",
                     verdict=r.verification_verdict, score=r.verification_score, request_id=e["request_id"] or r.id)
        if not e["website"]:
            e["website"] = r.company_website
        reg = r.decided_at or r.submitted_at
        if reg and (not e["registered"] or reg < e["registered"]):
            e["registered"] = reg
    for u in users:
        c = ix.company_for_email(u.email)
        if not c:
            continue
        n = _norm_company(c)
        if n in out:
            out[n]["recruiters"].add(u.email)
            if not out[n]["registered"] or (u.created_at and u.created_at < out[n]["registered"]):
                out[n]["registered"] = out[n]["registered"] or u.created_at
    for j in jobs:
        n = _norm_company(ix.company_for_job(j))
        if n in out:
            out[n]["jobs"] += 1
            out[n]["open_jobs"] += 1 if j.status == "open" else 0
            out[n]["applications"] += app_counts.get(j.id, 0)
            if not out[n]["location"] and j.location_text:
                out[n]["location"] = j.location_text
    res = []
    for e in out.values():
        e = dict(e)
        e["recruiter_count"] = len(e.pop("recruiters"))
        res.append(e)
    res.sort(key=lambda e: e["registered"] or datetime.min, reverse=True)
    return res


def _company_public(e: dict) -> dict:
    return {**e, "registered": _iso(e.get("registered"))}


@router.get(f"{P}/overview")
async def overview(start: Optional[str] = None, end: Optional[str] = None, granularity: str = "monthly",
                   admin: str = Depends(get_current_admin)):
    t_start = time.perf_counter()
    if granularity not in {"monthly", "weekly"}:
        raise HTTPException(status_code=400, detail="granularity must be monthly or weekly")
    a, b = _range(start, end)
    span = b - a
    pa = a - span
    with Session(engine) as s:
        ix = _Index(s)
        users = _build_users(s, ix, include_requests=False)
        companies = _companies(s, ix)
        jobs = s.exec(select(Job)).all()
        app_dates = s.exec(select(Application.applied_at)).all()
        offers = s.exec(select(Offer)).all()
        hire_dates = [(o.responded_at or o.updated_at or o.offer_date) for o in offers if o.status in {"accepted", "joined"}]

        user_dates = [u["joined"] for u in users]
        comp_dates = [c["registered"] for c in companies if c["status"] in {"verified", "approved", "unverified"}]
        job_dates = [j.created_at for j in jobs]

        def kpi(dates, value=None):
            cur, prev = _count_in(dates, a, b), _count_in(dates, pa, a)
            return {"value": _count_before(dates, b) if value is None else value, "new": cur, "prev": prev,
                    "change": _pct_change(cur, prev)}

        kpis = {
            "users": kpi(user_dates),
            "companies": kpi(comp_dates),
            "active_jobs": kpi(job_dates, value=sum(1 for j in jobs if j.status == "open")),
            "applications": kpi(app_dates),
            "hires": kpi(hire_dates),
        }

        bks = _buckets(a, b, granularity)
        labels = [x[2] for x in bks]
        cand_dates = [u["joined"] for u in users if u["type"] == "candidate"]
        rec_dates = [u["joined"] for u in users if u["type"] == "recruiter"]
        open_jobs = [j for j in jobs if j.status == "open"]
        growth = {
            "labels": labels,
            "candidates": [_count_before(cand_dates, e) for _, e, _ in bks],
            "recruiters": [_count_before(rec_dates, e) for _, e, _ in bks],
        }
        jobs_trend = {
            "labels": labels,
            "new_jobs": [_count_in(job_dates, s0, e) for s0, e, _ in bks],
            "active_jobs": [_count_before([j.created_at for j in open_jobs], e) for _, e, _ in bks],
        }
        apps_trend = {"labels": labels, "applications": [_count_in(app_dates, s0, e) for s0, e, _ in bks]}

        # users by role
        students = sum(1 for u in users if u["type"] == "candidate" and u["branch"])
        others = sum(1 for u in users if u["type"] == "candidate" and not u["branch"])
        roles = [
            {"label": "Engineering Students", "value": students},
            {"label": "Recruiters", "value": sum(1 for u in users if u["type"] == "recruiter")},
            {"label": "Admins", "value": sum(1 for u in users if u["type"] == "admin")},
            {"label": "Others", "value": others},
        ]

        # top branches
        bc = Counter(u["branch"] for u in users if u["type"] == "candidate" and u["branch"])
        branches = [{"id": bid, "label": lbl, "value": bc.get(bid, 0)} for bid, lbl in CORE_BRANCHES]
        if bc.get("cs") or any(j.branch and "software" in j.branch.lower() for j in jobs):
            branches.insert(0, {"id": "cs", "label": "Computer Science", "value": bc.get("cs", 0)})
        branches.sort(key=lambda x: -x["value"])
        branches.append({"id": "other", "label": "Others", "value": bc.get("other", 0)})

        # top companies by job postings
        jc = Counter(ix.company_for_job(j) for j in jobs)
        top_companies = [{"name": n, "jobs": c, "id": next((e["id"] for e in companies if _norm_company(e["name"]) == _norm_company(n)), None)}
                         for n, c in jc.most_common(8)]

        recent_signups = sorted(users, key=lambda u: u["joined"] or datetime.min, reverse=True)[:5]

        # flags / reports
        flags = []
        for f in s.exec(select(ContentFlag).where(ContentFlag.status == "open").order_by(ContentFlag.created_at.desc()).limit(6)).all():
            flags.append({"kind": "flag", "id": f.id, "title": f.title, "detail": f.detail or f.kind.title(), "severity": f.severity,
                          "at": _iso(f.created_at), "link": "/admin/moderation?tab=flags"})
        for r in ix.requests:
            if r.status == "pending" and r.verification_verdict in {"high_risk", "review"}:
                flags.append({"kind": "recruiter_request", "id": r.id, "title": "High-risk recruiter request" if r.verification_verdict == "high_risk" else "Recruiter request needs review",
                              "detail": f"{r.company_name or r.name} — {r.email}", "severity": "high" if r.verification_verdict == "high_risk" else "medium",
                              "at": _iso(r.submitted_at), "link": "/admin/moderation?tab=requests"})
        for u in users:
            if u["status"] == "suspended":
                flags.append({"kind": "suspended", "id": u["id"], "title": "Suspended account", "detail": f"{u['name']} ({u['type']})",
                              "severity": "low", "at": _iso(u["joined"]), "link": f"/admin/users?tab=suspended"})
        flags.sort(key=lambda f: f["at"] or "", reverse=True)
        open_flag_count = s.exec(select(func.count()).select_from(ContentFlag).where(ContentFlag.status == "open")).one()
        pending_projects = s.exec(select(func.count()).select_from(StudentProject).where(StudentProject.status == "under_review")).one()
        pending_requests = sum(1 for r in ix.requests if r.status == "pending")

        health = _health(s)
    health["overview_ms"] = round((time.perf_counter() - t_start) * 1000, 1)
    return {
        "range": {"start": a.date().isoformat(), "end": (b - timedelta(days=1)).date().isoformat(), "granularity": granularity,
                  "prev_start": pa.date().isoformat(), "prev_end": (a - timedelta(days=1)).date().isoformat()},
        "kpis": kpis,
        "user_growth": growth,
        "jobs_trend": jobs_trend,
        "applications_trend": apps_trend,
        "users_by_role": roles,
        "total_users": len(users),
        "branches": branches,
        "top_companies": top_companies,
        "recent_companies": [_company_public(c) for c in companies[:5]],
        "recent_signups": [_public_user(u) for u in recent_signups],
        "flags": flags[:6],
        "counts": {"open_flags": open_flag_count, "pending_projects": pending_projects, "pending_requests": pending_requests},
        "health": health,
    }


@router.get(f"{P}/system")
async def system_status(admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        return _health(s)


# ── users (page 24) ───────────────────────────────────────────────────────────


@router.get(f"{P}/users")
async def list_users(
    q: Optional[str] = None, tab: str = "all", user_type: Optional[str] = None, verification: Optional[str] = None,
    status: Optional[str] = None, role: Optional[str] = None, joined_from: Optional[str] = None,
    joined_to: Optional[str] = None, branch: Optional[str] = None, college: Optional[str] = None,
    sort: str = "joined_desc", page: int = 1, page_size: int = 10, admin: str = Depends(get_current_admin),
):
    if tab not in TABS:
        raise HTTPException(status_code=400, detail="Unknown tab")
    jf, jt = _parse_day(joined_from, "joined_from"), _parse_day(joined_to, "joined_to")
    with Session(engine) as s:
        ix = _Index(s)
        rows = _build_users(s, ix)
    kpis = _user_kpis(rows)
    branches = sorted({r["branch"] for r in rows if r.get("branch")})
    colleges = sorted({r["college"] for r in rows if r.get("college")})

    def keep(r: dict) -> bool:
        if user_type and r["type"] != user_type:
            return False
        if verification and r["verification"] != verification:
            return False
        if status and r["status"] != status:
            return False
        if role and r["role"] != role:
            return False
        if jf and (not r["joined"] or r["joined"].date() < jf):
            return False
        if jt and (not r["joined"] or r["joined"].date() > jt):
            return False
        if branch and r.get("branch") != branch:
            return False
        if college and college.lower() not in (r.get("college") or "").lower():
            return False
        if q:
            needle = q.strip().lower()[:100]
            hay = " ".join(str(r.get(k) or "") for k in ("name", "email", "org", "college", "dept", "id")).lower()
            if needle not in hay:
                return False
        return True

    filtered = [r for r in rows if keep(r)]
    counts = {t: sum(1 for r in filtered if fn(r)) for t, fn in TABS.items()}
    items = [r for r in filtered if TABS[tab](r)]
    if sort == "joined_asc":
        items.sort(key=lambda r: r["joined"] or datetime.min)
    elif sort == "name_asc":
        items.sort(key=lambda r: (r["name"] or "").lower())
    elif sort == "name_desc":
        items.sort(key=lambda r: (r["name"] or "").lower(), reverse=True)
    else:
        items.sort(key=lambda r: r["joined"] or datetime.min, reverse=True)
    page_items, total = _page(items, page, page_size)
    return {
        "items": [_public_user(r) for r in page_items], "total": total, "page": max(1, page),
        "page_size": max(1, min(MAX_PAGE, page_size)), "counts": counts, "kpis": kpis,
        "facets": {"branches": [{"id": b, "label": BRANCH_LABEL.get(b, b.title())} for b in branches], "colleges": colleges},
    }


def _notes_for(s: Session, kind: str, obj) -> List[dict]:
    if kind == "c":
        notes = s.exec(select(RecruiterNote).where(RecruiterNote.recruiter_id == 0, RecruiterNote.candidate_id == obj.id)
                       .order_by(RecruiterNote.created_at.desc())).all()
        out = []
        for n in notes:
            body = _jl(n.text, None) if n.text.startswith("{") else None
            out.append({"id": n.id, "text": body.get("text") if isinstance(body, dict) else n.text,
                        "by": body.get("by") if isinstance(body, dict) else None, "at": _iso(n.created_at)})
        return out
    if kind == "u":
        st = _jl(obj.settings_json, {})
        notes = st.get("admin_notes", []) if isinstance(st, dict) else []
        return sorted(notes, key=lambda n: n.get("at") or "", reverse=True)
    return []


def _activity(s: Session, row: dict, kind: str, obj) -> List[dict]:
    ev: List[dict] = []

    def add(at, title, detail=None, tone="blue"):
        if at:
            ev.append({"at": _iso(at) if isinstance(at, datetime) else at, "title": title, "detail": detail, "tone": tone})

    add(row["joined"], "Account created" if kind != "r" else "Recruiter access requested", None, "green")
    if row.get("last_login"):
        add(row["last_login"], "Last login", None, "blue")
    if kind == "c":
        if row.get("profile_updated") and row["profile_updated"] != row["joined"]:
            add(row["profile_updated"], "Profile updated", None, "green")
        apps = s.exec(select(Application).where(Application.candidate_id == obj.id).order_by(Application.applied_at.desc()).limit(20)).all()
        jobs = {j.id: j for j in s.exec(select(Job).where(Job.id.in_([a.job_id for a in apps] or [0]))).all()}
        for ap in apps:
            j = jobs.get(ap.job_id)
            add(ap.applied_at, f"Applied to job: {j.title if j else f'#{ap.job_id}'}", f"Status: {ap.status.replace('_', ' ')}", "blue")
        for iv in s.exec(select(ScheduledInterview).where(ScheduledInterview.candidate_id == obj.id).limit(20)).all():
            j = s.get(Job, iv.job_id)
            add(iv.created_at, f"Interview scheduled: {iv.round_name}", f"{j.title if j else ''} · {iv.starts_at.strftime('%d %b %Y, %I:%M %p')} · {iv.status}", "purple")
        for se in s.exec(select(InterviewSession).where(InterviewSession.candidate_id == obj.id).limit(20)).all():
            label = "AI practice interview" if se.mode == "practice" else "AI interview"
            add(se.started_at, f"{label} {se.status}", se.practice_topic or se.practice_kind, "purple")
        for o in s.exec(select(Offer).where(Offer.candidate_id == obj.id).limit(20)).all():
            j = s.get(Job, o.job_id)
            add(o.offer_date, f"Offer {o.status}: {j.title if j else ''}", o.ctc, "green")
        for pr in s.exec(select(StudentProject).where(StudentProject.candidate_id == obj.id).limit(20)).all():
            add(pr.created_at, f"Project added: {pr.title}", f"Status: {pr.status.replace('_', ' ')}", "amber")
    elif kind == "u" and obj.role == "recruiter":
        ru = s.exec(select(RecruiterUser).where(RecruiterUser.username == obj.email)).first()
        if ru:
            for j in s.exec(select(Job).where(Job.recruiter_id == ru.id).order_by(Job.created_at.desc()).limit(15)).all():
                add(j.created_at, f"Posted job: {j.title}", f"Status: {j.status}", "blue")
            for o in s.exec(select(Offer).where(Offer.recruiter_id == ru.id).limit(15)).all():
                add(o.offer_date, f"Sent offer ({o.status})", o.ctc, "green")
    if kind == "u":
        for a in s.exec(select(DecisionAuditLog).where(DecisionAuditLog.event_type == "admin_action", DecisionAuditLog.human_reviewer == obj.email)
                        .order_by(DecisionAuditLog.created_at.desc()).limit(10)).all():
            add(a.created_at, f"Performed admin action: {(a.human_action or '').split(':')[0].replace('_', ' ')}", a.human_action, "amber")
    for a in s.exec(select(DecisionAuditLog).where(DecisionAuditLog.event_type == "admin_action",
                                                   DecisionAuditLog.human_action.like(f"%:{row['id']}"))
                    .order_by(DecisionAuditLog.created_at.desc()).limit(15)).all():
        add(a.created_at, f"Admin: {(a.human_action or '').split(':')[0].replace('_', ' ')}", f"by {a.human_reviewer}", "amber")
    ev.sort(key=lambda e: e["at"] or "", reverse=True)
    return ev[:40]


@router.get(f"{P}/users/{{uid}}")
async def user_detail(uid: str, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        kind, obj = _find_user(s, uid)
        row = _row_for(s, uid)
        out = _public_user(row)
        out["activity"] = _activity(s, row, kind, obj)
        out["notes"] = _notes_for(s, kind, obj)
        out["is_self"] = kind == "u" and obj.email == admin
        if kind == "c":
            p = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == obj.id)).first()
            out["profile"] = None if not p else {
                "headline": p.headline, "bio": p.bio, "skills": _jl(p.skills_json, [])[:30], "degree": p.degree,
                "grad_year": p.grad_year, "current_year": p.current_year, "linkedin_url": p.linkedin_url,
                "github_url": p.github_url, "portfolio_url": p.portfolio_url, "education": _jl(p.education_json, []),
                "experience": _jl(p.experience_json, []), "achievements": _jl(p.achievements_json, []),
                "certifications": [{k: c.get(k) for k in ("name", "issuing_organization", "issue_date")} for c in _jl(p.certifications_json, []) if isinstance(c, dict)],
                "resume": bool(p.resume_id),
            }
            out["stats"] = {
                "applications": s.exec(select(func.count()).select_from(Application).where(Application.candidate_id == obj.id)).one(),
                "projects": s.exec(select(func.count()).select_from(StudentProject).where(StudentProject.candidate_id == obj.id)).one(),
                "interviews": s.exec(select(func.count()).select_from(ScheduledInterview).where(ScheduledInterview.candidate_id == obj.id)).one(),
                "offers": s.exec(select(func.count()).select_from(Offer).where(Offer.candidate_id == obj.id)).one(),
            }
        elif kind == "u":
            ru = s.exec(select(RecruiterUser).where(RecruiterUser.username == obj.email)).first()
            req = s.exec(select(RecruiterRequest).where(RecruiterRequest.email == obj.email).order_by(RecruiterRequest.submitted_at.desc())).first()
            out["profile"] = {"company": row["org"], "department": row["dept"], "designation": req.designation if req else None,
                              "company_website": req.company_website if req else None}
            out["verification_report"] = _jl(req.verification_json, None) if req else None
            out["request"] = {"id": req.id, "status": req.status, "verdict": req.verification_verdict, "score": req.verification_score} if req else None
            jobs = s.exec(select(Job).where(Job.recruiter_id == ru.id)).all() if ru else []
            out["stats"] = {"jobs": len(jobs), "open_jobs": sum(1 for j in jobs if j.status == "open"),
                            "applications": s.exec(select(func.count()).select_from(Application).where(Application.job_id.in_([j.id for j in jobs] or [0]))).one(),
                            "offers": s.exec(select(func.count()).select_from(Offer).where(Offer.recruiter_id == ru.id)).one() if ru else 0}
        else:
            out["profile"] = {"company": obj.company_name, "department": obj.designation, "company_website": obj.company_website}
            out["verification_report"] = _jl(obj.verification_json, None)
            out["request"] = {"id": obj.id, "status": obj.status, "verdict": obj.verification_verdict, "score": obj.verification_score}
            out["stats"] = {}
        return out


class UserUpdate(BaseModel):
    name: Optional[str] = PField(default=None, max_length=120)
    phone: Optional[str] = PField(default=None, max_length=30)
    email: Optional[str] = PField(default=None, max_length=254)


def _clean_phone(phone: Optional[str]) -> Optional[str]:
    if phone is None:
        return None
    phone = phone.strip()
    if phone and not re.fullmatch(r"[+()\-\s0-9]{6,30}", phone):
        raise HTTPException(status_code=422, detail="Phone number can only contain digits, spaces, +, - and brackets")
    return phone or None


def _email_taken(s: Session, email: str, except_user: Optional[int] = None, except_cand: Optional[int] = None) -> bool:
    u = s.exec(select(User).where(User.email == email)).first()
    if u and u.id != except_user:
        return True
    c = s.exec(select(CandidateUser).where(CandidateUser.username == email)).first()
    if c and c.id != except_cand:
        return True
    return False


@router.patch(f"{P}/users/{{uid}}")
async def update_user(uid: str, body: UserUpdate, admin: str = Depends(get_current_admin)):
    name = body.name.strip() if body.name is not None else None
    if name is not None and len(name) < 2:
        raise HTTPException(status_code=422, detail="Name must be at least 2 characters")
    phone = _clean_phone(body.phone) if body.phone is not None else None
    email = body.email.strip().lower() if body.email is not None else None
    if email is not None and not EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    with Session(engine) as s:
        kind, obj = _find_user(s, uid)
        changed = {}
        if kind == "r":
            raise HTTPException(status_code=400, detail="Review this recruiter request in Content Moderation first")
        if kind == "c":
            p = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == obj.id)).first()
            if not p:
                p = CandidateProfile(candidate_id=obj.id)
            urow = s.exec(select(User).where(User.email == obj.username.lower(), User.role == "candidate")).first()
            if name is not None:
                p.full_name = name
                changed["name"] = name
            if body.phone is not None:
                p.contact_phone = phone
                changed["phone"] = phone
            if email is not None:
                current = obj.username if "@" in obj.username else p.contact_email
                if email != (current or "").lower():
                    if _email_taken(s, email, except_user=urow.id if urow else None, except_cand=obj.id):
                        raise HTTPException(status_code=409, detail="Email already registered")
                    if "@" in obj.username:
                        obj.username = email
                        s.add(obj)
                    if urow:
                        urow.email = email
                        s.add(urow)
                    p.contact_email = email
                    changed["email"] = email
            if urow and name:
                urow.name = name
                s.add(urow)
            p.updated_at = utc_now()
            s.add(p)
            s.commit()
            _audit(s, admin, "edit_user", uid, candidate_id=obj.id, details=changed)
        else:
            u: User = obj
            old_email = u.email
            if name is not None:
                u.name = name
                changed["name"] = name
            if body.phone is not None:
                u.phone = phone
                changed["phone"] = phone
            if email is not None and email != u.email:
                if _email_taken(s, email, except_user=u.id):
                    raise HTTPException(status_code=409, detail="Email already registered")
                ru = s.exec(select(RecruiterUser).where(RecruiterUser.username == old_email)).first()
                if ru:
                    ru.username = email
                    s.add(ru)
                for rq in s.exec(select(RecruiterRequest).where(RecruiterRequest.email == old_email)).all():
                    rq.email = email
                    s.add(rq)
                u.email = email
                changed["email"] = email
            s.add(u)
            s.commit()
            _audit(s, admin, "edit_user", uid, details=changed)
        return {"updated": True, "changed": changed, "user": _public_user(_row_for(s, uid))}


class UserAction(BaseModel):
    action: str
    role: Optional[str] = None


def _set_candidate_status(s: Session, c: CandidateUser, status: str) -> None:
    c.status = status
    s.add(c)
    urow = s.exec(select(User).where(User.email == c.username.lower(), User.role == "candidate")).first()
    if urow:
        urow.status = status
        s.add(urow)


async def _reset_password(kind: str, obj, s: Session) -> dict:
    from .auth import _create_email_token, _invalidate_email_tokens, _send_email_or_dev
    from ..services import email_templates
    if kind == "c":
        from .candidate_auth import _recipient
        key = obj.username
        to = _recipient(s, obj)
        if not to:
            raise HTTPException(status_code=400, detail="This student has no email address on file")
        _invalidate_email_tokens(s, key, "candidate_reset")
        token = _create_email_token(s, key, "candidate_reset", ttl_minutes=15)
        purpose = "candidate_reset"
        name = None
    else:
        to = key = obj.email
        _invalidate_email_tokens(s, key, "password_reset")
        token = _create_email_token(s, key, "password_reset", ttl_minutes=15)
        purpose = "password_reset"
        name = obj.name if obj.name and obj.name != obj.email else None
    subject, txt, html = email_templates.password_reset(name, to, token, minutes=15)
    try:
        delivery = await run_in_threadpool(_send_email_or_dev, to, subject, txt, {"reset_token": token, "purpose": purpose}, html, "password_reset")
    except HTTPException as exc:
        if exc.status_code == 502:
            return {"email_sent": False, "to": to, "warning": "Email delivery is not configured"}
        raise
    return {**delivery, "to": to}


async def _do_action(s: Session, admin: str, uid: str, action: str, role: Optional[str] = None) -> dict:
    kind, obj = _find_user(s, uid)
    me = _admin_user(s, admin)
    if kind == "r":
        raise HTTPException(status_code=400, detail="Approve or reject this recruiter request in Content Moderation")
    cand_id = obj.id if kind == "c" else None
    if kind == "u":
        _guard_staff_change(s, me, obj, action)
    if action == "verify":
        if kind == "u":
            obj.email_verified = True
            s.add(obj)
            s.commit()
        _audit(s, admin, "verify_user", uid, candidate_id=cand_id)
        return {"ok": True, "verification": "verified"}
    if action in {"suspend", "reactivate"}:
        new = "suspended" if action == "suspend" else "active"
        if kind == "c":
            _set_candidate_status(s, obj, new)
        else:
            obj.status = new
            s.add(obj)
        s.commit()
        _audit(s, admin, f"{action}_user", uid, candidate_id=cand_id)
        return {"ok": True, "status": new}
    if action == "reset_password":
        res = await _reset_password(kind, obj, s)
        _audit(s, admin, "reset_password", uid, candidate_id=cand_id, details={"email_sent": res.get("email_sent")})
        return {"ok": True, **res}
    if action == "change_role":
        if kind != "u" or obj.role not in {"recruiter", "admin"}:
            raise HTTPException(status_code=400, detail="Only recruiter and admin roles can be changed")
        if role not in {"recruiter", "admin"}:
            raise HTTPException(status_code=422, detail="role must be recruiter or admin")
        if role == obj.role:
            return {"ok": True, "role": role}
        old = obj.role
        obj.role = role
        if role == "recruiter":
            if not s.exec(select(RecruiterUser).where(RecruiterUser.username == obj.email)).first():
                s.add(RecruiterUser(username=obj.email, password_hash=obj.password_hash))
        s.add(obj)
        s.commit()
        _audit(s, admin, "change_role", uid, details={"from": old, "to": role})
        return {"ok": True, "role": role}
    raise HTTPException(status_code=400, detail="Unknown action")


@router.post(f"{P}/users/{{uid}}/actions")
async def user_action(uid: str, body: UserAction, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        return await _do_action(s, admin, uid, body.action, body.role)


def _delete_candidate(s: Session, c: CandidateUser) -> None:
    from ..services.media_utils import delete_media_file
    cid = c.id
    app_ids = list(s.exec(select(Application.id).where(Application.candidate_id == cid)).all())
    # keep the audit trail but detach it from the deleted person
    conds = [DecisionAuditLog.candidate_id == cid]
    if app_ids:
        conds.append(DecisionAuditLog.application_id.in_(app_ids))
    for row in s.exec(select(DecisionAuditLog).where(or_(*conds))).all():
        row.candidate_id = None
        row.application_id = None
        s.add(row)
    s.flush()
    for model in (Offer, ScheduledInterview, InterviewSession):
        s.execute(sa_delete(model).where(model.candidate_id == cid))
        if app_ids:
            s.execute(sa_delete(model).where(model.application_id.in_(app_ids)))
    for model in (SavedJob, StudentProject, Post):
        s.execute(sa_delete(model).where(model.candidate_id == cid))
    s.execute(sa_delete(RecruiterNote).where(RecruiterNote.candidate_id == cid))
    s.execute(sa_delete(Application).where(Application.candidate_id == cid))
    p = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == cid)).first()
    resume_id = None
    if p:
        for path in (p.avatar_path, p.cover_photo_path):
            if path:
                delete_media_file(path)
        for cert in _jl(p.certifications_json, []):
            if isinstance(cert, dict) and cert.get("file_path"):
                delete_media_file(cert["file_path"])
        resume_id = p.resume_id
        s.delete(p)
    s.flush()
    if resume_id:
        still = s.exec(select(func.count()).select_from(CandidateProfile).where(CandidateProfile.resume_id == resume_id)).one() \
            + s.exec(select(func.count()).select_from(Application).where(Application.resume_id == resume_id)).one()
        if not still:
            r = s.get(Resume, resume_id)
            if r:
                try:
                    import os
                    if r.file_path and os.path.isfile(r.file_path):
                        os.remove(r.file_path)
                except OSError:
                    pass
                s.delete(r)
    s.execute(sa_delete(EmailToken).where(EmailToken.email == c.username))
    s.execute(sa_delete(User).where(User.email == c.username.lower(), User.role == "candidate"))
    s.delete(c)
    s.commit()


def _delete_staff(s: Session, u: User) -> None:
    ru = s.exec(select(RecruiterUser).where(RecruiterUser.username == u.email)).first()
    if ru:
        n_jobs = s.exec(select(func.count()).select_from(Job).where(Job.recruiter_id == ru.id)).one()
        if n_jobs:
            raise HTTPException(status_code=409, detail=f"This recruiter owns {n_jobs} job posting(s). Suspend the account instead, or close and remove the jobs first.")
        s.execute(sa_delete(RecruiterPost).where(RecruiterPost.recruiter_id == ru.id))
        s.execute(sa_delete(RecruiterProfile).where(RecruiterProfile.recruiter_id == ru.id))
        s.execute(sa_delete(TeamMember).where(TeamMember.owner_recruiter_id == ru.id))
        s.execute(sa_delete(CompanyProfile).where(CompanyProfile.owner_recruiter_id == ru.id))
        s.flush()
        s.delete(ru)
    s.execute(sa_delete(EmailToken).where(EmailToken.email == u.email))
    s.delete(u)
    s.commit()


def _do_delete(s: Session, admin: str, uid: str) -> dict:
    kind, obj = _find_user(s, uid)
    me = _admin_user(s, admin)
    if kind == "r":
        raise HTTPException(status_code=400, detail="Reject this recruiter request in Content Moderation instead")
    label = obj.username if kind == "c" else obj.email
    if kind == "u":
        _guard_staff_change(s, me, obj, "delete")
        _delete_staff(s, obj)
    else:
        _delete_candidate(s, obj)
    _audit(s, admin, "delete_user", uid, details={"account": label, "type": "candidate" if kind == "c" else obj.role},
           summary="Account and personal data deleted by an administrator")
    return {"deleted": True, "id": uid}


@router.delete(f"{P}/users/{{uid}}")
async def delete_user(uid: str, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        return _do_delete(s, admin, uid)


class BulkBody(BaseModel):
    ids: List[str] = PField(min_length=1, max_length=200)
    action: str
    role: Optional[str] = None
    subject: Optional[str] = PField(default=None, max_length=200)
    body: Optional[str] = PField(default=None, max_length=5000)


def _admin_message_email(name: Optional[str], subject: str, body: str):
    from ..services.email_templates import _e, _greeting, _layout, _p
    paras = [p.strip() for p in body.split("\n\n") if p.strip()]
    html = _layout(subject, subject[:90], _p(_e(_greeting(name))) + "".join(_p(_e(p).replace("\n", "<br>")) for p in paras))
    return subject, f"{_greeting(name)}\n\n{body}\n\n- The CoreLink team", html


@router.post(f"{P}/users/bulk")
async def bulk_users(body: BulkBody, admin: str = Depends(get_current_admin)):
    ids = list(dict.fromkeys(body.ids))
    ok: List[str] = []
    failed: List[dict] = []
    if body.action == "email":
        subject = (body.subject or "").strip()
        text_body = (body.body or "").strip()
        if len(subject) < 3 or len(text_body) < 5:
            raise HTTPException(status_code=422, detail="Subject and message are required")
        from ..services.email_delivery import queue_email
        with Session(engine) as s:
            rows = {r["id"]: r for r in _build_users(s, _Index(s))}
            for uid in ids:
                r = rows.get(uid)
                if not r or not r.get("email"):
                    failed.append({"id": uid, "error": "No email address"})
                    continue
                subj, txt, html = _admin_message_email(r["name"], subject, text_body)
                queue_email(r["email"], subj, txt, html=html, category="admin_message")
                ok.append(uid)
            _audit(s, admin, "bulk_email", f"{len(ok)} users", details={"ids": ok, "subject": subject})
        return {"ok": ok, "failed": failed}
    if body.action not in {"verify", "suspend", "reactivate", "delete", "change_role"}:
        raise HTTPException(status_code=400, detail="Unknown bulk action")
    with Session(engine) as s:
        for uid in ids:
            try:
                if body.action == "delete":
                    _do_delete(s, admin, uid)
                else:
                    await _do_action(s, admin, uid, body.action, body.role)
                ok.append(uid)
            except HTTPException as exc:
                s.rollback()
                failed.append({"id": uid, "error": exc.detail})
    return {"ok": ok, "failed": failed}


class NewUser(BaseModel):
    type: str
    name: str = PField(min_length=2, max_length=120)
    email: str = PField(max_length=254)
    phone: Optional[str] = PField(default=None, max_length=30)
    college: Optional[str] = PField(default=None, max_length=200)
    branch: Optional[str] = PField(default=None, max_length=80)
    company: Optional[str] = PField(default=None, max_length=200)
    designation: Optional[str] = PField(default=None, max_length=120)


def _account_created_email(name: str, email: str, password: str, role: str):
    from ..services.email_templates import _button, _e, _greeting, _kv_table, _layout, _p, app_url
    login = {"candidate": "/candidate/login", "recruiter": "/recruiter/login", "admin": "/admin/login"}[role]
    who = {"candidate": "student", "recruiter": "recruiter", "admin": "administrator"}[role]
    subject = f"Your CoreLink {who} account is ready"
    txt = (f"{_greeting(name)}\n\nA CoreLink administrator created a {who} account for you.\n\nEmail: {email}\n"
           f"Temporary password: {password}\n\nLog in: {app_url(login)}\n"
           "Please change this password after your first login (use \"Forgot password\" on the login page to set your own).\n\n- The CoreLink team")
    html = _layout(
        "Your account is ready", "Your login details are inside",
        _p(_e(_greeting(name))) + _p(f"A CoreLink administrator created a <strong>{who}</strong> account for you.")
        + _kv_table([("Email", _e(email)), ("Temporary password", f'<span style="font-family:\'Courier New\',monospace;font-weight:700;">{_e(password)}</span>')])
        + _button("Log in to CoreLink", app_url(login))
        + _p("For your security, change this password after your first login — or use <em>Forgot password</em> on the login page to set your own."),
    )
    return subject, txt, html


@router.post(f"{P}/users")
async def create_user(body: NewUser, admin: str = Depends(get_current_admin)):
    from .auth import _create_user
    if body.type not in {"candidate", "recruiter", "admin"}:
        raise HTTPException(status_code=422, detail="type must be candidate, recruiter or admin")
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    name = body.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Name must be at least 2 characters")
    phone = _clean_phone(body.phone)
    if body.type == "recruiter" and not (body.company or "").strip():
        raise HTTPException(status_code=422, detail="Company is required for recruiters")
    password = _temp_password()
    with Session(engine) as s:
        if _email_taken(s, email):
            raise HTTPException(status_code=409, detail="Email already registered")
        if body.type == "candidate":
            c = CandidateUser(username=email, password_hash=hash_password(password), status="active")
            s.add(c)
            s.commit()
            s.refresh(c)
            s.add(CandidateProfile(candidate_id=c.id, full_name=name, contact_email=email, contact_phone=phone,
                                   college=(body.college or "").strip() or None, branch=(body.branch or "").strip() or None))
            s.commit()
            uid = f"c-{c.id}"
            cand_id = c.id
        else:
            u = _create_user(s, name=name, email=email, password=password, role=body.type, phone=phone, email_verified=True)
            if body.type == "recruiter":
                ru = s.exec(select(RecruiterUser).where(RecruiterUser.username == email)).first()
                if ru and not s.exec(select(RecruiterProfile).where(RecruiterProfile.recruiter_id == ru.id)).first():
                    s.add(RecruiterProfile(recruiter_id=ru.id, company_name=body.company.strip(), headline=(body.designation or "").strip()))
                    s.commit()
            uid = f"u-{u.id}"
            cand_id = None
        _audit(s, admin, "create_user", uid, candidate_id=cand_id, details={"type": body.type, "email": email})
        user = _public_user(_row_for(s, uid))
    from .auth import _send_email_or_dev
    subject, txt, html = _account_created_email(name, email, password, body.type)
    try:
        delivery = await run_in_threadpool(_send_email_or_dev, email, subject, txt, {"temporary_password": password}, html, "admin_account_created")
    except HTTPException:
        delivery = {"email_sent": False, "warning": "Account created but the email could not be delivered."}
    res = {"created": True, "user": user, **{k: v for k, v in delivery.items() if k != "dev_only"}}
    if _dev_mode():
        res["temporary_password"] = password
    return res


class NoteBody(BaseModel):
    text: str = PField(min_length=1, max_length=2000)


@router.post(f"{P}/users/{{uid}}/notes")
async def add_note(uid: str, body: NoteBody, admin: str = Depends(get_current_admin)):
    txt = body.text.strip()
    if not txt:
        raise HTTPException(status_code=422, detail="Note cannot be empty")
    with Session(engine) as s:
        kind, obj = _find_user(s, uid)
        if kind == "c":
            s.add(RecruiterNote(recruiter_id=0, candidate_id=obj.id, text=json.dumps({"text": txt, "by": admin})))
        elif kind == "u":
            st = _jl(obj.settings_json, {})
            st = st if isinstance(st, dict) else {}
            notes = st.get("admin_notes", [])
            notes.append({"id": secrets.token_hex(6), "text": txt, "by": admin, "at": _iso(utc_now())})
            st["admin_notes"] = notes[-100:]
            obj.settings_json = json.dumps(st)
            s.add(obj)
        else:
            raise HTTPException(status_code=400, detail="Notes are available once the account exists")
        s.commit()
        _audit(s, admin, "add_note", uid, candidate_id=obj.id if kind == "c" else None)
        return {"notes": _notes_for(s, kind, obj)}


@router.delete(f"{P}/users/{{uid}}/notes/{{note_id}}")
async def delete_note(uid: str, note_id: str, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        kind, obj = _find_user(s, uid)
        if kind == "c":
            n = s.get(RecruiterNote, int(note_id)) if note_id.isdigit() else None
            if not n or n.recruiter_id != 0 or n.candidate_id != obj.id:
                raise HTTPException(status_code=404, detail="Note not found")
            s.delete(n)
        elif kind == "u":
            st = _jl(obj.settings_json, {})
            notes = st.get("admin_notes", []) if isinstance(st, dict) else []
            keep = [n for n in notes if n.get("id") != note_id]
            if len(keep) == len(notes):
                raise HTTPException(status_code=404, detail="Note not found")
            st["admin_notes"] = keep
            obj.settings_json = json.dumps(st)
            s.add(obj)
        else:
            raise HTTPException(status_code=404, detail="Note not found")
        s.commit()
        return {"notes": _notes_for(s, kind, obj)}


# ── companies ─────────────────────────────────────────────────────────────────


@router.get(f"{P}/companies")
async def list_companies(q: Optional[str] = None, status: Optional[str] = None, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        rows = _companies(s, _Index(s))
    kpis = {"total": len(rows), "verified": sum(1 for r in rows if r["status"] in {"verified", "approved"}),
            "pending": sum(1 for r in rows if r["status"] == "pending"), "jobs": sum(r["jobs"] for r in rows),
            "recruiters": sum(r["recruiter_count"] for r in rows), "applications": sum(r["applications"] for r in rows)}
    if status:
        rows = [r for r in rows if r["status"] == status]
    if q:
        n = q.lower().strip()
        rows = [r for r in rows if n in (r["name"] or "").lower() or n in (r["industry"] or "").lower() or n in (r["location"] or "").lower()]
    return {"items": [_company_public(r) for r in rows[:500]], "total": len(rows), "kpis": kpis}


@router.get(f"{P}/companies/{{cid}}")
async def company_detail(cid: str, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        ix = _Index(s)
        rows = _companies(s, ix)
        c = next((r for r in rows if r["id"] == cid), None)
        if not c:
            raise HTTPException(status_code=404, detail="Company not found")
        key = _norm_company(c["name"])
        profile = None
        if c.get("profile_id"):
            cp = s.get(CompanyProfile, c["profile_id"])
            if cp:
                profile = {"tagline": cp.tagline, "about": cp.about, "headquarters": cp.headquarters, "website": cp.website,
                           "linkedin": cp.linkedin, "legal_name": cp.legal_name, "company_type": cp.company_type, "size": cp.size,
                           "founded": cp.founded, "industries": _jl(cp.industries_json, []), "locations": _jl(cp.locations_json, []),
                           "hiring_focus": _jl(cp.hiring_focus_json, []), "logo": cp.logo_path}
        recruiters = []
        for u in s.exec(select(User).where(User.role == "recruiter")).all():
            if _norm_company(ix.company_for_email(u.email)) == key:
                recruiters.append({"id": f"u-{u.id}", "name": u.name, "email": u.email, "status": u.status or "active",
                                   "joined": _iso(u.created_at)})
        jobs = []
        app_counts = dict(s.exec(select(Application.job_id, func.count()).group_by(Application.job_id)).all())
        for j in s.exec(select(Job).order_by(Job.created_at.desc())).all():
            if _norm_company(ix.company_for_job(j)) == key:
                jobs.append({"id": j.id, "title": j.title, "status": j.status, "branch": branch_label(j.branch), "location": j.location_text,
                             "applications": app_counts.get(j.id, 0), "created_at": _iso(j.created_at)})
        reqs = [{"id": r.id, "name": r.name, "email": r.email, "status": r.status, "verdict": r.verification_verdict,
                 "score": r.verification_score, "submitted_at": _iso(r.submitted_at), "verification": _jl(r.verification_json, None),
                 "gstin": r.gstin, "cin": r.cin, "website": r.company_website}
                for r in ix.requests if _norm_company(r.company_name) == key]
        return {**_company_public(c), "profile": profile, "recruiters": recruiters, "jobs": jobs[:100], "requests": reqs}


# ── jobs ──────────────────────────────────────────────────────────────────────


@router.get(f"{P}/jobs")
async def list_jobs(q: Optional[str] = None, status: Optional[str] = None, branch: Optional[str] = None,
                    company: Optional[str] = None, page: int = 1, page_size: int = 10, export: bool = False,
                    admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        ix = _Index(s)
        jobs = s.exec(select(Job).order_by(Job.created_at.desc())).all()
        app_counts = dict(s.exec(select(Application.job_id, func.count()).group_by(Application.job_id)).all())
        flagged = {f.target_id for f in s.exec(select(ContentFlag).where(ContentFlag.kind == "job", ContentFlag.status == "open")).all()}
        rows = []
        for j in jobs:
            ru = ix.ru_by_id.get(j.recruiter_id)
            rows.append({"id": j.id, "title": j.title, "company": ix.company_for_job(j), "recruiter": ru.username if ru else None,
                         "branch": branch_id(j.branch), "branch_label": branch_label(j.branch), "location": j.location_text,
                         "status": j.status, "job_type": j.job_type, "remote_type": j.remote_type, "openings": j.openings,
                         "salary_min": j.salary_min, "salary_max": j.salary_max, "currency": j.currency,
                         "applications": app_counts.get(j.id, 0), "flagged": j.id in flagged,
                         "created_at": _iso(j.created_at), "updated_at": _iso(j.updated_at)})
    kpis = {"total": len(rows), "open": sum(1 for r in rows if r["status"] == "open"), "closed": sum(1 for r in rows if r["status"] == "closed"),
            "paused": sum(1 for r in rows if r["status"] in {"paused", "draft"}), "flagged": sum(1 for r in rows if r["flagged"]),
            "applications": sum(r["applications"] for r in rows)}
    companies = sorted({r["company"] for r in rows})
    if status:
        rows = [r for r in rows if r["status"] == status]
    if branch:
        rows = [r for r in rows if r["branch"] == branch]
    if company:
        rows = [r for r in rows if r["company"] == company]
    if q:
        n = q.lower().strip()
        rows = [r for r in rows if n in r["title"].lower() or n in r["company"].lower() or n in (r["location"] or "").lower()]
    if export:
        return {"items": rows[:MAX_EXPORT], "total": len(rows), "kpis": kpis}
    items, total = _page(rows, page, page_size)
    return {"items": items, "total": total, "kpis": kpis, "facets": {"companies": companies}}


@router.get(f"{P}/jobs/{{job_id}}")
async def job_detail(job_id: int, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        ix = _Index(s)
        j = s.get(Job, job_id)
        if not j:
            raise HTTPException(status_code=404, detail="Job not found")
        ru = ix.ru_by_id.get(j.recruiter_id)
        apps = s.exec(select(Application).where(Application.job_id == j.id)).all()
        flags = s.exec(select(ContentFlag).where(ContentFlag.kind == "job", ContentFlag.target_id == j.id)).all()
        return {"id": j.id, "title": j.title, "company": ix.company_for_job(j), "recruiter": ru.username if ru else None,
                "description": j.description, "requirements": j.requirements, "eligibility": j.eligibility,
                "branch_label": branch_label(j.branch), "location": j.location_text, "status": j.status, "job_type": j.job_type,
                "experience_level": j.experience_level, "remote_type": j.remote_type, "openings": j.openings,
                "salary_min": j.salary_min, "salary_max": j.salary_max, "currency": j.currency, "created_at": _iso(j.created_at),
                "applications": len(apps), "status_counts": dict(Counter(a.status for a in apps)),
                "flags": [{"id": f.id, "title": f.title, "status": f.status, "severity": f.severity, "at": _iso(f.created_at)} for f in flags]}


class JobStatusBody(BaseModel):
    status: str


@router.post(f"{P}/jobs/{{job_id}}/status")
async def set_job_status(job_id: int, body: JobStatusBody, admin: str = Depends(get_current_admin)):
    if body.status not in {"open", "closed"}:
        raise HTTPException(status_code=422, detail="status must be open or closed")
    with Session(engine) as s:
        j = s.get(Job, job_id)
        if not j:
            raise HTTPException(status_code=404, detail="Job not found")
        old = j.status
        j.status = body.status
        j.updated_at = utc_now()
        s.add(j)
        s.commit()
        _audit(s, admin, "close_job" if body.status == "closed" else "reopen_job", f"job-{job_id}", job_id=job_id,
               details={"from": old, "to": body.status})
        return {"id": job_id, "status": body.status}


class FlagBody(BaseModel):
    kind: str = "other"
    target_id: Optional[int] = None
    title: str = PField(min_length=3, max_length=200)
    detail: Optional[str] = PField(default=None, max_length=2000)
    severity: str = "medium"


def _flag_public(f: ContentFlag) -> dict:
    return {"id": f.id, "kind": f.kind, "target_id": f.target_id, "title": f.title, "detail": f.detail, "severity": f.severity,
            "status": f.status, "reported_by": f.reported_by, "created_at": _iso(f.created_at), "resolved_at": _iso(f.resolved_at)}


def _create_flag(s: Session, admin: str, body: FlagBody) -> ContentFlag:
    if body.kind not in {"job", "profile", "company", "application", "other"}:
        raise HTTPException(status_code=422, detail="Unknown flag kind")
    if body.severity not in {"low", "medium", "high"}:
        raise HTTPException(status_code=422, detail="severity must be low, medium or high")
    f = ContentFlag(kind=body.kind, target_id=body.target_id, title=body.title.strip(), detail=(body.detail or "").strip() or None,
                    severity=body.severity, reported_by=admin)
    s.add(f)
    s.commit()
    s.refresh(f)
    _audit(s, admin, "create_flag", f"flag-{f.id}", job_id=body.target_id if body.kind == "job" else None, details={"kind": body.kind, "title": f.title})
    return f


class JobFlagBody(BaseModel):
    reason: str = PField(min_length=3, max_length=500)
    severity: str = "medium"


@router.post(f"{P}/jobs/{{job_id}}/flag")
async def flag_job(job_id: int, body: JobFlagBody, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        j = s.get(Job, job_id)
        if not j:
            raise HTTPException(status_code=404, detail="Job not found")
        f = _create_flag(s, admin, FlagBody(kind="job", target_id=job_id, title=f"Job flagged: {j.title}"[:200], detail=body.reason, severity=body.severity))
        return _flag_public(f)


# ── flags (moderation) ────────────────────────────────────────────────────────


@router.get(f"{P}/flags")
async def list_flags(status: Optional[str] = None, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        stmt = select(ContentFlag).order_by(ContentFlag.created_at.desc()).limit(500)
        if status:
            stmt = stmt.where(ContentFlag.status == status)
        rows = s.exec(stmt).all()
        counts = dict(s.exec(select(ContentFlag.status, func.count()).group_by(ContentFlag.status)).all())
        return {"items": [_flag_public(f) for f in rows], "counts": counts}


@router.post(f"{P}/flags")
async def create_flag(body: FlagBody, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        return _flag_public(_create_flag(s, admin, body))


class FlagUpdate(BaseModel):
    status: str
    note: Optional[str] = PField(default=None, max_length=1000)


@router.post(f"{P}/flags/{{flag_id}}")
async def update_flag(flag_id: int, body: FlagUpdate, admin: str = Depends(get_current_admin)):
    if body.status not in {"open", "resolved", "dismissed"}:
        raise HTTPException(status_code=422, detail="status must be open, resolved or dismissed")
    with Session(engine) as s:
        f = s.get(ContentFlag, flag_id)
        if not f:
            raise HTTPException(status_code=404, detail="Flag not found")
        f.status = body.status
        f.resolved_at = None if body.status == "open" else utc_now()
        s.add(f)
        s.commit()
        s.refresh(f)
        _audit(s, admin, f"{body.status}_flag" if body.status != "open" else "reopen_flag", f"flag-{flag_id}", details={"note": body.note})
        return _flag_public(f)


# ── recruiter requests history (moderation) ───────────────────────────────────


@router.get(f"{P}/recruiter-requests")
async def recruiter_requests_history(status: str = "decided", admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        stmt = select(RecruiterRequest).order_by(RecruiterRequest.submitted_at.desc()).limit(100)
        if status == "decided":
            stmt = stmt.where(RecruiterRequest.status != "pending")
        elif status in {"pending", "approved", "rejected"}:
            stmt = stmt.where(RecruiterRequest.status == status)
        rows = s.exec(stmt).all()
        return {"items": [{"id": r.id, "name": r.name, "email": r.email, "company_name": r.company_name, "status": r.status,
                           "verdict": r.verification_verdict, "score": r.verification_score, "submitted_at": _iso(r.submitted_at),
                           "decided_at": _iso(r.decided_at)} for r in rows]}


# ── student projects verification ─────────────────────────────────────────────


@router.get(f"{P}/projects")
async def list_projects(status: str = "under_review", admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        stmt = select(StudentProject).order_by(StudentProject.updated_at.desc()).limit(300)
        if status != "all":
            stmt = stmt.where(StudentProject.status == status)
        rows = s.exec(stmt).all()
        profiles = {p.candidate_id: p for p in s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id.in_([r.candidate_id for r in rows] or [0]))).all()}
        cands = {c.id: c for c in s.exec(select(CandidateUser).where(CandidateUser.id.in_([r.candidate_id for r in rows] or [0]))).all()}
        counts = dict(s.exec(select(StudentProject.status, func.count()).group_by(StudentProject.status)).all())
        out = []
        for r in rows:
            p = profiles.get(r.candidate_id)
            c = cands.get(r.candidate_id)
            out.append({"id": r.id, "title": r.title, "description": r.description, "category": r.category,
                        "tags": _jl(r.tags_json, []), "tools": _jl(r.tools_json, []), "links": _jl(r.links_json, []),
                        "image": r.image_path, "file": r.file_path, "status": r.status, "note": r.verification_note,
                        "team_size": r.team_size, "month": r.month, "created_at": _iso(r.created_at), "updated_at": _iso(r.updated_at),
                        "candidate": {"id": f"c-{r.candidate_id}", "name": (p.full_name if p and p.full_name else (c.username if c else "Student")),
                                      "college": p.college if p else None, "branch": branch_id(p.branch) if p else None,
                                      "branch_label": branch_label(p.branch) if p else None}})
        return {"items": out, "counts": counts}


class ProjectDecision(BaseModel):
    note: Optional[str] = PField(default=None, max_length=1000)


def _project_email(name: Optional[str], title: str, verified: bool, note: Optional[str]):
    from ..services.email_templates import _button, _e, _greeting, _layout, _p, app_url
    head = "Your project is verified" if verified else "Your project needs changes"
    line = (f"Good news — your project “{title}” has been verified by the CoreLink team. It now shows a Verified badge to recruiters."
            if verified else f"Your project “{title}” could not be verified yet.")
    parts = [line] + ([f"Reviewer note: {note}"] if note else []) + ([] if verified else ["Update the project details or attachments and submit it for review again."])
    txt = f"{_greeting(name)}\n\n" + "\n\n".join(parts) + f"\n\nOpen your projects: {app_url('/candidate/projects')}\n\n- The CoreLink team"
    html = _layout(head, head, _p(_e(_greeting(name))) + "".join(_p(_e(x)) for x in parts) + _button("Open my projects", app_url("/candidate/projects")))
    return f"{head}: {title}"[:200], txt, html


async def _decide_project(project_id: int, verified: bool, note: Optional[str], admin: str) -> dict:
    from ..services.email_delivery import queue_email
    note = (note or "").strip() or None
    if not verified and not note:
        raise HTTPException(status_code=422, detail="Add a note explaining what needs to change")
    with Session(engine) as s:
        pr = s.get(StudentProject, project_id)
        if not pr:
            raise HTTPException(status_code=404, detail="Project not found")
        pr.status = "verified" if verified else "rejected"
        pr.verification_note = note
        pr.updated_at = utc_now()
        s.add(pr)
        s.commit()
        c = s.get(CandidateUser, pr.candidate_id)
        p = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == pr.candidate_id)).first()
        to = (c.username if c and "@" in c.username else None) or (p.contact_email if p else None)
        name = p.full_name if p else None
        title = pr.title
        _audit(s, admin, "verify_project" if verified else "reject_project", f"project-{project_id}", candidate_id=pr.candidate_id, details={"note": note})
    if to:
        subj, txt, html = _project_email(name, title, verified, note)
        queue_email(to, subj, txt, html=html, category="project_verification")
    return {"id": project_id, "status": "verified" if verified else "rejected", "emailed": bool(to)}


@router.post(f"{P}/projects/{{project_id}}/verify")
async def verify_project(project_id: int, body: ProjectDecision, admin: str = Depends(get_current_admin)):
    return await _decide_project(project_id, True, body.note, admin)


@router.post(f"{P}/projects/{{project_id}}/reject")
async def reject_project(project_id: int, body: ProjectDecision, admin: str = Depends(get_current_admin)):
    return await _decide_project(project_id, False, body.note, admin)


# ── applications / interviews / offers (read-only) ───────────────────────────


def _people(s: Session, cand_ids: Iterable[int]) -> Dict[int, dict]:
    ids = list(set(cand_ids)) or [0]
    profiles = {p.candidate_id: p for p in s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id.in_(ids))).all()}
    out = {}
    for c in s.exec(select(CandidateUser).where(CandidateUser.id.in_(ids))).all():
        p = profiles.get(c.id)
        out[c.id] = {"id": f"c-{c.id}", "name": (p.full_name if p and p.full_name else c.username.split("@")[0]),
                     "email": c.username if "@" in c.username else (p.contact_email if p else None),
                     "college": p.college if p else None, "branch": branch_label(p.branch) if p else None}
    return out


@router.get(f"{P}/applications")
async def list_applications(q: Optional[str] = None, status: Optional[str] = None, company: Optional[str] = None,
                            start: Optional[str] = None, end: Optional[str] = None, page: int = 1, page_size: int = 10,
                            export: bool = False, admin: str = Depends(get_current_admin)):
    sd, ed = _parse_day(start, "start"), _parse_day(end, "end")
    with Session(engine) as s:
        ix = _Index(s)
        apps = s.exec(select(Application).order_by(Application.applied_at.desc()).limit(20000)).all()
        jobs = {j.id: j for j in s.exec(select(Job)).all()}
        people = _people(s, (a.candidate_id for a in apps))
        rows = []
        for a in apps:
            j = jobs.get(a.job_id)
            pe = people.get(a.candidate_id, {"id": f"c-{a.candidate_id}", "name": "Deleted user", "email": None, "college": None, "branch": None})
            rows.append({"id": a.id, "candidate": pe, "job_id": a.job_id, "job": j.title if j else f"#{a.job_id}",
                         "company": ix.company_for_job(j) if j else "—", "status": a.status, "candidate_status": a.candidate_status,
                         "ats_score": a.ats_score, "final_score": a.final_score, "interview_status": a.interview_status,
                         "interview_score": a.interview_eval_score, "applied_at": _iso(a.applied_at), "_d": a.applied_at})
    kpis = {"total": len(rows), "in_review": sum(1 for r in rows if r["status"] in {"ats_check", "repo_verification"}),
            "interview": sum(1 for r in rows if r["status"] == "automated_interview"),
            "shortlisted": sum(1 for r in rows if r["status"] == "shortlisted"), "rejected": sum(1 for r in rows if r["status"] == "rejected")}
    statuses = sorted({r["status"] for r in rows})
    companies = sorted({r["company"] for r in rows})
    if status:
        rows = [r for r in rows if r["status"] == status]
    if company:
        rows = [r for r in rows if r["company"] == company]
    if sd:
        rows = [r for r in rows if r["_d"] and r["_d"].date() >= sd]
    if ed:
        rows = [r for r in rows if r["_d"] and r["_d"].date() <= ed]
    if q:
        n = q.lower().strip()
        rows = [r for r in rows if n in r["candidate"]["name"].lower() or n in r["job"].lower() or n in r["company"].lower()
                or n in (r["candidate"]["email"] or "").lower()]
    for r in rows:
        r.pop("_d", None)
    if export:
        return {"items": rows[:MAX_EXPORT], "total": len(rows), "kpis": kpis}
    items, total = _page(rows, page, page_size)
    return {"items": items, "total": total, "kpis": kpis, "facets": {"statuses": statuses, "companies": companies}}


@router.get(f"{P}/interviews")
async def list_interviews(kind: Optional[str] = None, status: Optional[str] = None, q: Optional[str] = None,
                          page: int = 1, page_size: int = 10, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        ix = _Index(s)
        jobs = {j.id: j for j in s.exec(select(Job)).all()}
        sched = s.exec(select(ScheduledInterview).order_by(ScheduledInterview.starts_at.desc()).limit(5000)).all()
        ai = [x for x in s.exec(select(InterviewSession).order_by(InterviewSession.started_at.desc()).limit(5000)).all()
              if (x.mode or "application") == "application" and x.application_id]
        people = _people(s, [x.candidate_id for x in sched] + [x.candidate_id for x in ai])
        rows = []
        for iv in sched:
            j = jobs.get(iv.job_id)
            fb = _jl(iv.feedback_json, {})
            rows.append({"id": f"s-{iv.id}", "kind": "scheduled", "title": iv.round_name, "candidate": people.get(iv.candidate_id, {"name": "Deleted user"}),
                         "job": j.title if j else "—", "company": ix.company_for_job(j) if j else "—", "at": _iso(iv.starts_at),
                         "duration_min": iv.duration_min, "mode": iv.mode, "interviewers": iv.interviewers, "status": iv.status,
                         "rating": fb.get("rating") if isinstance(fb, dict) else None, "recommendation": fb.get("recommendation") if isinstance(fb, dict) else None})
        for x in ai:
            j = jobs.get(x.job_id) if x.job_id else None
            ev = _jl(x.eval_json, {})
            score = ev.get("overall_score") or ev.get("score") if isinstance(ev, dict) else None
            rows.append({"id": f"a-{x.id}", "kind": "ai", "title": "AI interview", "candidate": people.get(x.candidate_id, {"name": "Deleted user"}),
                         "job": j.title if j else "—", "company": ix.company_for_job(j) if j else "—", "at": _iso(x.started_at),
                         "duration_min": round((x.completed_at - x.started_at).total_seconds() / 60) if x.completed_at else None,
                         "mode": "online", "interviewers": "CoreLink AI", "status": x.status, "rating": score, "recommendation": ev.get("recommendation") if isinstance(ev, dict) else None})
    rows.sort(key=lambda r: r["at"] or "", reverse=True)
    now = _iso(utc_now())
    kpis = {"total": len(rows), "upcoming": sum(1 for r in rows if r["kind"] == "scheduled" and r["status"] == "scheduled" and (r["at"] or "") >= now),
            "completed": sum(1 for r in rows if r["status"] == "completed"), "ai": sum(1 for r in rows if r["kind"] == "ai"),
            "cancelled": sum(1 for r in rows if r["status"] in {"cancelled", "no_show", "abandoned"})}
    statuses = sorted({r["status"] for r in rows})
    if kind:
        rows = [r for r in rows if r["kind"] == kind]
    if status:
        rows = [r for r in rows if r["status"] == status]
    if q:
        n = q.lower().strip()
        rows = [r for r in rows if n in (r["candidate"].get("name") or "").lower() or n in r["job"].lower() or n in r["company"].lower()]
    items, total = _page(rows, page, page_size)
    return {"items": items, "total": total, "kpis": kpis, "facets": {"statuses": statuses}}


@router.get(f"{P}/offers")
async def list_offers(status: Optional[str] = None, q: Optional[str] = None, page: int = 1, page_size: int = 10,
                      export: bool = False, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        ix = _Index(s)
        jobs = {j.id: j for j in s.exec(select(Job)).all()}
        offers = s.exec(select(Offer).order_by(Offer.offer_date.desc()).limit(20000)).all()
        people = _people(s, (o.candidate_id for o in offers))
        rows = []
        for o in offers:
            j = jobs.get(o.job_id)
            rows.append({"id": o.id, "candidate": people.get(o.candidate_id, {"name": "Deleted user"}), "job": j.title if j else "—",
                         "company": ix.company_for_job(j) if j else "—", "ctc": o.ctc, "ctc_amount": o.ctc_amount, "status": o.status,
                         "offer_date": _iso(o.offer_date), "joining_date": o.joining_date, "responded_at": _iso(o.responded_at)})
    amounts = [r["ctc_amount"] for r in rows if r["ctc_amount"]]
    kpis = {"total": len(rows), "accepted": sum(1 for r in rows if r["status"] in {"accepted", "joined"}),
            "pending": sum(1 for r in rows if r["status"] in {"sent", "negotiation"}),
            "declined": sum(1 for r in rows if r["status"] in {"declined", "withdrawn"}),
            "joined": sum(1 for r in rows if r["status"] == "joined"),
            "avg_ctc": round(sum(amounts) / len(amounts), 2) if amounts else None}
    if status:
        rows = [r for r in rows if r["status"] == status]
    if q:
        n = q.lower().strip()
        rows = [r for r in rows if n in (r["candidate"].get("name") or "").lower() or n in r["job"].lower() or n in r["company"].lower()]
    if export:
        return {"items": rows[:MAX_EXPORT], "total": len(rows), "kpis": kpis}
    items, total = _page(rows, page, page_size)
    return {"items": items, "total": total, "kpis": kpis}


# ── reports (CSV data) ────────────────────────────────────────────────────────

REPORT_KINDS = {"users", "companies", "jobs", "applications", "hires"}


@router.get(f"{P}/reports/{{kind}}")
async def report(kind: str, start: Optional[str] = None, end: Optional[str] = None, admin: str = Depends(get_current_admin)):
    if kind not in REPORT_KINDS:
        raise HTTPException(status_code=404, detail="Unknown report")
    a, b = _range(start, end)
    inr = lambda d: d is not None and a <= d < b  # noqa: E731
    with Session(engine) as s:
        ix = _Index(s)
        if kind == "users":
            cols = ["id", "name", "email", "type", "college_or_company", "branch_or_department", "verification", "status", "joined", "last_login"]
            rows = [{"id": r["id"], "name": r["name"], "email": r["email"], "type": r["type"], "college_or_company": r["org"],
                     "branch_or_department": r["dept"], "verification": r["verification"], "status": r["status"],
                     "joined": _iso(r["joined"]), "last_login": _iso(r["last_login"])}
                    for r in _build_users(s, ix, include_requests=False) if inr(r["joined"])]
        elif kind == "companies":
            cols = ["name", "industry", "location", "status", "recruiters", "jobs", "open_jobs", "applications", "registered"]
            rows = [{"name": c["name"], "industry": c["industry"], "location": c["location"], "status": c["status"],
                     "recruiters": c["recruiter_count"], "jobs": c["jobs"], "open_jobs": c["open_jobs"], "applications": c["applications"],
                     "registered": _iso(c["registered"])} for c in _companies(s, ix) if inr(c["registered"])]
        elif kind == "jobs":
            cols = ["id", "title", "company", "branch", "location", "status", "job_type", "openings", "applications", "created_at"]
            app_counts = dict(s.exec(select(Application.job_id, func.count()).group_by(Application.job_id)).all())
            rows = [{"id": j.id, "title": j.title, "company": ix.company_for_job(j), "branch": branch_label(j.branch), "location": j.location_text,
                     "status": j.status, "job_type": j.job_type, "openings": j.openings, "applications": app_counts.get(j.id, 0),
                     "created_at": _iso(j.created_at)} for j in s.exec(select(Job)).all() if inr(j.created_at)]
        elif kind == "applications":
            cols = ["id", "candidate", "email", "job", "company", "status", "ats_score", "final_score", "applied_at"]
            apps = [x for x in s.exec(select(Application)).all() if inr(x.applied_at)]
            jobs = {j.id: j for j in s.exec(select(Job)).all()}
            people = _people(s, (x.candidate_id for x in apps))
            rows = []
            for x in apps:
                j = jobs.get(x.job_id)
                pe = people.get(x.candidate_id, {})
                rows.append({"id": x.id, "candidate": pe.get("name"), "email": pe.get("email"), "job": j.title if j else None,
                             "company": ix.company_for_job(j) if j else None, "status": x.status, "ats_score": x.ats_score,
                             "final_score": x.final_score, "applied_at": _iso(x.applied_at)})
        else:
            cols = ["offer_id", "candidate", "email", "job", "company", "ctc", "status", "offer_date", "joining_date", "responded_at"]
            offers = [o for o in s.exec(select(Offer)).all() if o.status in {"accepted", "joined"} and inr(o.responded_at or o.updated_at or o.offer_date)]
            jobs = {j.id: j for j in s.exec(select(Job)).all()}
            people = _people(s, (o.candidate_id for o in offers))
            rows = []
            for o in offers:
                j = jobs.get(o.job_id)
                pe = people.get(o.candidate_id, {})
                rows.append({"offer_id": o.id, "candidate": pe.get("name"), "email": pe.get("email"), "job": j.title if j else None,
                             "company": ix.company_for_job(j) if j else None, "ctc": o.ctc, "status": o.status, "offer_date": _iso(o.offer_date),
                             "joining_date": o.joining_date, "responded_at": _iso(o.responded_at)})
        _audit(s, admin, "export_report", kind, details={"start": a.date().isoformat(), "end": (b - timedelta(days=1)).date().isoformat(), "rows": len(rows)})
    return {"kind": kind, "columns": cols, "rows": rows[:MAX_EXPORT], "total": len(rows),
            "range": {"start": a.date().isoformat(), "end": (b - timedelta(days=1)).date().isoformat()}}


# ── audit logs ────────────────────────────────────────────────────────────────


def _audit_public(r: DecisionAuditLog, jobs: Dict[int, str], people: Dict[int, dict], full: bool = False) -> dict:
    out = {"id": r.id, "event_type": r.event_type, "created_at": _iso(r.created_at), "application_id": r.application_id,
           "candidate_id": r.candidate_id, "candidate": people.get(r.candidate_id, {}).get("name") if r.candidate_id else None,
           "job_id": r.job_id, "job": jobs.get(r.job_id) if r.job_id else None, "human_reviewer": r.human_reviewer,
           "human_action": r.human_action, "final_recommendation": r.final_recommendation, "ats_score": r.ats_score,
           "final_score": r.final_score, "risk_level": r.risk_level}
    if full:
        out.update({"baseline_ats_score": r.baseline_ats_score, "semantic_similarity": r.semantic_similarity,
                    "keyword_coverage": r.keyword_coverage, "matched_skills": _jl(r.matched_skills_json, []),
                    "missing_skills": _jl(r.missing_skills_json, []), "project_score": r.project_score, "risk_score": r.risk_score,
                    "llm_providers_consulted": _jl(r.llm_providers_consulted, None), "raw_verdicts": _jl(r.raw_verdicts_json, r.raw_verdicts_json),
                    "human_confirmed_at": _iso(r.human_confirmed_at)})
    return out


@router.get(f"{P}/audit-logs")
async def audit_logs(event_type: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None,
                     q: Optional[str] = None, page: int = 1, page_size: int = 20, export: bool = False,
                     admin: str = Depends(get_current_admin)):
    sd, ed = _parse_day(start, "start"), _parse_day(end, "end")
    page_size = max(1, min(MAX_PAGE, page_size))
    page = max(1, page)
    with Session(engine) as s:
        stmt = select(DecisionAuditLog)
        cnt = select(func.count()).select_from(DecisionAuditLog)
        conds = []
        if event_type:
            conds.append(DecisionAuditLog.event_type == event_type)
        if sd:
            conds.append(DecisionAuditLog.created_at >= datetime.combine(sd, datetime.min.time()))
        if ed:
            conds.append(DecisionAuditLog.created_at < datetime.combine(ed + timedelta(days=1), datetime.min.time()))
        if q:
            n = f"%{q.strip()[:100]}%"
            sub = [DecisionAuditLog.human_reviewer.ilike(n), DecisionAuditLog.human_action.ilike(n)]
            job_ids = list(s.exec(select(Job.id).where(Job.title.ilike(n))).all())
            if job_ids:
                sub.append(DecisionAuditLog.job_id.in_(job_ids))
            cand_ids = list(s.exec(select(CandidateProfile.candidate_id).where(CandidateProfile.full_name.ilike(n))).all()) \
                + list(s.exec(select(CandidateUser.id).where(CandidateUser.username.ilike(n))).all())
            if cand_ids:
                sub.append(DecisionAuditLog.candidate_id.in_(cand_ids))
            if q.strip().isdigit():
                sub += [DecisionAuditLog.application_id == int(q.strip()), DecisionAuditLog.id == int(q.strip())]
            conds.append(or_(*sub))
        for c in conds:
            stmt = stmt.where(c)
            cnt = cnt.where(c)
        total = s.exec(cnt).one()
        stmt = stmt.order_by(DecisionAuditLog.created_at.desc(), DecisionAuditLog.id.desc())
        if export:
            rows = s.exec(stmt.limit(MAX_EXPORT)).all()
        else:
            rows = s.exec(stmt.offset((page - 1) * page_size).limit(page_size)).all()
        jobs = {j.id: j.title for j in s.exec(select(Job).where(Job.id.in_([r.job_id for r in rows if r.job_id] or [0]))).all()}
        people = _people(s, [r.candidate_id for r in rows if r.candidate_id])
        types = [t for t, in [(x,) for x in s.exec(select(DecisionAuditLog.event_type).distinct()).all()]]
        counts = dict(s.exec(select(DecisionAuditLog.event_type, func.count()).group_by(DecisionAuditLog.event_type)).all())
        week = s.exec(select(func.count()).select_from(DecisionAuditLog).where(DecisionAuditLog.created_at >= utc_now() - timedelta(days=7))).one()
        return {"items": [_audit_public(r, jobs, people, full=export) for r in rows], "total": total, "page": page, "page_size": page_size,
                "event_types": sorted(types), "kpis": {"total": sum(counts.values()), "last_7_days": week,
                                                       "admin_actions": counts.get("admin_action", 0), "by_type": counts}}


@router.get(f"{P}/audit-logs/{{log_id}}")
async def audit_log_detail(log_id: int, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        r = s.get(DecisionAuditLog, log_id)
        if not r:
            raise HTTPException(status_code=404, detail="Audit entry not found")
        jobs = {r.job_id: s.get(Job, r.job_id).title} if r.job_id and s.get(Job, r.job_id) else {}
        people = _people(s, [r.candidate_id] if r.candidate_id else [])
        return _audit_public(r, jobs, people, full=True)


# ── recruiter requests: approve / reject with an audit trail ─────────────────
# The decision logic (account creation, credential email) lives in
# app/api/auth.py; these wrappers add the admin audit event the portal shows.


class RequestDecision(BaseModel):
    reason: Optional[str] = PField(default=None, max_length=500)


@router.post(f"{P}/recruiter-requests/{{request_id}}/approve")
async def approve_request(request_id: int, admin: str = Depends(get_current_admin)):
    from .auth import approve_recruiter_request
    res = await approve_recruiter_request(request_id, admin=admin)
    with Session(engine) as s:
        _audit(s, admin, "approve_recruiter_request", f"r-{request_id}",
               details={"email": (res.get("user") or {}).get("email"), "email_sent": res.get("email_sent")})
    return res


@router.post(f"{P}/recruiter-requests/{{request_id}}/reject")
async def reject_request(request_id: int, body: RequestDecision, admin: str = Depends(get_current_admin)):
    from .auth import reject_recruiter_request
    reason = (body.reason or "").strip() or None
    res = await reject_recruiter_request(request_id, reason=reason, admin=admin)
    with Session(engine) as s:
        _audit(s, admin, "reject_recruiter_request", f"r-{request_id}", details={"reason": reason})
    return res


# ── platform settings (System Settings page) ──────────────────────────────────
# Stored as JSON next to the database (no schema change). Values are read by
# the public landing / login pages through /api/public/stats.

SETTINGS_DEFAULTS: Dict[str, Any] = {
    "support_email": None,
    "announcement_enabled": False,
    "announcement_text": "",
    "announcement_tone": "info",
    "public_stats": True,
    "retention_days": 30,
}


def _settings_path() -> str:
    import os
    from ..db import DATA_DIR
    return os.path.join(DATA_DIR, "platform_settings.json")


def load_platform_settings() -> Dict[str, Any]:
    out = dict(SETTINGS_DEFAULTS)
    with Session(engine) as s:
        rows = s.exec(select(PlatformSetting)).all()
        if rows:
            for row in rows:
                if row.key in SETTINGS_DEFAULTS:
                    try: out[row.key] = json.loads(row.value_json)
                    except (TypeError, ValueError): pass
            return out
    try:
        with open(_settings_path(), "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        if isinstance(raw, dict):
            out.update({k: raw[k] for k in SETTINGS_DEFAULTS if k in raw})
    except (OSError, ValueError):
        pass
    return out


class SettingsBody(BaseModel):
    support_email: Optional[str] = PField(default=None, max_length=254)
    announcement_enabled: Optional[bool] = None
    announcement_text: Optional[str] = PField(default=None, max_length=300)
    announcement_tone: Optional[str] = None
    public_stats: Optional[bool] = None
    retention_days: Optional[int] = None


@router.get(f"{P}/settings")
async def get_settings(admin: str = Depends(get_current_admin)):
    import os
    st = load_platform_settings()
    try:
        mtime = os.path.getmtime(_settings_path())
        updated = _iso(datetime.utcfromtimestamp(mtime))
    except OSError:
        updated = None
    with Session(engine) as s:
        health = _health(s)
    return {"settings": st, "updated_at": updated, "health": health, "dev_mode": _dev_mode()}


@router.put(f"{P}/settings")
async def put_settings(body: SettingsBody, admin: str = Depends(get_current_admin)):
    import os
    st = load_platform_settings()
    changes = body.model_dump(exclude_unset=True)
    if "support_email" in changes:
        v = (changes["support_email"] or "").strip().lower() or None
        if v and not EMAIL_RE.match(v):
            raise HTTPException(status_code=422, detail="Support email must be a valid email address")
        changes["support_email"] = v
    if "announcement_text" in changes:
        changes["announcement_text"] = (changes["announcement_text"] or "").strip()
    if "announcement_tone" in changes and changes["announcement_tone"] not in {"info", "warning", "success"}:
        raise HTTPException(status_code=422, detail="announcement_tone must be info, warning or success")
    if "retention_days" in changes:
        d = changes["retention_days"]
        if d is None or not (7 <= int(d) <= 365):
            raise HTTPException(status_code=422, detail="Retention must be between 7 and 365 days")
    for k in ("announcement_enabled", "public_stats"):
        if k in changes and changes[k] is None:
            changes.pop(k)
    st.update(changes)
    if st["announcement_enabled"] and len(st["announcement_text"]) < 3:
        raise HTTPException(status_code=422, detail="Write the announcement text before turning it on")
    with Session(engine) as s:
        for key, value in st.items():
            row = s.get(PlatformSetting, key)
            if row:
                row.value_json = json.dumps(value)
                row.updated_at = utc_now()
            else:
                s.add(PlatformSetting(key=key, value_json=json.dumps(value)))
        s.commit()
    _PUBLIC_CACHE.clear()
    with Session(engine) as s:
        _audit(s, admin, "update_settings", "platform", details=changes)
    return {"settings": st}


# ── public stats (landing page, no auth) ──────────────────────────────────────

_PUBLIC_CACHE: Dict[str, Any] = {}
PUBLIC_TTL = 60


@router.get("/api/public/stats")
async def public_stats():
    """Live, non-personal platform counts for the public landing page.
    Cached for a minute; company names are only those of approved companies."""
    now = time.time()
    hit = _PUBLIC_CACHE.get("stats")
    if hit and now - hit[0] < PUBLIC_TTL:
        return hit[1]
    st = load_platform_settings()
    with Session(engine) as s:
        ix = _Index(s)
        companies = [c for c in _companies(s, ix) if c["status"] in {"verified", "approved"}]
        students = s.exec(select(func.count()).select_from(CandidateUser).where(or_(CandidateUser.status == None, CandidateUser.status != "suspended"))).one()  # noqa: E711
        open_jobs = s.exec(select(func.count()).select_from(Job).where(Job.status == "open")).one()
        branches = {branch_id(b) for b in s.exec(select(Job.branch).where(Job.status == "open")).all() if b}
        verified_projects = s.exec(select(func.count()).select_from(StudentProject).where(StudentProject.status == "verified")).one()
    top = sorted(companies, key=lambda c: (-c["jobs"], c["name"]))[:6]
    out = {
        "students": students, "companies": len(companies), "open_jobs": open_jobs,
        "branches_hiring": len([b for b in branches if b in dict(CORE_BRANCHES)]),
        "verified_projects": verified_projects,
        "company_names": [c["name"] for c in top],
        "show_stats": bool(st.get("public_stats", True)),
        "announcement": {"text": st["announcement_text"], "tone": st["announcement_tone"]} if st.get("announcement_enabled") and st.get("announcement_text") else None,
        "support_email": st.get("support_email"),
    }
    _PUBLIC_CACHE["stats"] = (now, out)
    return out
