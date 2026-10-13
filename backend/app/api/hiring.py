"""v2 portal API — hiring (recruiter pages 18–22).

All routes live under /api/recruiter/hiring/… and require a recruiter token
(get_current_recruiter). Every object is scoped to the calling recruiter: an
interview / offer / application is only reachable when its Job belongs to
that recruiter (anything else answers 404 so ids are not leaked).

Dates are stored as naive UTC and serialised as ISO-8601 with a trailing "Z"
so browsers render them in the viewer's local time. Candidate emails format
times in IST (Asia/Kolkata).
"""
from __future__ import annotations

import json
import logging
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from ..auth import get_current_recruiter, hash_password, verify_password
from ..db import (
    Application, CandidateProfile, CandidateUser, CompanyProfile, DecisionAuditLog, InterviewSession, Job, Offer,
    RecruiterProfile, RecruiterRequest, RecruiterUser, ScheduledInterview, TeamMember, User, engine, utc_now,
)
from ..services import email_templates
from ..services.audit import record_audit_event
from ..services.email_delivery import queue_email
from ..services.media_utils import delete_media_file, validate_and_save_image

log = logging.getLogger("ats-platform.hiring")

router = APIRouter(prefix="/api/recruiter/hiring", tags=["hiring"])

try:  # pragma: no cover - tzdata is present on Linux hosts
    from zoneinfo import ZoneInfo
    IST = ZoneInfo("Asia/Kolkata")
except Exception:  # pragma: no cover
    IST = timezone(timedelta(hours=5, minutes=30))

INTERVIEW_STATUSES = ("scheduled", "completed", "cancelled", "no_show")
OFFER_STATUSES = ("draft", "sent", "accepted", "declined", "negotiation", "withdrawn", "joined")
OPEN_OFFER_STATUSES = ("draft", "sent", "negotiation", "accepted", "joined")
RECOMMENDATIONS = ("strong_hire", "hire", "no_hire")
NOTIFICATION_KEYS = ("new_applications", "interview_updates", "offer_status", "weekly_report", "product_updates")
NOTIFICATION_DEFAULTS = {"new_applications": True, "interview_updates": True, "offer_status": True, "weekly_report": True, "product_updates": False}
SHORTLIST_STATUSES = ("shortlisted", "automated_interview")
SHORTLIST_CANDIDATE_STATUSES = ("shortlisted", "interview", "final_result")
MAX_GALLERY = 12

DEFAULT_ROUNDS = [
    {"name": "Technical Round 1", "duration_min": 60, "description": "Core concepts, domain knowledge"},
    {"name": "Technical Round 2", "duration_min": 60, "description": "Problem solving, hands-on skills"},
    {"name": "Project Discussion", "duration_min": 45, "description": "Past projects, approach, teamwork"},
    {"name": "HR Round", "duration_min": 30, "description": "Communication, culture fit, career goals"},
]

DEFAULT_OFFER_TEMPLATES = [
    {
        "id": "full-time",
        "name": "Full-time offer",
        "kind": "full-time",
        "body": (
            "Dear {candidate_name},\n\n"
            "We are delighted to offer you the position of {job_title} at {company}.\n\n"
            "Your annual compensation (CTC) will be {ctc}. Your expected date of joining is {joining_date}.\n\n"
            "This offer is subject to the successful completion of your degree and verification of your documents. "
            "Please confirm your acceptance from your CoreLink applications page.\n\n"
            "We look forward to welcoming you to the team.\n\n"
            "Warm regards,\nTalent Acquisition Team\n{company}"
        ),
    },
    {
        "id": "internship",
        "name": "Internship offer",
        "kind": "internship",
        "body": (
            "Dear {candidate_name},\n\n"
            "Congratulations! We are pleased to offer you an internship as {job_title} at {company}.\n\n"
            "Your stipend will be {ctc}. The internship starts on {joining_date}.\n\n"
            "During the internship you will work with our engineering teams on live programmes and receive mentorship "
            "from senior engineers. Please confirm your acceptance from your CoreLink applications page.\n\n"
            "Best wishes,\nCampus Hiring Team\n{company}"
        ),
    },
    {
        "id": "ppo",
        "name": "Pre-placement offer (PPO)",
        "kind": "full-time",
        "body": (
            "Dear {candidate_name},\n\n"
            "Following your internship performance, {company} is happy to extend a pre-placement offer for the role of "
            "{job_title}.\n\nCTC: {ctc}\nDate of joining: {joining_date}\n\n"
            "Please confirm your acceptance from your CoreLink applications page.\n\n"
            "Regards,\nTalent Acquisition Team\n{company}"
        ),
    },
]

DEFAULT_JOB_DEFAULTS = {
    "job_type": "full-time",
    "experience_level": "fresher",
    "remote_type": "onsite",
    "openings": 1,
    "location": "",
    "eligibility": "B.E./B.Tech, CGPA 7.0+",
}

BRANCH_LABELS = {
    "mechanical": "Mechanical", "mech": "Mechanical", "civil": "Civil", "eee": "Electrical", "electrical": "Electrical",
    "ece": "ECE", "electronics": "ECE", "chemical": "Chemical", "aerospace": "Aerospace", "automobile": "Automotive",
    "automotive": "Automotive", "metallurgy": "Metallurgy", "materials": "Metallurgy", "software": "Computer Science",
    "cse": "Computer Science", "computer science": "Computer Science", "it": "Computer Science",
}


# ─── generic helpers ─────────────────────────────────────────────────────────

def _iso(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.isoformat(timespec="seconds") + "Z"


def _parse_dt(value: str, field: str = "starts_at") -> datetime:
    """ISO-8601 (with Z / offset, or naive = UTC) → naive UTC datetime."""
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=422, detail=f"{field} must be an ISO-8601 date-time")
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _parse_day(value: Optional[str], field: str, end: bool = False) -> Optional[datetime]:
    """'2026-10-01' or full ISO → naive UTC datetime (end=True → end of that day)."""
    if not value:
        return None
    v = str(value).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        try:
            d = datetime.fromisoformat(v)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"{field} is not a valid date")
        return d + timedelta(days=1) - timedelta(microseconds=1) if end else d
    return _parse_dt(v, field)


def _fmt_ist(dt: datetime) -> str:
    local = dt.replace(tzinfo=timezone.utc).astimezone(IST)
    return local.strftime("%a, %d %b %Y, %I:%M %p IST")


def _loads(raw: Optional[str], default):
    if not raw:
        return default
    try:
        v = json.loads(raw)
        return v if isinstance(v, type(default)) else default
    except Exception:
        return default


def _delta(cur: float, prev: float) -> int:
    if not prev:
        return 100 if cur else 0
    return int(round((cur - prev) * 100.0 / prev))


def _branch_label(raw: Optional[str]) -> str:
    if not raw:
        return "Other"
    k = str(raw).strip().lower()
    return BRANCH_LABELS.get(k) or str(raw).strip().title()


def _city(loc: Optional[str]) -> str:
    c = (loc or "").split(",")[0].strip()
    if c.lower() in ("bengaluru",):
        c = "Bangalore"
    return c or "Other"


def _media(path: Optional[str]) -> Optional[str]:
    return f"/media/{path}" if path else None


def _send(to: Optional[str], email, category: str) -> Optional[int]:
    if not to:
        return None
    subject, body, html = email
    try:
        return queue_email(to, subject, body, html=html, category=category)
    except Exception as exc:  # never fail the request because of email
        log.warning("Could not queue %s email to %s: %s", category, to, exc)
        return None


# ─── recruiter / ownership helpers ───────────────────────────────────────────

def _rec(s: Session, email: str) -> RecruiterUser:
    rec = s.exec(select(RecruiterUser).where(RecruiterUser.username == email)).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recruiter account not found")
    return rec


def _user(s: Session, email: str) -> Optional[User]:
    return s.exec(select(User).where(User.email == email)).first()


def _my_jobs(s: Session, rid: int) -> Dict[int, Job]:
    return {j.id: j for j in s.exec(select(Job).where(Job.recruiter_id == rid)).all()}


def _owned_app(s: Session, app_id: int, rid: int):
    app = s.get(Application, app_id)
    job = s.get(Job, app.job_id) if app else None
    if not app or not job or job.recruiter_id != rid:
        raise HTTPException(status_code=404, detail="Application not found")
    return app, job


def _owned_interview(s: Session, iv_id: int, rid: int) -> ScheduledInterview:
    iv = s.get(ScheduledInterview, iv_id)
    job = s.get(Job, iv.job_id) if iv else None
    if not iv or not job or job.recruiter_id != rid:
        raise HTTPException(status_code=404, detail="Interview not found")
    return iv


def _owned_offer(s: Session, offer_id: int, rid: int) -> Offer:
    o = s.get(Offer, offer_id)
    job = s.get(Job, o.job_id) if o else None
    if not o or not job or job.recruiter_id != rid:
        raise HTTPException(status_code=404, detail="Offer not found")
    return o


def _candidates(s: Session, ids: Iterable[int]) -> Dict[int, dict]:
    ids = list({i for i in ids if i})
    if not ids:
        return {}
    users = {u.id: u for u in s.exec(select(CandidateUser).where(CandidateUser.id.in_(ids))).all()}
    profiles = {p.candidate_id: p for p in s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id.in_(ids))).all()}
    out = {}
    for cid in ids:
        u, p = users.get(cid), profiles.get(cid)
        email = (p.contact_email if p and p.contact_email else None) or (u.username if u else None)
        name = (p.full_name if p and p.full_name else None) or (email.split("@")[0].replace(".", " ").title() if email else f"Candidate {cid}")
        out[cid] = {
            "name": name, "email": email, "college": p.college if p else None, "branch": p.branch if p else None,
            "cgpa": p.cgpa if p else None, "avatar_url": _media(p.avatar_path) if p else None,
            "location": p.location_text if p else None,
        }
    return out


def _company(s: Session, rec: RecruiterUser) -> CompanyProfile:
    cp = s.exec(select(CompanyProfile).where(CompanyProfile.owner_recruiter_id == rec.id)).first()
    if cp:
        return cp
    rp = s.exec(select(RecruiterProfile).where(RecruiterProfile.recruiter_id == rec.id)).first()
    name = (rp.company_name or "").strip() if rp else ""
    rr = _recruiter_request(s, rec.username)
    if not name and rr and rr.company_name:
        name = rr.company_name.strip()
    if not name:
        domain = rec.username.split("@")[-1] if "@" in rec.username else rec.username
        name = domain.split(".")[0].capitalize() or "My Company"
    cp = CompanyProfile(owner_recruiter_id=rec.id, name=name, website=(rr.company_website if rr else None),
                        linkedin=(rr.linkedin_url if rr else None))
    s.add(cp)
    s.commit()
    s.refresh(cp)
    return cp


def _recruiter_request(s: Session, email: str) -> Optional[RecruiterRequest]:
    rows = s.exec(select(RecruiterRequest).where(RecruiterRequest.email == email)).all()
    approved = [r for r in rows if r.status == "approved"]
    pool = approved or rows
    return sorted(pool, key=lambda r: r.submitted_at or datetime.min)[-1] if pool else None


def _company_name(s: Session, rec: RecruiterUser) -> str:
    return _company(s, rec).name


def _settings(user: Optional[User]) -> dict:
    return _loads(user.settings_json if user else None, {})


def recruiter_notification_enabled(s: Session, email: str, key: str) -> bool:
    """Whether a recruiter wants emails of type `key` (see NOTIFICATION_KEYS).
    Other modules may import this to honour the Settings → Notifications page."""
    prefs = {**NOTIFICATION_DEFAULTS, **_settings(_user(s, email)).get("notifications", {})}
    return bool(prefs.get(key, True))


def _shortlisted(app: Application) -> bool:
    return app.status in SHORTLIST_STATUSES or (app.candidate_status or "") in SHORTLIST_CANDIDATE_STATUSES


# ═══════════════════════════════════════════════════════════════════════════
# Company profile
# ═══════════════════════════════════════════════════════════════════════════

def _prefs(cp: CompanyProfile) -> dict:
    p = _loads(cp.preferences_json, {})
    return p


def _company_dict(s: Session, rec: RecruiterUser, cp: CompanyProfile) -> dict:
    prefs = _prefs(cp)
    rr = _recruiter_request(s, rec.username)
    open_jobs = sum(1 for j in _my_jobs(s, rec.id).values() if j.status == "open")
    gallery = [p for p in _loads(cp.gallery_json, []) if isinstance(p, str)]
    team = s.exec(select(TeamMember).where(TeamMember.owner_recruiter_id == rec.id).order_by(TeamMember.created_at)).all()
    return {
        "id": cp.id,
        "name": cp.name,
        "tagline": cp.tagline,
        "industries": _loads(cp.industries_json, []),
        "headquarters": cp.headquarters,
        "location_text": cp.location_text,
        "website": cp.website,
        "linkedin": cp.linkedin,
        "legal_name": cp.legal_name,
        "company_type": cp.company_type,
        "size": cp.size,
        "founded": cp.founded,
        "about": cp.about,
        "mission": cp.mission,
        "vision": cp.vision,
        "values": _loads(cp.values_json, []),
        "highlights": _loads(cp.highlights_json, []),
        "locations": _loads(cp.locations_json, []),
        "hiring_focus": _loads(cp.hiring_focus_json, []),
        "preferences": prefs,
        "benefits": _loads(cp.benefits_json, []),
        "rounds": prefs.get("rounds") or DEFAULT_ROUNDS,
        "offer_templates": prefs.get("offer_templates") or DEFAULT_OFFER_TEMPLATES,
        "job_defaults": {**DEFAULT_JOB_DEFAULTS, **(prefs.get("job_defaults") or {})},
        "logo_url": _media(cp.logo_path),
        "cover_url": _media(cp.cover_path),
        "gallery": [{"path": p, "url": _media(p)} for p in gallery],
        "verified": bool(rr and rr.status == "approved" and rr.verification_verdict == "verified"),
        "open_positions": open_jobs,
        "team_count": len(team),
        "updated_at": _iso(cp.updated_at),
    }


Str60 = Field(default=None, max_length=60)


class Highlight(BaseModel):
    label: str = Field(max_length=40)
    value: str = Field(max_length=30)


class OfficeLocation(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    address: str = Field(default="", max_length=200)
    tag: str = Field(default="", max_length=60)
    main: bool = False


class RoundTemplate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    duration_min: int = Field(ge=15, le=240)
    description: str = Field(default="", max_length=200)


class OfferTemplate(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["internship", "full-time", "other"] = "full-time"
    body: str = Field(min_length=10, max_length=8000)


class JobDefaults(BaseModel):
    job_type: Optional[Literal["internship", "full-time", "part-time", "apprenticeship"]] = None
    experience_level: Optional[Literal["fresher", "0-2", "2-5", "5+"]] = None
    remote_type: Optional[Literal["onsite", "remote", "hybrid"]] = None
    openings: Optional[int] = Field(default=None, ge=1, le=500)
    location: Optional[str] = Field(default=None, max_length=120)
    eligibility: Optional[str] = Field(default=None, max_length=300)


class Preferences(BaseModel):
    employment_types: Optional[str] = Field(default=None, max_length=200)
    experience: Optional[str] = Field(default=None, max_length=200)
    locations: Optional[str] = Field(default=None, max_length=200)
    campus: Optional[str] = Field(default=None, max_length=200)
    rounds: Optional[List[RoundTemplate]] = Field(default=None, max_length=12)
    offer_templates: Optional[List[OfferTemplate]] = Field(default=None, min_length=1, max_length=6)
    job_defaults: Optional[JobDefaults] = None
    public_profile: Optional[bool] = None


def _url_ok(v: Optional[str]) -> Optional[str]:
    if v is None:
        return v
    v = v.strip()
    if v and not re.match(r"^https?://[^\s]+\.[^\s]+", v):
        raise ValueError("must be a full URL starting with http:// or https://")
    return v


class CompanyUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    tagline: Optional[str] = Field(default=None, max_length=160)
    industries: Optional[List[str]] = Field(default=None, max_length=10)
    headquarters: Optional[str] = Field(default=None, max_length=120)
    location_text: Optional[str] = Field(default=None, max_length=120)
    website: Optional[str] = Field(default=None, max_length=200)
    linkedin: Optional[str] = Field(default=None, max_length=200)
    legal_name: Optional[str] = Field(default=None, max_length=160)
    company_type: Optional[str] = Field(default=None, max_length=60)
    size: Optional[str] = Field(default=None, max_length=60)
    founded: Optional[str] = Field(default=None, max_length=10)
    about: Optional[str] = Field(default=None, max_length=3000)
    mission: Optional[str] = Field(default=None, max_length=600)
    vision: Optional[str] = Field(default=None, max_length=600)
    values: Optional[List[str]] = Field(default=None, max_length=10)
    highlights: Optional[List[Highlight]] = Field(default=None, max_length=8)
    locations: Optional[List[OfficeLocation]] = Field(default=None, max_length=20)
    hiring_focus: Optional[List[str]] = Field(default=None, max_length=30)
    benefits: Optional[List[str]] = Field(default=None, max_length=20)
    preferences: Optional[Preferences] = None

    @field_validator("website", "linkedin")
    @classmethod
    def _urls(cls, v):
        return _url_ok(v)

    @field_validator("industries", "values", "hiring_focus", "benefits")
    @classmethod
    def _short_strings(cls, v):
        if v is None:
            return v
        out = []
        for x in v:
            x = str(x).strip()
            if not x:
                continue
            if len(x) > 120:
                raise ValueError("items must be at most 120 characters")
            if x not in out:
                out.append(x)
        return out

    @field_validator("founded")
    @classmethod
    def _founded(cls, v):
        if v and not re.fullmatch(r"\d{4}", v.strip()):
            raise ValueError("founded must be a 4-digit year")
        return v.strip() if v else v


@router.get("/company")
def get_company(recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        return _company_dict(s, rec, _company(s, rec))


@router.put("/company")
def update_company(body: CompanyUpdate, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        cp = _company(s, rec)
        data = body.model_dump(exclude_unset=True)
        simple = ("name", "tagline", "headquarters", "location_text", "website", "linkedin", "legal_name",
                  "company_type", "size", "founded", "about", "mission", "vision")
        for k in simple:
            if k in data:
                v = data[k]
                setattr(cp, k, v.strip() if isinstance(v, str) else v)
        lists = {"industries": "industries_json", "values": "values_json", "highlights": "highlights_json",
                 "locations": "locations_json", "hiring_focus": "hiring_focus_json", "benefits": "benefits_json"}
        for k, col in lists.items():
            if k in data and data[k] is not None:
                val = data[k]
                if k == "locations" and val:
                    # exactly one main office (first flagged, else first)
                    mains = [i for i, l in enumerate(val) if l.get("main")]
                    keep = mains[0] if mains else 0
                    for i, l in enumerate(val):
                        l["main"] = i == keep
                setattr(cp, col, json.dumps(val))
        if data.get("preferences") is not None:
            prefs = _prefs(cp)
            full = body.preferences.model_dump()
            for k in body.preferences.model_fields_set:
                v = full[k]
                if k == "job_defaults" and v is not None:
                    v = {kk: vv for kk, vv in v.items() if vv is not None}
                prefs[k] = v
            cp.preferences_json = json.dumps(prefs)
        if not (cp.name or "").strip():
            raise HTTPException(status_code=422, detail="Company name is required")
        cp.updated_at = utc_now()
        s.add(cp)
        s.commit()
        s.refresh(cp)
        return _company_dict(s, rec, cp)


@router.post("/company/logo")
def upload_logo(file: UploadFile = File(...), recruiter: str = Depends(get_current_recruiter)):
    rel = validate_and_save_image(file, "company-logos")
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        cp = _company(s, rec)
        if cp.logo_path and cp.logo_path != rel:
            delete_media_file(cp.logo_path)
        cp.logo_path, cp.updated_at = rel, utc_now()
        s.add(cp)
        s.commit()
        s.refresh(cp)
        return _company_dict(s, rec, cp)


@router.post("/company/cover")
def upload_cover(file: UploadFile = File(...), recruiter: str = Depends(get_current_recruiter)):
    rel = validate_and_save_image(file, "company-covers")
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        cp = _company(s, rec)
        if cp.cover_path and cp.cover_path != rel:
            delete_media_file(cp.cover_path)
        cp.cover_path, cp.updated_at = rel, utc_now()
        s.add(cp)
        s.commit()
        s.refresh(cp)
        return _company_dict(s, rec, cp)


@router.delete("/company/cover")
def delete_cover(recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        cp = _company(s, rec)
        if cp.cover_path:
            delete_media_file(cp.cover_path)
        cp.cover_path, cp.updated_at = None, utc_now()
        s.add(cp)
        s.commit()
        s.refresh(cp)
        return _company_dict(s, rec, cp)


@router.post("/company/gallery")
def upload_gallery(file: UploadFile = File(...), recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        cp = _company(s, rec)
        gallery = [p for p in _loads(cp.gallery_json, []) if isinstance(p, str)]
        if len(gallery) >= MAX_GALLERY:
            raise HTTPException(status_code=400, detail=f"The gallery holds at most {MAX_GALLERY} images — delete one first")
        rel = validate_and_save_image(file, "company-gallery")
        gallery.append(rel)
        cp.gallery_json, cp.updated_at = json.dumps(gallery), utc_now()
        s.add(cp)
        s.commit()
        s.refresh(cp)
        return _company_dict(s, rec, cp)


@router.delete("/company/gallery")
def delete_gallery(path: str = Query(..., max_length=300), recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        cp = _company(s, rec)
        gallery = [p for p in _loads(cp.gallery_json, []) if isinstance(p, str)]
        if path not in gallery:
            raise HTTPException(status_code=404, detail="Image not found in gallery")
        gallery.remove(path)
        delete_media_file(path)
        cp.gallery_json, cp.updated_at = json.dumps(gallery), utc_now()
        s.add(cp)
        s.commit()
        s.refresh(cp)
        return _company_dict(s, rec, cp)


# ─── Team ────────────────────────────────────────────────────────────────────

def _member_dict(m: TeamMember) -> dict:
    return {"id": m.id, "name": m.name, "email": m.email, "title": m.title, "access_level": m.access_level,
            "status": m.status, "created_at": _iso(m.created_at)}


class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=160)
    title: Optional[str] = Field(default=None, max_length=80)
    access_level: Literal["admin", "recruiter", "viewer"] = "recruiter"
    send_invite: bool = True

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        v = v.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            raise ValueError("enter a valid email address")
        return v


class TeamUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    title: Optional[str] = Field(default=None, max_length=80)
    access_level: Optional[Literal["admin", "recruiter", "viewer"]] = None
    status: Optional[Literal["invited", "active", "inactive"]] = None


def _owned_member(s: Session, mid: int, rid: int) -> TeamMember:
    m = s.get(TeamMember, mid)
    if not m or m.owner_recruiter_id != rid:
        raise HTTPException(status_code=404, detail="Team member not found")
    return m


def _invite(s: Session, rec: RecruiterUser, m: TeamMember):
    u = _user(s, rec.username)
    inviter = (u.name if u and u.name else None) or rec.username
    return _send(m.email, email_templates.team_invitation(m.name, inviter, _company_name(s, rec), m.access_level), "team_invitation")


@router.get("/team")
def list_team(recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        rows = s.exec(select(TeamMember).where(TeamMember.owner_recruiter_id == rec.id).order_by(TeamMember.created_at)).all()
        return {"items": [_member_dict(m) for m in rows]}


@router.post("/team", status_code=201)
def add_team_member(body: TeamCreate, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        rows = s.exec(select(TeamMember).where(TeamMember.owner_recruiter_id == rec.id)).all()
        if len(rows) >= 50:
            raise HTTPException(status_code=400, detail="A team can have at most 50 members")
        if any(m.email.lower() == body.email for m in rows):
            raise HTTPException(status_code=409, detail="This email is already on your team")
        existing = _user(s, body.email)
        m = TeamMember(owner_recruiter_id=rec.id, name=body.name.strip(), email=body.email, title=(body.title or "").strip() or None,
                       access_level=body.access_level, status="active" if existing and existing.role == "recruiter" else "invited")
        s.add(m)
        s.commit()
        s.refresh(m)
        email_id = _invite(s, rec, m) if body.send_invite else None
        return {**_member_dict(m), "invite_email_id": email_id}


@router.patch("/team/{member_id}")
def update_team_member(member_id: int, body: TeamUpdate, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        m = _owned_member(s, member_id, rec.id)
        for k, v in body.model_dump(exclude_unset=True).items():
            if v is not None:
                setattr(m, k, v.strip() if isinstance(v, str) else v)
        s.add(m)
        s.commit()
        s.refresh(m)
        return _member_dict(m)


@router.post("/team/{member_id}/resend")
def resend_team_invite(member_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        m = _owned_member(s, member_id, rec.id)
        return {"ok": True, "invite_email_id": _invite(s, rec, m)}


@router.delete("/team/{member_id}")
def delete_team_member(member_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        m = _owned_member(s, member_id, rec.id)
        s.delete(m)
        s.commit()
        return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════
# Applications picker (shortlisted / interview / offer stage)
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/applications")
def pick_applications(
    stage: Literal["interview", "offer", "all"] = "interview",
    q: Optional[str] = Query(default=None, max_length=100),
    limit: int = Query(default=200, ge=1, le=500),
    recruiter: str = Depends(get_current_recruiter),
):
    """Applications of my jobs a recruiter can act on. stage=interview →
    shortlisted / interview stage; stage=offer → those plus anyone already
    interviewed (human or AI)."""
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        jobs = _my_jobs(s, rec.id)
        if not jobs:
            return {"items": []}
        apps = s.exec(select(Application).where(Application.job_id.in_(list(jobs)))).all()
        ivs = s.exec(select(ScheduledInterview).where(ScheduledInterview.job_id.in_(list(jobs)))).all()
        iv_apps = defaultdict(list)
        for iv in ivs:
            iv_apps[iv.application_id].append(iv)
        offers = s.exec(select(Offer).where(Offer.job_id.in_(list(jobs)))).all()
        active_offer = {o.application_id: o for o in offers if o.status in OPEN_OFFER_STATUSES}
        cands = _candidates(s, [a.candidate_id for a in apps])
        out = []
        for a in apps:
            interviewed = any(iv.status != "cancelled" for iv in iv_apps[a.id]) or a.interview_status == "completed"
            if stage == "interview" and not _shortlisted(a):
                continue
            if stage == "offer" and not (_shortlisted(a) or interviewed):
                continue
            c = cands.get(a.candidate_id, {})
            job = jobs[a.job_id]
            row = {
                "application_id": a.id, "candidate_id": a.candidate_id, "candidate_name": c.get("name"),
                "candidate_email": c.get("email"), "college": c.get("college"), "branch": c.get("branch") or job.branch,
                "cgpa": c.get("cgpa"), "avatar_url": c.get("avatar_url"), "job_id": job.id, "job_title": job.title,
                "job_type": job.job_type, "status": a.status, "candidate_status": a.candidate_status,
                "interview_status": a.interview_status, "interview_eval_score": a.interview_eval_score,
                "final_score": a.final_score, "ats_score": a.ats_score, "interviews": len([iv for iv in iv_apps[a.id] if iv.status != "cancelled"]),
                "has_active_offer": a.id in active_offer, "offer_id": active_offer[a.id].id if a.id in active_offer else None,
            }
            if q and q.lower() not in f"{row['candidate_name']} {row['job_title']} {row['college'] or ''}".lower():
                continue
            out.append(row)
        out.sort(key=lambda r: (r["candidate_name"] or "").lower())
        return {"items": out[:limit]}


# ═══════════════════════════════════════════════════════════════════════════
# Interviews
# ═══════════════════════════════════════════════════════════════════════════

class Feedback(BaseModel):
    rating: int = Field(ge=1, le=5)
    recommendation: Literal["strong_hire", "hire", "no_hire"]
    notes: str = Field(default="", max_length=4000)


class InterviewCreate(BaseModel):
    application_id: int
    round_name: str = Field(min_length=1, max_length=60)
    starts_at: str
    duration_min: int = Field(ge=15, le=240)
    mode: Literal["online", "onsite"]
    meeting_link: Optional[str] = Field(default=None, max_length=500)
    location: Optional[str] = Field(default=None, max_length=200)
    interviewers: str = Field(default="", max_length=500)
    notify: bool = True

    @field_validator("meeting_link")
    @classmethod
    def _link(cls, v):
        return _url_ok(v) or None


class InterviewUpdate(BaseModel):
    round_name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    starts_at: Optional[str] = None
    duration_min: Optional[int] = Field(default=None, ge=15, le=240)
    mode: Optional[Literal["online", "onsite"]] = None
    meeting_link: Optional[str] = Field(default=None, max_length=500)
    location: Optional[str] = Field(default=None, max_length=200)
    interviewers: Optional[str] = Field(default=None, max_length=500)
    status: Optional[Literal["scheduled", "completed", "cancelled", "no_show"]] = None
    feedback: Optional[Feedback] = None
    notify: bool = True

    @field_validator("meeting_link")
    @classmethod
    def _link(cls, v):
        return _url_ok(v)


def _iv_dict(iv: ScheduledInterview, job: Optional[Job], cand: dict) -> dict:
    fb = _loads(iv.feedback_json, {})
    return {
        "id": iv.id, "kind": "human", "application_id": iv.application_id, "job_id": iv.job_id,
        "job_title": job.title if job else None, "job_branch": job.branch if job else None,
        "candidate_id": iv.candidate_id, "candidate_name": cand.get("name"), "candidate_email": cand.get("email"),
        "candidate_avatar": cand.get("avatar_url"), "college": cand.get("college"), "branch": cand.get("branch") or (job.branch if job else None),
        "round_name": iv.round_name, "starts_at": _iso(iv.starts_at), "ends_at": _iso(iv.starts_at + timedelta(minutes=iv.duration_min or 60)),
        "duration_min": iv.duration_min, "mode": iv.mode, "meeting_link": iv.meeting_link, "location": iv.location,
        "interviewers": iv.interviewers or "", "status": iv.status, "feedback": fb or None, "has_feedback": bool(fb),
        "pending_feedback": iv.status == "completed" and not fb,
        "created_at": _iso(iv.created_at), "updated_at": _iso(iv.updated_at),
    }


def _ai_rows(s: Session, jobs: Dict[int, Job]) -> List[dict]:
    """Completed AI interviews (Application.interview_status == completed) — read-only rows."""
    if not jobs:
        return []
    apps = s.exec(select(Application).where(Application.job_id.in_(list(jobs)), Application.interview_status == "completed")).all()
    if not apps:
        return []
    sessions = s.exec(select(InterviewSession).where(InterviewSession.application_id.in_([a.id for a in apps]))).all()
    done_at = {}
    for ses in sessions:
        t = ses.completed_at or ses.started_at
        if t and (ses.application_id not in done_at or t > done_at[ses.application_id]):
            done_at[ses.application_id] = t
    cands = _candidates(s, [a.candidate_id for a in apps])
    out = []
    for a in apps:
        job, c = jobs[a.job_id], cands.get(a.candidate_id, {})
        at = done_at.get(a.id) or a.applied_at
        out.append({
            "id": f"ai-{a.id}", "kind": "ai", "application_id": a.id, "job_id": job.id, "job_title": job.title,
            "job_branch": job.branch, "candidate_id": a.candidate_id, "candidate_name": c.get("name"),
            "candidate_email": c.get("email"), "candidate_avatar": c.get("avatar_url"), "college": c.get("college"),
            "branch": c.get("branch") or job.branch, "round_name": "AI Interview", "starts_at": _iso(at), "ends_at": _iso(at),
            "duration_min": None, "mode": "online", "meeting_link": None, "location": None, "interviewers": "CoreLink AI",
            "status": "completed", "feedback": None, "has_feedback": a.interview_eval_score is not None, "pending_feedback": False,
            "eval_score": a.interview_eval_score, "recommendation": a.interview_recommendation,
            "risk_level": a.interview_risk_level, "created_at": _iso(at), "updated_at": _iso(at),
        })
    return out


def _check_slot(s: Session, candidate_id: int, start: datetime, duration: int, exclude_id: Optional[int] = None):
    if start < utc_now() - timedelta(minutes=1):
        raise HTTPException(status_code=422, detail="The interview time must be in the future")
    end = start + timedelta(minutes=duration)
    others = s.exec(select(ScheduledInterview).where(ScheduledInterview.candidate_id == candidate_id,
                                                     ScheduledInterview.status == "scheduled")).all()
    for o in others:
        if exclude_id and o.id == exclude_id:
            continue
        o_end = o.starts_at + timedelta(minutes=o.duration_min or 60)
        if start < o_end and o.starts_at < end:
            raise HTTPException(status_code=409, detail=f"This candidate already has an interview at {_fmt_ist(o.starts_at)} ({o.round_name}) that overlaps this slot")


def _interview_email(s: Session, kind: str, iv: ScheduledInterview, job: Job, rec: RecruiterUser) -> Optional[int]:
    c = _candidates(s, [iv.candidate_id]).get(iv.candidate_id, {})
    company = _company_name(s, rec)
    when = _fmt_ist(iv.starts_at)
    if kind == "invite":
        mail = email_templates.scheduled_interview_invitation(c.get("name"), job.title, company, iv.round_name, when, iv.duration_min,
                                                              iv.mode, iv.meeting_link, iv.location, iv.interviewers)
    elif kind == "reschedule":
        mail = email_templates.interview_rescheduled(c.get("name"), job.title, company, iv.round_name, when, iv.duration_min,
                                                     iv.mode, iv.meeting_link, iv.location)
    else:
        mail = email_templates.interview_cancelled(c.get("name"), job.title, company, iv.round_name, when)
    return _send(c.get("email"), mail, f"interview_{kind}")


@router.post("/interviews", status_code=201)
def schedule_interview(body: InterviewCreate, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        app, job = _owned_app(s, body.application_id, rec.id)
        start = _parse_dt(body.starts_at)
        if body.mode == "onsite" and not (body.location or "").strip():
            # onsite without a room is allowed but we default to the company location
            body.location = _company(s, rec).location_text or None
        _check_slot(s, app.candidate_id, start, body.duration_min)
        iv = ScheduledInterview(
            application_id=app.id, job_id=job.id, candidate_id=app.candidate_id, recruiter_id=rec.id,
            round_name=body.round_name.strip(), starts_at=start, duration_min=body.duration_min, mode=body.mode,
            meeting_link=(body.meeting_link or None) if body.mode == "online" else None,
            location=(body.location or "").strip() or None, interviewers=body.interviewers.strip(), status="scheduled",
        )
        s.add(iv)
        app.candidate_status = "interview"
        s.add(app)
        s.commit()
        s.refresh(iv)
        record_audit_event(
            session=s, event_type="human_interview_scheduled", application_id=app.id, candidate_id=app.candidate_id,
            job_id=job.id, human_reviewer=recruiter, human_action="scheduled_interview",
            final_recommendation=f"{iv.round_name} scheduled for {_fmt_ist(iv.starts_at)} ({iv.mode}). Interview #{iv.id}.",
        )
        email_id = _interview_email(s, "invite", iv, job, rec) if body.notify else None
        c = _candidates(s, [iv.candidate_id]).get(iv.candidate_id, {})
        return {**_iv_dict(iv, job, c), "email_id": email_id}


@router.get("/interviews")
def list_interviews(
    status: Optional[Literal["scheduled", "completed", "cancelled", "no_show", "pending_feedback", "upcoming"]] = None,
    job_id: Optional[int] = None,
    round: Optional[str] = Query(default=None, max_length=60),
    interviewer: Optional[str] = Query(default=None, max_length=80),
    q: Optional[str] = Query(default=None, max_length=100),
    start: Optional[str] = None,
    end: Optional[str] = None,
    include_ai: bool = True,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    recruiter: str = Depends(get_current_recruiter),
):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        jobs = _my_jobs(s, rec.id)
        if not jobs:
            return {"items": [], "total": 0}
        ivs = s.exec(select(ScheduledInterview).where(ScheduledInterview.job_id.in_(list(jobs)))).all()
        cands = _candidates(s, [iv.candidate_id for iv in ivs])
        rows = [_iv_dict(iv, jobs.get(iv.job_id), cands.get(iv.candidate_id, {})) for iv in ivs]
        if include_ai:
            rows += _ai_rows(s, jobs)
        lo, hi = _parse_day(start, "start"), _parse_day(end, "end", end=True)
        now_iso = _iso(utc_now())

        def keep(r):
            if status == "pending_feedback" and not r["pending_feedback"]:
                return False
            if status == "upcoming" and not (r["status"] == "scheduled" and r["starts_at"] >= now_iso):
                return False
            if status in INTERVIEW_STATUSES and r["status"] != status:
                return False
            if job_id and r["job_id"] != job_id:
                return False
            if round and r["round_name"] != round:
                return False
            if interviewer and interviewer.lower() not in (r["interviewers"] or "").lower():
                return False
            if q and q.lower() not in f"{r['candidate_name']} {r['job_title']} {r['interviewers']} {r['round_name']}".lower():
                return False
            if lo and r["starts_at"] < _iso(lo):
                return False
            if hi and r["starts_at"] > _iso(hi):
                return False
            return True

        rows = [r for r in rows if keep(r)]
        rows.sort(key=lambda r: r["starts_at"] or "")
        return {"items": rows[offset:offset + limit], "total": len(rows)}


@router.get("/interviews/stats")
def interview_stats(recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        jobs = _my_jobs(s, rec.id)
        ivs = s.exec(select(ScheduledInterview).where(ScheduledInterview.job_id.in_(list(jobs) or [-1]))).all()
        ai = _ai_rows(s, jobs)
        offers = s.exec(select(Offer).where(Offer.job_id.in_(list(jobs) or [-1]))).all()
        now = utc_now()
        w0, w1 = now - timedelta(days=30), now - timedelta(days=60)

        def window(dates):
            cur = sum(1 for d in dates if d and d >= w0)
            prev = sum(1 for d in dates if d and w1 <= d < w0)
            return _delta(cur, prev)

        active = [iv for iv in ivs if iv.status != "cancelled"]
        completed = [iv for iv in ivs if iv.status == "completed"]
        pending = [iv for iv in completed if not _loads(iv.feedback_json, {})]
        cancelled = [iv for iv in ivs if iv.status in ("cancelled", "no_show")]
        upcoming = [iv for iv in ivs if iv.status == "scheduled"]
        ai_dates = [_parse_dt(r["starts_at"]) for r in ai]
        selected_apps = {o.application_id: o.offer_date for o in offers if o.status not in ("draft", "withdrawn")}
        for iv in completed:
            fb = _loads(iv.feedback_json, {})
            if fb.get("recommendation") in ("hire", "strong_hire"):
                selected_apps.setdefault(iv.application_id, iv.updated_at)
        rounds = Counter(iv.round_name for iv in active)
        if ai:
            rounds["AI Interview"] = len(ai)
        return {
            "kpis": {
                "scheduled": {"value": len(active), "delta": window([iv.created_at for iv in active])},
                "completed": {"value": len(completed) + len(ai), "delta": window([iv.starts_at for iv in completed] + ai_dates)},
                "pending_feedback": {"value": len(pending), "delta": window([iv.starts_at for iv in pending])},
                "selected": {"value": len(selected_apps), "delta": window(list(selected_apps.values()))},
            },
            "analytics": {
                "completed": len(completed) + len(ai),
                "scheduled": len(upcoming),
                "pending_feedback": len(pending),
                "cancelled": len(cancelled),
                "ai_completed": len(ai),
                "total": len(ivs) + len(ai),
            },
            "rounds": [{"name": k, "count": v} for k, v in rounds.most_common()],
        }


def _ics_escape(v: str) -> str:
    return str(v or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r", "").replace("\n", "\\n")


def _ics_fold(line: str) -> str:
    out, cur = [], line.encode("utf-8")
    while len(cur) > 75:
        cut = 75 if not out else 74
        while cut > 0 and (cur[cut] & 0xC0) == 0x80:  # don't split a UTF-8 sequence
            cut -= 1
        out.append(cur[:cut].decode("utf-8"))
        cur = cur[cut:]
    out.append(cur.decode("utf-8"))
    return "\r\n ".join(out)


@router.get("/interviews/export.ics")
def export_ics(recruiter: str = Depends(get_current_recruiter)):
    """iCalendar file of all upcoming scheduled interviews (Google / Outlook import)."""
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        jobs = _my_jobs(s, rec.id)
        ivs = s.exec(select(ScheduledInterview).where(ScheduledInterview.job_id.in_(list(jobs) or [-1]),
                                                      ScheduledInterview.status == "scheduled",
                                                      ScheduledInterview.starts_at >= utc_now() - timedelta(hours=1))
                     .order_by(ScheduledInterview.starts_at)).all()
        cands = _candidates(s, [iv.candidate_id for iv in ivs])
        company = _company_name(s, rec)
        stamp = utc_now().strftime("%Y%m%dT%H%M%SZ")
        lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CoreLink//Recruiter Interviews//EN", "CALSCALE:GREGORIAN",
                 "METHOD:PUBLISH", f"X-WR-CALNAME:{_ics_escape(company + ' interviews')}"]
        for iv in ivs:
            job, c = jobs.get(iv.job_id), cands.get(iv.candidate_id, {})
            end = iv.starts_at + timedelta(minutes=iv.duration_min or 60)
            desc = [f"Candidate: {c.get('name')}", f"Role: {job.title if job else ''}", f"Round: {iv.round_name}",
                    f"Mode: {'Online' if iv.mode == 'online' else 'Onsite'}"]
            if iv.interviewers:
                desc.append(f"Interviewers: {iv.interviewers}")
            if iv.meeting_link:
                desc.append(f"Join: {iv.meeting_link}")
            ev = ["BEGIN:VEVENT", f"UID:interview-{iv.id}@corelink", f"DTSTAMP:{stamp}",
                  f"DTSTART:{iv.starts_at.strftime('%Y%m%dT%H%M%SZ')}", f"DTEND:{end.strftime('%Y%m%dT%H%M%SZ')}",
                  "SUMMARY:" + _ics_escape(f"{iv.round_name} — {c.get('name')} ({job.title if job else ''})"),
                  f"DESCRIPTION:{_ics_escape(chr(10).join(desc))}"]
            loc = iv.meeting_link if iv.mode == "online" else iv.location
            if loc:
                ev.append(f"LOCATION:{_ics_escape(loc)}")
            if iv.meeting_link:
                ev.append(f"URL:{iv.meeting_link}")
            ev += ["STATUS:CONFIRMED", "END:VEVENT"]
            lines += ev
        lines.append("END:VCALENDAR")
        body = "\r\n".join(_ics_fold(l) for l in lines) + "\r\n"
        return Response(content=body, media_type="text/calendar; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="corelink-interviews.ics"'})


@router.get("/interviews/{interview_id}")
def get_interview(interview_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        iv = _owned_interview(s, interview_id, rec.id)
        job = s.get(Job, iv.job_id)
        c = _candidates(s, [iv.candidate_id]).get(iv.candidate_id, {})
        app = s.get(Application, iv.application_id)
        others = s.exec(select(ScheduledInterview).where(ScheduledInterview.application_id == iv.application_id)
                        .order_by(ScheduledInterview.starts_at)).all()
        return {
            **_iv_dict(iv, job, c),
            "application": {"id": app.id, "status": app.status, "candidate_status": app.candidate_status,
                            "ats_score": app.ats_score, "final_score": app.final_score,
                            "interview_status": app.interview_status, "interview_eval_score": app.interview_eval_score} if app else None,
            "rounds": [{"id": o.id, "round_name": o.round_name, "starts_at": _iso(o.starts_at), "status": o.status,
                        "has_feedback": bool(_loads(o.feedback_json, {}))} for o in others],
        }


@router.patch("/interviews/{interview_id}")
def update_interview(interview_id: int, body: InterviewUpdate, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        iv = _owned_interview(s, interview_id, rec.id)
        job = s.get(Job, iv.job_id)
        data = body.model_dump(exclude_unset=True)
        rescheduled = False
        if iv.status == "cancelled" and data.get("status") not in ("scheduled",) and any(
                k in data for k in ("starts_at", "duration_min", "feedback")):
            raise HTTPException(status_code=409, detail="This interview was cancelled — set it back to scheduled first")
        new_start = _parse_dt(body.starts_at) if body.starts_at else iv.starts_at
        new_dur = body.duration_min or iv.duration_min
        time_changed = (body.starts_at and new_start != iv.starts_at) or (body.duration_min and new_dur != iv.duration_min)
        reopening = data.get("status") == "scheduled" and iv.status != "scheduled"
        if time_changed or reopening:
            _check_slot(s, iv.candidate_id, new_start, new_dur, exclude_id=iv.id)
            rescheduled = bool(body.starts_at and new_start != iv.starts_at)
            iv.starts_at, iv.duration_min = new_start, new_dur
        for k in ("round_name", "mode", "location", "interviewers"):
            if k in data and data[k] is not None:
                setattr(iv, k, data[k].strip() if isinstance(data[k], str) else data[k])
        if "meeting_link" in data:
            iv.meeting_link = data["meeting_link"] or None
        if iv.mode == "onsite":
            iv.meeting_link = iv.meeting_link if "meeting_link" in data else None
        old_status = iv.status
        if body.status:
            if body.status == "completed" and iv.starts_at > utc_now() + timedelta(minutes=5) and not body.feedback:
                raise HTTPException(status_code=422, detail="An interview can only be marked completed once it has started")
            iv.status = body.status
        if body.feedback:
            fb = body.feedback.model_dump()
            fb["by"] = recruiter
            fb["at"] = _iso(utc_now())
            iv.feedback_json = json.dumps(fb)
            iv.status = "completed"
        iv.updated_at = utc_now()
        s.add(iv)
        s.commit()
        s.refresh(iv)
        email_id = None
        if body.feedback:
            record_audit_event(session=s, event_type="human_interview_feedback", application_id=iv.application_id,
                               candidate_id=iv.candidate_id, job_id=iv.job_id, human_reviewer=recruiter,
                               human_action=body.feedback.recommendation,
                               final_recommendation=f"{iv.round_name}: rating {body.feedback.rating}/5, {body.feedback.recommendation.replace('_', ' ')}.")
        if iv.status == "cancelled" and old_status != "cancelled":
            record_audit_event(session=s, event_type="human_interview_cancelled", application_id=iv.application_id,
                               candidate_id=iv.candidate_id, job_id=iv.job_id, human_reviewer=recruiter, human_action="cancelled_interview")
            if body.notify:
                email_id = _interview_email(s, "cancel", iv, job, rec)
        elif rescheduled:
            record_audit_event(session=s, event_type="human_interview_rescheduled", application_id=iv.application_id,
                               candidate_id=iv.candidate_id, job_id=iv.job_id, human_reviewer=recruiter, human_action="rescheduled_interview",
                               final_recommendation=f"Moved to {_fmt_ist(iv.starts_at)}.")
            if body.notify:
                email_id = _interview_email(s, "reschedule", iv, job, rec)
        c = _candidates(s, [iv.candidate_id]).get(iv.candidate_id, {})
        return {**_iv_dict(iv, job, c), "email_id": email_id}


@router.delete("/interviews/{interview_id}")
def cancel_interview(interview_id: int, notify: bool = True, recruiter: str = Depends(get_current_recruiter)):
    """Cancels (soft-deletes) an interview; the row stays for history."""
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        iv = _owned_interview(s, interview_id, rec.id)
        if iv.status == "cancelled":
            raise HTTPException(status_code=409, detail="Interview is already cancelled")
        if iv.status == "completed":
            raise HTTPException(status_code=409, detail="A completed interview cannot be cancelled")
        job = s.get(Job, iv.job_id)
        iv.status, iv.updated_at = "cancelled", utc_now()
        s.add(iv)
        s.commit()
        s.refresh(iv)
        record_audit_event(session=s, event_type="human_interview_cancelled", application_id=iv.application_id,
                           candidate_id=iv.candidate_id, job_id=iv.job_id, human_reviewer=recruiter, human_action="cancelled_interview")
        email_id = _interview_email(s, "cancel", iv, job, rec) if notify else None
        return {"ok": True, "status": iv.status, "email_id": email_id}


# ═══════════════════════════════════════════════════════════════════════════
# Offers
# ═══════════════════════════════════════════════════════════════════════════

class OfferCreate(BaseModel):
    application_id: int
    ctc: str = Field(min_length=1, max_length=80)
    ctc_amount: Optional[float] = Field(default=None, ge=0, le=500)
    joining_date: Optional[str] = None
    letter_text: str = Field(default="", max_length=20000)
    notes: Optional[str] = Field(default=None, max_length=2000)
    send: bool = False


class OfferUpdate(BaseModel):
    ctc: Optional[str] = Field(default=None, min_length=1, max_length=80)
    ctc_amount: Optional[float] = Field(default=None, ge=0, le=500)
    joining_date: Optional[str] = None
    letter_text: Optional[str] = Field(default=None, max_length=20000)
    notes: Optional[str] = Field(default=None, max_length=2000)
    status: Optional[Literal["negotiation", "sent"]] = None


class OfferAction(BaseModel):
    notify: bool = True
    joining_date: Optional[str] = None
    reason: Optional[str] = Field(default=None, max_length=500)


class BulkOffers(BaseModel):
    action: Literal["remind", "withdraw", "joined", "resend"]
    ids: List[int] = Field(min_length=1, max_length=200)
    notify: bool = True


def _valid_date(v: Optional[str]) -> Optional[str]:
    if v in (None, ""):
        return None
    try:
        return date.fromisoformat(str(v)[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=422, detail="joining_date must be a date (YYYY-MM-DD)")


def _offer_dict(o: Offer, job: Optional[Job], c: dict) -> dict:
    return {
        "id": o.id, "application_id": o.application_id, "job_id": o.job_id, "job_title": job.title if job else None,
        "job_type": job.job_type if job else None, "job_location": job.location_text if job else None,
        "location_city": _city(job.location_text if job else None),
        "branch": c.get("branch") or (job.branch if job else None), "branch_label": _branch_label(c.get("branch") or (job.branch if job else None)),
        "candidate_id": o.candidate_id, "candidate_name": c.get("name"), "candidate_email": c.get("email"),
        "candidate_avatar": c.get("avatar_url"), "college": c.get("college"), "cgpa": c.get("cgpa"),
        "ctc": o.ctc, "ctc_amount": o.ctc_amount, "offer_date": _iso(o.offer_date), "joining_date": o.joining_date,
        "status": o.status, "notes": o.notes, "letter_text": o.letter_text, "responded_at": _iso(o.responded_at),
        "created_at": _iso(o.created_at), "updated_at": _iso(o.updated_at),
    }


def _offer_email(s: Session, kind: str, o: Offer, job: Job, rec: RecruiterUser) -> Optional[int]:
    c = _candidates(s, [o.candidate_id]).get(o.candidate_id, {})
    company = _company_name(s, rec)
    if kind == "send":
        mail = email_templates.offer_letter(c.get("name"), job.title, company, o.ctc, o.joining_date, o.letter_text or "")
    elif kind == "remind":
        mail = email_templates.offer_reminder(c.get("name"), job.title, company)
    else:
        mail = email_templates.offer_withdrawn(c.get("name"), job.title, company)
    return _send(c.get("email"), mail, f"offer_{kind}")


def _notify_recruiter_offer(s: Session, rec: RecruiterUser, o: Offer, job: Job, status_label: str):
    """Copy to the recruiter, honouring Settings → Notifications → Offer status."""
    if not recruiter_notification_enabled(s, rec.username, "offer_status"):
        return None
    u = _user(s, rec.username)
    c = _candidates(s, [o.candidate_id]).get(o.candidate_id, {})
    return _send(rec.username, email_templates.recruiter_offer_update(u.name if u else None, c.get("name") or "Candidate", job.title, status_label),
                 "recruiter_offer_update")


def _offer_audit(s: Session, o: Offer, event: str, recruiter: str, note: str = ""):
    record_audit_event(session=s, event_type=event, application_id=o.application_id, candidate_id=o.candidate_id,
                       job_id=o.job_id, human_reviewer=recruiter, human_action=event,
                       final_recommendation=f"Offer #{o.id}: {note}".strip())


def _send_offer(s: Session, o: Offer, job: Job, rec: RecruiterUser, recruiter: str, resend: bool = False) -> Optional[int]:
    if not (o.letter_text or "").strip():
        raise HTTPException(status_code=422, detail="Add the offer letter text before sending")
    o.status = "sent"
    o.offer_date = utc_now() if not resend else o.offer_date
    o.updated_at = utc_now()
    s.add(o)
    s.commit()
    s.refresh(o)
    _offer_audit(s, o, "offer_sent", recruiter, f"{'re-sent' if resend else 'sent'} ({o.ctc or 'CTC n/a'})")
    eid = _offer_email(s, "send", o, job, rec)
    _notify_recruiter_offer(s, rec, o, job, "sent")
    return eid


@router.get("/offers")
def list_offers(
    status: Optional[Literal["draft", "sent", "accepted", "declined", "negotiation", "withdrawn", "joined", "pending"]] = None,
    job_id: Optional[int] = None,
    q: Optional[str] = Query(default=None, max_length=100),
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = Query(default=500, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    recruiter: str = Depends(get_current_recruiter),
):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        jobs = _my_jobs(s, rec.id)
        offers = s.exec(select(Offer).where(Offer.job_id.in_(list(jobs) or [-1])).order_by(Offer.offer_date.desc())).all()
        cands = _candidates(s, [o.candidate_id for o in offers])
        lo, hi = _parse_day(start, "start"), _parse_day(end, "end", end=True)
        rows = []
        counts = Counter()
        for o in offers:
            if job_id and o.job_id != job_id:
                continue
            if lo and o.offer_date < lo or hi and o.offer_date > hi:
                continue
            d = _offer_dict(o, jobs.get(o.job_id), cands.get(o.candidate_id, {}))
            if q and q.lower() not in f"{d['candidate_name']} {d['candidate_email']} {d['job_title']} {d['college'] or ''}".lower():
                continue
            counts[o.status] += 1
            counts["all"] += 1
            if o.status in ("sent", "negotiation"):
                counts["pending"] += 1
            if status == "pending" and o.status not in ("sent", "negotiation"):
                continue
            if status and status != "pending" and o.status != status:
                continue
            rows.append(d)
        return {"items": rows[offset:offset + limit], "total": len(rows), "counts": dict(counts)}


def _pipeline(apps: List[Application], ivs: List[ScheduledInterview], offers: List[Offer]) -> List[dict]:
    interviewed = {iv.application_id for iv in ivs if iv.status != "cancelled"} | {a.id for a in apps if a.interview_status == "completed"}
    made = [o for o in offers if o.status != "draft"]
    return [
        {"key": "applications", "label": "Applications", "value": len(apps)},
        {"key": "shortlisted", "label": "Shortlisted", "value": sum(1 for a in apps if _shortlisted(a))},
        {"key": "interviews", "label": "Interviews", "value": len(interviewed)},
        {"key": "offers", "label": "Offers Made", "value": len(made)},
        {"key": "accepted", "label": "Offers Accepted", "value": sum(1 for o in made if o.status in ("accepted", "joined"))},
        {"key": "joined", "label": "Joined", "value": sum(1 for o in made if o.status == "joined")},
    ]


@router.get("/offers/stats")
def offer_stats(recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        jobs = _my_jobs(s, rec.id)
        ids = list(jobs) or [-1]
        offers = s.exec(select(Offer).where(Offer.job_id.in_(ids))).all()
        apps = s.exec(select(Application).where(Application.job_id.in_(ids))).all()
        ivs = s.exec(select(ScheduledInterview).where(ScheduledInterview.job_id.in_(ids))).all()
        now = utc_now()
        w0, w1 = now - timedelta(days=30), now - timedelta(days=60)
        made = [o for o in offers if o.status != "draft"]

        def win(items, when=lambda o: o.offer_date):
            cur = sum(1 for o in items if when(o) and when(o) >= w0)
            prev = sum(1 for o in items if when(o) and w1 <= when(o) < w0)
            return _delta(cur, prev)

        resp = lambda o: o.responded_at or o.updated_at  # noqa: E731
        accepted = [o for o in made if o.status in ("accepted", "joined")]
        status_counts = Counter(o.status for o in made)
        cands = _candidates(s, [o.candidate_id for o in offers])
        timeline = sorted([o for o in made if o.status in ("accepted", "joined") and o.joining_date], key=lambda o: o.joining_date)
        return {
            "kpis": {
                "made": {"value": len(made), "delta": win(made)},
                "accepted": {"value": len(accepted), "delta": win(accepted, resp)},
                "negotiation": {"value": status_counts.get("negotiation", 0), "delta": win([o for o in made if o.status == "negotiation"], resp)},
                "declined": {"value": status_counts.get("declined", 0), "delta": win([o for o in made if o.status == "declined"], resp)},
                "joined": {"value": status_counts.get("joined", 0), "delta": win([o for o in made if o.status == "joined"], resp)},
            },
            "status": {"accepted": len(accepted), "pending": status_counts.get("sent", 0) + status_counts.get("negotiation", 0),
                       "declined": status_counts.get("declined", 0), "withdrawn": status_counts.get("withdrawn", 0),
                       "drafts": sum(1 for o in offers if o.status == "draft"), "total": len(made)},
            "pipeline": _pipeline(apps, ivs, offers),
            "joining_timeline": [{"offer_id": o.id, "candidate_name": cands.get(o.candidate_id, {}).get("name"),
                                  "candidate_avatar": cands.get(o.candidate_id, {}).get("avatar_url"),
                                  "job_title": jobs[o.job_id].title if o.job_id in jobs else None,
                                  "joining_date": o.joining_date, "status": o.status} for o in timeline[:20]],
        }


@router.post("/offers", status_code=201)
def create_offer(body: OfferCreate, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        app, job = _owned_app(s, body.application_id, rec.id)
        existing = s.exec(select(Offer).where(Offer.application_id == app.id, Offer.status.in_(OPEN_OFFER_STATUSES))).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"This candidate already has an offer ({existing.status}) for this job — update it instead")
        o = Offer(application_id=app.id, job_id=job.id, candidate_id=app.candidate_id, recruiter_id=rec.id,
                  ctc=body.ctc.strip(), ctc_amount=body.ctc_amount, joining_date=_valid_date(body.joining_date),
                  letter_text=body.letter_text.strip() or None, notes=(body.notes or "").strip() or None, status="draft")
        s.add(o)
        s.commit()
        s.refresh(o)
        _offer_audit(s, o, "offer_created", recruiter, f"draft created ({o.ctc})")
        email_id = _send_offer(s, o, job, rec, recruiter) if body.send else None
        s.refresh(o)
        c = _candidates(s, [o.candidate_id]).get(o.candidate_id, {})
        return {**_offer_dict(o, job, c), "email_id": email_id}


def _timeline(s: Session, o: Offer) -> List[dict]:
    """Offer history from the audit log. Sorted on the full-precision timestamps
    (the serialised "at" only has second resolution, so sorting on it would
    misorder events that happen within the same second)."""
    events = s.exec(select(DecisionAuditLog).where(DecisionAuditLog.application_id == o.application_id)
                    .order_by(DecisionAuditLog.created_at, DecisionAuditLog.id)).all()
    tag = f"Offer #{o.id}:"
    labels = {"offer_created": "Draft created", "offer_sent": "Offer sent", "offer_updated": "Offer updated",
              "offer_withdrawn": "Offer withdrawn", "offer_joined": "Marked as joined", "offer_negotiation": "Negotiation started",
              "offer_reminder": "Reminder sent"}
    raw = []  # (datetime, seq, row)
    for e in events:
        if e.event_type in labels and (e.final_recommendation or "").startswith(tag):
            raw.append((e.created_at, len(raw), {"label": labels[e.event_type], "detail": (e.final_recommendation or "")[len(tag):].strip(),
                                                 "by": e.human_reviewer}))
        elif e.event_type in ("offer_accepted", "offer_declined", "offer_response"):
            raw.append((e.created_at, len(raw), {"label": e.event_type.replace("_", " ").capitalize(), "detail": e.final_recommendation or "",
                                                 "by": "candidate"}))
    if o.responded_at and o.status in ("accepted", "declined", "joined") and not any(r[2]["by"] == "candidate" for r in raw):
        verdict = "Offer accepted" if o.status in ("accepted", "joined") else "Offer declined"
        raw.append((o.responded_at, len(raw), {"label": verdict, "detail": "Response from the candidate", "by": "candidate"}))
    raw.sort(key=lambda r: (r[0] or datetime.min, r[1]))
    return [{"at": _iso(t), **row} for t, _, row in raw]


@router.get("/offers/{offer_id}")
def get_offer(offer_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        o = _owned_offer(s, offer_id, rec.id)
        c = _candidates(s, [o.candidate_id]).get(o.candidate_id, {})
        return {**_offer_dict(o, s.get(Job, o.job_id), c), "timeline": _timeline(s, o)}


@router.patch("/offers/{offer_id}")
def update_offer(offer_id: int, body: OfferUpdate, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        o = _owned_offer(s, offer_id, rec.id)
        if o.status in ("withdrawn", "declined", "joined"):
            raise HTTPException(status_code=409, detail=f"A {o.status} offer can no longer be edited")
        data = body.model_dump(exclude_unset=True)
        changes = []
        if data.get("ctc") is not None and data["ctc"].strip() != (o.ctc or ""):
            changes.append(f"CTC {o.ctc or '—'} → {data['ctc'].strip()}")
            o.ctc = data["ctc"].strip()
        if "ctc_amount" in data:
            o.ctc_amount = data["ctc_amount"]
        if "joining_date" in data:
            o.joining_date = _valid_date(data["joining_date"])
            changes.append(f"joining date {o.joining_date or 'cleared'}")
        if data.get("letter_text") is not None:
            o.letter_text = data["letter_text"].strip() or None
        if "notes" in data:
            o.notes = (data["notes"] or "").strip() or None
        event = "offer_updated"
        if body.status == "negotiation":
            if o.status not in ("sent", "negotiation", "accepted"):
                raise HTTPException(status_code=409, detail="Only a sent offer can move to negotiation")
            o.status, event = "negotiation", "offer_negotiation"
        elif body.status == "sent":
            if o.status not in ("negotiation", "sent"):
                raise HTTPException(status_code=409, detail="Use Send to send a draft offer")
            o.status = "sent"
        o.updated_at = utc_now()
        s.add(o)
        s.commit()
        s.refresh(o)
        _offer_audit(s, o, event, recruiter, "; ".join(changes) or ("moved to negotiation" if event == "offer_negotiation" else "details updated"))
        job = s.get(Job, o.job_id)
        if event == "offer_negotiation":
            _notify_recruiter_offer(s, rec, o, job, "in negotiation")
        c = _candidates(s, [o.candidate_id]).get(o.candidate_id, {})
        return _offer_dict(o, job, c)


@router.post("/offers/{offer_id}/send")
def send_offer(offer_id: int, recruiter: str = Depends(get_current_recruiter)):
    """Send a draft, or re-send a pending (sent / negotiation) offer letter."""
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        o = _owned_offer(s, offer_id, rec.id)
        if o.status not in ("draft", "sent", "negotiation"):
            raise HTTPException(status_code=409, detail=f"A {o.status} offer cannot be sent")
        job = s.get(Job, o.job_id)
        eid = _send_offer(s, o, job, rec, recruiter, resend=o.status != "draft")
        s.refresh(o)
        c = _candidates(s, [o.candidate_id]).get(o.candidate_id, {})
        return {**_offer_dict(o, job, c), "email_id": eid}


def _withdraw(s: Session, o: Offer, rec: RecruiterUser, recruiter: str, notify: bool, reason: Optional[str] = None):
    if o.status not in ("draft", "sent", "negotiation", "accepted"):
        raise HTTPException(status_code=409, detail=f"A {o.status} offer cannot be withdrawn")
    was_draft = o.status == "draft"
    o.status, o.updated_at = "withdrawn", utc_now()
    s.add(o)
    s.commit()
    s.refresh(o)
    _offer_audit(s, o, "offer_withdrawn", recruiter, reason or "withdrawn by recruiter")
    job = s.get(Job, o.job_id)
    eid = _offer_email(s, "withdraw", o, job, rec) if notify and not was_draft else None
    _notify_recruiter_offer(s, rec, o, job, "withdrawn")
    return eid


def _joined(s: Session, o: Offer, rec: RecruiterUser, recruiter: str, joining_date: Optional[str] = None):
    if o.status != "accepted":
        raise HTTPException(status_code=409, detail="Only an accepted offer can be marked as joined")
    o.status, o.updated_at = "joined", utc_now()
    if joining_date:
        o.joining_date = _valid_date(joining_date)
    elif not o.joining_date:
        o.joining_date = utc_now().date().isoformat()
    s.add(o)
    app = s.get(Application, o.application_id)
    if app:
        app.candidate_status = "final_result"
        s.add(app)
    s.commit()
    s.refresh(o)
    _offer_audit(s, o, "offer_joined", recruiter, f"joined on {o.joining_date}")
    _notify_recruiter_offer(s, rec, o, s.get(Job, o.job_id), "joined")


@router.post("/offers/{offer_id}/withdraw")
def withdraw_offer(offer_id: int, body: OfferAction = OfferAction(), recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        o = _owned_offer(s, offer_id, rec.id)
        eid = _withdraw(s, o, rec, recruiter, body.notify, body.reason)
        c = _candidates(s, [o.candidate_id]).get(o.candidate_id, {})
        return {**_offer_dict(o, s.get(Job, o.job_id), c), "email_id": eid}


@router.post("/offers/{offer_id}/joined")
def mark_joined(offer_id: int, body: OfferAction = OfferAction(), recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        o = _owned_offer(s, offer_id, rec.id)
        _joined(s, o, rec, recruiter, body.joining_date)
        c = _candidates(s, [o.candidate_id]).get(o.candidate_id, {})
        return _offer_dict(o, s.get(Job, o.job_id), c)


@router.delete("/offers/{offer_id}")
def delete_offer(offer_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        o = _owned_offer(s, offer_id, rec.id)
        if o.status != "draft":
            raise HTTPException(status_code=409, detail="Only draft offers can be deleted — withdraw a sent offer instead")
        s.delete(o)
        s.commit()
        return {"ok": True}


@router.post("/offers/bulk")
def bulk_offers(body: BulkOffers, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        results = []
        for oid in dict.fromkeys(body.ids):
            try:
                o = _owned_offer(s, oid, rec.id)
                job = s.get(Job, o.job_id)
                if body.action == "remind":
                    if o.status not in ("sent", "negotiation"):
                        raise HTTPException(status_code=409, detail="not awaiting a response")
                    _offer_email(s, "remind", o, job, rec)
                    _offer_audit(s, o, "offer_reminder", recruiter, "reminder emailed")
                elif body.action == "resend":
                    if o.status not in ("draft", "sent", "negotiation"):
                        raise HTTPException(status_code=409, detail=f"a {o.status} offer cannot be sent")
                    _send_offer(s, o, job, rec, recruiter, resend=o.status != "draft")
                elif body.action == "withdraw":
                    _withdraw(s, o, rec, recruiter, body.notify)
                else:
                    _joined(s, o, rec, recruiter)
                results.append({"id": oid, "ok": True})
            except HTTPException as e:
                results.append({"id": oid, "ok": False, "error": e.detail})
        return {"results": results, "ok": sum(1 for r in results if r["ok"]), "failed": sum(1 for r in results if not r["ok"])}


# ═══════════════════════════════════════════════════════════════════════════
# Analytics
# ═══════════════════════════════════════════════════════════════════════════

def _buckets(lo: datetime, hi: datetime, granularity: str):
    out = []
    if granularity == "week":
        cur = lo - timedelta(days=lo.weekday())
        cur = cur.replace(hour=0, minute=0, second=0, microsecond=0)
        while cur <= hi and len(out) < 60:
            nxt = cur + timedelta(days=7)
            out.append((cur, nxt, cur.strftime("%d %b")))
            cur = nxt
    else:
        cur = lo.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        while cur <= hi and len(out) < 36:
            nxt = (cur.replace(day=28) + timedelta(days=4)).replace(day=1)
            out.append((cur, nxt, cur.strftime("%b") if lo.year == hi.year else cur.strftime("%b %y")))
            cur = nxt
    return out


def _period_metrics(apps, ivs, offers, ai_done, lo, hi):
    in_p = lambda d: d is not None and lo <= d <= hi  # noqa: E731
    p_apps = [a for a in apps if in_p(a.applied_at)]
    conducted = [iv for iv in ivs if iv.status == "completed" and in_p(iv.starts_at)]
    ai_n = sum(1 for d in ai_done.values() if in_p(d))
    made = [o for o in offers if o.status != "draft" and in_p(o.offer_date)]
    hired = [o for o in offers if o.status in ("accepted", "joined") and in_p(o.responded_at or o.updated_at)]
    joined = [o for o in hired if o.status == "joined"]
    return {"apps": p_apps, "shortlisted": [a for a in p_apps if _shortlisted(a)], "conducted": len(conducted) + ai_n,
            "made": made, "hired": hired, "joined": joined}


@router.get("/analytics")
def analytics(
    start: Optional[str] = None,
    end: Optional[str] = None,
    granularity: Literal["month", "week"] = "month",
    group: Literal["role", "branch"] = "role",
    job_id: Optional[int] = None,
    recruiter: str = Depends(get_current_recruiter),
):
    """Every block of the Analytics page in one call. Period defaults to the
    last 90 days; KPIs compare against the previous period of equal length."""
    with Session(engine) as s:
        rec = _rec(s, recruiter)
        jobs = _my_jobs(s, rec.id)
        now = utc_now()
        hi = _parse_day(end, "end", end=True) or now
        lo = _parse_day(start, "start") or (hi - timedelta(days=90)).replace(hour=0, minute=0, second=0, microsecond=0)
        if lo > hi:
            raise HTTPException(status_code=422, detail="start must be before end")
        if (hi - lo).days > 3 * 366:
            raise HTTPException(status_code=422, detail="Choose a range of at most 3 years")
        if job_id and job_id not in jobs:
            raise HTTPException(status_code=404, detail="Job not found")
        ids = list(jobs) or [-1]
        apps = s.exec(select(Application).where(Application.job_id.in_(ids))).all()
        ivs = s.exec(select(ScheduledInterview).where(ScheduledInterview.job_id.in_(ids))).all()
        offers = s.exec(select(Offer).where(Offer.job_id.in_(ids))).all()
        ai_apps = [a for a in apps if a.interview_status == "completed"]
        ai_done = {}
        if ai_apps:
            for ses in s.exec(select(InterviewSession).where(InterviewSession.application_id.in_([a.id for a in ai_apps]))).all():
                t = ses.completed_at or ses.started_at
                if t and (ses.application_id not in ai_done or t > ai_done[ses.application_id]):
                    ai_done[ses.application_id] = t
            for a in ai_apps:
                ai_done.setdefault(a.id, a.applied_at)
        app_by_id = {a.id: a for a in apps}

        span = hi - lo
        plo, phi = lo - span - timedelta(microseconds=1), lo - timedelta(microseconds=1)
        cur = _period_metrics(apps, ivs, offers, ai_done, lo, hi)
        prev = _period_metrics(apps, ivs, offers, ai_done, plo, phi)

        def tth(hired):
            days = []
            for o in hired:
                a = app_by_id.get(o.application_id)
                end_t = o.responded_at or o.updated_at
                if a and a.applied_at and end_t and end_t >= a.applied_at:
                    days.append((end_t - a.applied_at).total_seconds() / 86400)
            return days

        cur_tth, prev_tth = tth(cur["hired"]), tth(prev["hired"])
        avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else None  # noqa: E731
        kpis = [
            {"key": "applications", "label": "Total Applications", "value": len(cur["apps"]), "prev": len(prev["apps"])},
            {"key": "shortlisted", "label": "Shortlisted", "value": len(cur["shortlisted"]), "prev": len(prev["shortlisted"])},
            {"key": "interviews", "label": "Interviews Conducted", "value": cur["conducted"], "prev": prev["conducted"]},
            {"key": "offers", "label": "Offers Made", "value": len(cur["made"]), "prev": len(prev["made"])},
            {"key": "hired", "label": "Hired / Joined", "value": len(cur["hired"]), "prev": len(prev["hired"])},
            {"key": "time_to_hire", "label": "Avg. Time to Hire", "value": avg(cur_tth), "prev": avg(prev_tth), "unit": "days", "lower_is_better": True},
        ]
        for k in kpis:
            k["delta"] = _delta(k["value"] or 0, k["prev"] or 0) if (k["value"] is not None and k["prev"] is not None) else None

        # Trend
        trend = [{"label": lab, "start": _iso(a), "value": sum(1 for x in cur["apps"] if a <= x.applied_at < b)}
                 for a, b, lab in _buckets(lo, hi, granularity)]

        # Pipeline conversion (applications in period → their furthest stage)
        p_ids = {a.id for a in cur["apps"]}
        interviewed = {iv.application_id for iv in ivs if iv.status != "cancelled"} | set(ai_done)
        made_apps = {o.application_id for o in offers if o.status != "draft"}
        hired_apps = {o.application_id for o in offers if o.status in ("accepted", "joined")}
        n = len(p_ids)
        pipeline = []
        for key, label, val in (("applications", "Applications", n),
                                ("shortlisted", "Shortlisted", len(cur["shortlisted"])),
                                ("interviews", "Interviews", len(p_ids & interviewed)),
                                ("offers", "Offers Made", len(p_ids & made_apps)),
                                ("hired", "Hired / Joined", len(p_ids & hired_apps))):
            pipeline.append({"key": key, "label": label, "value": val, "pct": round(val * 100 / n) if n else 0})

        # Time to hire grouped (by job role or branch) — all-time hires so the chart is meaningful
        groups = defaultdict(list)
        for o in offers:
            if o.status not in ("accepted", "joined"):
                continue
            a, j = app_by_id.get(o.application_id), jobs.get(o.job_id)
            end_t = o.responded_at or o.updated_at
            if not a or not j or not end_t or not (lo <= end_t <= hi):
                continue
            key = j.title if group == "role" else _branch_label(j.branch)
            groups[key].append(max(0.0, (end_t - a.applied_at).total_seconds() / 86400))
        time_to_hire = sorted(({"label": k, "value": round(sum(v) / len(v), 1), "hires": len(v)} for k, v in groups.items()),
                              key=lambda r: -r["hires"])[:8]

        # Branch distribution (candidate branch, fallback job branch)
        cands = _candidates(s, [a.candidate_id for a in cur["apps"]])
        branch_c = Counter(_branch_label(cands.get(a.candidate_id, {}).get("branch") or jobs[a.job_id].branch) for a in cur["apps"])
        branches = [{"label": k, "value": v} for k, v in branch_c.most_common()]
        if len(branches) > 7:
            branches = branches[:6] + [{"label": "Others", "value": sum(b["value"] for b in branches[6:])}]
        college_c = Counter((cands.get(a.candidate_id, {}).get("college") or "Not specified") for a in cur["apps"])
        colleges = [{"label": k, "value": v} for k, v in college_c.most_common()]

        # Offer acceptance (offers made in period)
        oc = Counter(o.status for o in cur["made"])
        acc = oc.get("accepted", 0) + oc.get("joined", 0)
        decided = acc + oc.get("declined", 0)
        acceptance = {"accepted": acc, "declined": oc.get("declined", 0), "negotiation": oc.get("negotiation", 0),
                      "pending": oc.get("sent", 0), "withdrawn": oc.get("withdrawn", 0), "total": len(cur["made"]),
                      "rate": round(acc * 100 / len(cur["made"])) if cur["made"] else 0,
                      "decided_rate": round(acc * 100 / decided) if decided else 0}

        # Hiring by location (job city) — applications in period, optional job filter
        loc_apps = [a for a in cur["apps"] if not job_id or a.job_id == job_id]
        loc_c = Counter(_city(jobs[a.job_id].location_text) for a in loc_apps)
        locations = [{"label": k, "value": v} for k, v in loc_c.most_common()]
        if len(locations) > 6:
            locations = locations[:5] + [{"label": "Other", "value": sum(x["value"] for x in locations[5:])}]

        sources = [{"label": "CoreLink", "value": len(cur["apps"])}]

        # Insights
        insights = []
        a_cur, a_prev = len(cur["apps"]), len(prev["apps"])
        if a_cur or a_prev:
            d = _delta(a_cur, a_prev)
            insights.append({"tone": "up" if a_cur >= a_prev else "down",
                             "title": f"Applications {'increased' if a_cur >= a_prev else 'decreased'} by {abs(d)}%",
                             "text": f"You received {a_cur} applications this period vs {a_prev} in the previous period."})
        ct, pt = avg(cur_tth), avg(prev_tth)
        if ct is not None and pt:
            d = _delta(ct, pt)
            insights.append({"tone": "up" if ct <= pt else "down",
                             "title": f"Time to hire {'reduced' if ct <= pt else 'increased'} by {abs(d)}%",
                             "text": f"Average time to hire is {ct:g} days, {'down' if ct <= pt else 'up'} from {pt:g} days."})
        elif ct is not None:
            insights.append({"tone": "info", "title": f"Average time to hire is {ct:g} days",
                             "text": f"Based on {len(cur_tth)} accepted offer{'s' if len(cur_tth) != 1 else ''} in this period."})
        if branches and a_cur:
            top = branches[0]
            insights.append({"tone": "info", "title": f"{top['label']} Engineering has highest interest" if top["label"] not in ("Others", "Other") else "Applications are spread across branches",
                             "text": f"{round(top['value'] * 100 / a_cur)}% of total applications are from {top['label']} candidates."})
        if len(insights) < 3 and cur["made"]:
            insights.append({"tone": "info", "title": f"Offer acceptance rate is {acceptance['rate']}%",
                             "text": f"{acc} of {len(cur['made'])} offers made in this period were accepted."})
        if len(insights) < 3:
            shortlist_rate = round(len(cur["shortlisted"]) * 100 / a_cur) if a_cur else 0
            insights.append({"tone": "info", "title": f"{shortlist_rate}% of applicants shortlisted",
                             "text": f"{len(cur['shortlisted'])} of {a_cur} applications in this period reached the shortlist."})

        return {
            "range": {"start": _iso(lo), "end": _iso(hi), "prev_start": _iso(plo), "prev_end": _iso(phi), "granularity": granularity, "group": group},
            "kpis": kpis, "trend": trend, "pipeline": pipeline, "time_to_hire": time_to_hire,
            "branches": branches, "colleges": colleges, "offer_acceptance": acceptance,
            "locations": locations, "sources": sources, "insights": insights[:3],
            "jobs": [{"id": j.id, "title": j.title} for j in sorted(jobs.values(), key=lambda j: j.title)],
        }


# ═══════════════════════════════════════════════════════════════════════════
# Account settings
# ═══════════════════════════════════════════════════════════════════════════

class AccountUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    phone: Optional[str] = Field(default=None, max_length=20)
    job_title: Optional[str] = Field(default=None, max_length=80)
    department: Optional[str] = Field(default=None, max_length=80)
    location: Optional[str] = Field(default=None, max_length=120)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        if v and not re.fullmatch(r"\+?[0-9][0-9 \-]{6,18}", v.strip()):
            raise ValueError("enter a valid phone number")
        return v.strip() if v else v


class NotificationPrefs(BaseModel):
    new_applications: Optional[bool] = None
    interview_updates: Optional[bool] = None
    offer_status: Optional[bool] = None
    weekly_report: Optional[bool] = None
    product_updates: Optional[bool] = None


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


def _account_dict(s: Session, rec: RecruiterUser, u: User) -> dict:
    st = _settings(u)
    prof = st.get("profile", {})
    rp = s.exec(select(RecruiterProfile).where(RecruiterProfile.recruiter_id == rec.id)).first()
    return {
        "name": u.name, "email": u.email, "phone": u.phone, "job_title": prof.get("job_title"),
        "department": prof.get("department"), "location": prof.get("location"),
        "avatar_url": _media(rp.avatar_path) if rp else None, "last_login_at": _iso(u.last_login_at),
        "created_at": _iso(u.created_at), "password_changed_at": st.get("security", {}).get("password_changed_at"),
        "notifications": {**NOTIFICATION_DEFAULTS, **st.get("notifications", {})},
    }


def _me(s: Session, email: str):
    rec = _rec(s, email)
    u = _user(s, email)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return rec, u


@router.get("/account")
def get_account(recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec, u = _me(s, recruiter)
        return _account_dict(s, rec, u)


@router.put("/account")
def update_account(body: AccountUpdate, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec, u = _me(s, recruiter)
        data = body.model_dump(exclude_unset=True)
        if data.get("name") is not None:
            u.name = data["name"].strip()
        if "phone" in data:
            u.phone = data["phone"] or None
        st = _settings(u)
        prof = st.get("profile", {})
        for k in ("job_title", "department", "location"):
            if k in data:
                prof[k] = (data[k] or "").strip() or None
        st["profile"] = prof
        u.settings_json = json.dumps(st)
        s.add(u)
        s.commit()
        s.refresh(u)
        return _account_dict(s, rec, u)


@router.put("/account/notifications")
def update_notifications(body: NotificationPrefs, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec, u = _me(s, recruiter)
        st = _settings(u)
        n = {**NOTIFICATION_DEFAULTS, **st.get("notifications", {})}
        for k, v in body.model_dump(exclude_unset=True).items():
            if v is not None:
                n[k] = bool(v)
        st["notifications"] = n
        u.settings_json = json.dumps(st)
        s.add(u)
        s.commit()
        return {"notifications": n}


@router.post("/account/password")
def change_password(body: PasswordChange, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as s:
        rec, u = _me(s, recruiter)
        if not verify_password(body.current_password, u.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        if body.new_password == body.current_password:
            raise HTTPException(status_code=400, detail="The new password must be different from the current one")
        if not (re.search(r"[A-Za-z]", body.new_password) and re.search(r"\d", body.new_password)):
            raise HTTPException(status_code=422, detail="Use at least 8 characters with letters and numbers")
        new_hash = hash_password(body.new_password)
        u.password_hash = new_hash
        rec.password_hash = new_hash
        st = _settings(u)
        st.setdefault("security", {})["password_changed_at"] = _iso(utc_now())
        u.settings_json = json.dumps(st)
        s.add(u)
        s.add(rec)
        s.commit()
        return {"ok": True, "password_changed_at": st["security"]["password_changed_at"]}
