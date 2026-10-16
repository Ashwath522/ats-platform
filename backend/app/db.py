import os
from sqlalchemy import UniqueConstraint, inspect, text
from datetime import datetime, timezone
from typing import Optional

from sqlmodel import SQLModel, Field, create_engine, Session

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))  # -> backend/
DATA_DIR = os.environ.get("ATS_DATA_DIR", os.path.join(BASE_DIR, "data"))
os.makedirs(DATA_DIR, exist_ok=True)


def utc_now() -> datetime:
    """Drop-in replacement for the deprecated datetime.utcnow(). Returns a
    naive UTC datetime (matching what's already stored throughout the DB and
    what SQLite expects) while using the non-deprecated timezone-aware API
    internally, then stripping tzinfo before returning - swapping straight to
    datetime.now(timezone.utc) without this step would return an AWARE
    datetime, which breaks comparisons against the naive ones already stored."""
    return datetime.now(timezone.utc).replace(tzinfo=None)

def _clean_database_url(raw: Optional[str]) -> Optional[str]:
    """Normalise a DATABASE_URL pasted into a hosting dashboard.

    Tolerates the usual copy/paste mistakes (surrounding quotes or spaces, a
    leading ``DATABASE_URL=`` or ``psql``, line breaks, ``postgres://``
    scheme) and adds ``sslmode=require`` for hosted Postgres. Raises a clear
    error - without echoing the password - when the value still isn't a
    usable Postgres URL (e.g. the ``[YOUR-PASSWORD]`` placeholder was left in).
    """
    if not raw:
        return None
    url = "".join(raw.split())  # drop spaces / line breaks anywhere
    for prefix in ("DATABASE_URL=", "psql"):
        if url.startswith(prefix):
            url = url[len(prefix):]
    url = url.strip("'\"<>\\")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if not url.startswith(("postgresql://", "postgresql+psycopg2://", "sqlite:")):
        raise RuntimeError("DATABASE_URL must start with postgresql:// - copy the full connection string from your database provider")
    if "[YOUR-PASSWORD]" in url or "YOUR-PASSWORD" in url:
        raise RuntimeError("DATABASE_URL still contains the [YOUR-PASSWORD] placeholder - replace it with the real (URL-encoded) database password")
    host_part = url.split("@")[-1]
    if url.startswith("postgresql") and "sslmode=" not in url and not host_part.startswith(("localhost", "127.0.0.1")):
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return url


DATABASE_URL = _clean_database_url(os.environ.get("DATABASE_URL"))
_IS_POOLER = bool(DATABASE_URL and "pooler.supabase.com" in DATABASE_URL)
if DATABASE_URL:
    # pool_pre_ping/pool_recycle: serverless Postgres (Neon) suspends idle
    # compute and drops connections; without these the first request after
    # idle fails with "SSL connection has been closed unexpectedly".
    engine = create_engine(
        DATABASE_URL,
        echo=False,
        pool_pre_ping=True,
        pool_recycle=280,
        # Supabase's free session pooler allows only a few client
        # connections, so keep the pool small there.
        pool_size=int(os.environ.get("DB_POOL_SIZE", "3" if _IS_POOLER else "5")),
        max_overflow=int(os.environ.get("DB_MAX_OVERFLOW", "2" if _IS_POOLER else "5")),
    )
else:
    DB_PATH = os.path.join(DATA_DIR, "ats.db")
    engine = create_engine(
        f"sqlite:///{DB_PATH}",
        echo=False,
        connect_args={"check_same_thread": False},
    )



class Company(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    owner_username: Optional[str] = Field(default=None, index=True)  # only this recruiter can edit/delete this company
    created_at: datetime = Field(default_factory=utc_now)


class JobDescription(SQLModel, table=True):
    """A company can update its title/JD over time; we keep the current one per company."""
    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="company.id")
    title: str
    description: str
    apply_url: Optional[str] = None
    vector_doc_id: str  # id used in the chroma "jobs" collection
    updated_at: datetime = Field(default_factory=utc_now)


class Resume(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    filename: str
    file_path: str
    vector_doc_id: str  # id used in the chroma "resumes" collection
    content_hash: str = Field(index=True)  # sha256 of extracted text, used for dedup
    uploaded_at: datetime = Field(default_factory=utc_now)


class AnalysisCache(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    cache_key: str = Field(index=True, unique=True)
    payload_json: str
    created_at: datetime = Field(default_factory=utc_now)


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = ""
    email: str = Field(index=True, unique=True)
    phone: Optional[str] = None
    role: str = Field(index=True)  # candidate | recruiter | admin
    password_hash: str
    email_verified: bool = Field(default=False)
    created_at: datetime = Field(default_factory=utc_now)
    status: Optional[str] = Field(default="active", index=True)  # active | suspended
    last_login_at: Optional[datetime] = None
    settings_json: Optional[str] = None  # per-user notification / privacy prefs (recruiter & admin)


class RecruiterRequest(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    email: str = Field(index=True)
    phone: str
    status: str = Field(default="pending", index=True)  # pending | approved | rejected
    submitted_at: datetime = Field(default_factory=utc_now)
    decided_at: Optional[datetime] = None
    # Company / business verification (see services/recruiter_verification.py)
    company_name: Optional[str] = None
    company_website: Optional[str] = None
    designation: Optional[str] = None
    gstin: Optional[str] = None
    cin: Optional[str] = None
    linkedin_url: Optional[str] = None
    verification_score: Optional[int] = None
    verification_verdict: Optional[str] = None  # verified | review | high_risk
    verification_json: Optional[str] = None


class EmailToken(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True)
    purpose: str = Field(index=True)  # signup_otp | password_reset
    token_hash: str
    expires_at: datetime
    used_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)


class RecruiterUser(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str
    created_at: datetime = Field(default_factory=utc_now)


# ─── New models for the portal expansion ───────────────────────────────────────

class CandidateUser(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str
    created_at: datetime = Field(default_factory=utc_now)
    status: Optional[str] = Field(default="active", index=True)  # active | suspended
    last_login_at: Optional[datetime] = None


class CandidateProfile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    candidate_id: int = Field(foreign_key="candidateuser.id", unique=True, index=True)
    headline: str = ""
    bio: str = ""
    branch: Optional[str] = None      # candidate's target core branch
    skills_json: str = "[]"           # JSON array of skill strings
    experience_json: str = "[]"       # JSON array of {title, company, start, end, description}
    education_json: str = "[]"        # JSON array of {level, institution, field_of_study, start_year, end_year, grade}
    certifications_json: str = "[]"   # JSON array of {name, issuing_organization, issue_date, credential_url, file_path}
    avatar_path: Optional[str] = None
    cover_photo_path: Optional[str] = None
    resume_id: Optional[int] = Field(default=None, foreign_key="resume.id")
    project_description: Optional[str] = None
    project_summary: Optional[str] = None
    project_general_score: Optional[int] = None
    project_score: Optional[float] = None
    candidate_status: Optional[str] = "applied"  # applied | shortlisted | not_selected | interview | final_result
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    # Optional EEO self-identification — candidate-controlled, never exposed to recruiters
    gender: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    # --- Student portal (v2 UI) ---
    full_name: Optional[str] = None
    college: Optional[str] = None
    degree: Optional[str] = None
    grad_year: Optional[int] = None
    current_year: Optional[str] = None
    cgpa: Optional[float] = None
    location_text: Optional[str] = None
    date_of_birth: Optional[str] = None
    portfolio_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    interests_json: Optional[str] = None        # ["Design & Manufacturing", ...]
    achievements_json: Optional[str] = None     # [{title, year, issuer}]
    skill_levels_json: Optional[str] = None     # {"SolidWorks": "Advanced", ...}
    preferences_json: Optional[str] = None      # {roles, locations, job_types, salary, relocate}
    privacy_json: Optional[str] = None          # {visibility, show_contact, allow_messages, share_profile}
    notifications_json: Optional[str] = None    # {email_updates, interview_alerts, job_recommendations, newsletter}
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class RecruiterProfile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    recruiter_id: int = Field(foreign_key="recruiteruser.id", unique=True, index=True)
    headline: str = ""
    bio: str = ""
    avatar_path: Optional[str] = None
    cover_photo_path: Optional[str] = None
    company_name: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Post(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    candidate_id: int = Field(foreign_key="candidateuser.id", index=True)
    content: str
    created_at: datetime = Field(default_factory=utc_now)


class RecruiterPost(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    recruiter_id: int = Field(foreign_key="recruiteruser.id", index=True)
    content: str
    created_at: datetime = Field(default_factory=utc_now)


class Job(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    recruiter_id: int = Field(foreign_key="recruiteruser.id", index=True)
    company_id: Optional[int] = Field(default=None, foreign_key="company.id")
    title: str
    description: str
    branch: Optional[str] = None      # branch this job belongs to
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    currency: str = "INR"
    location_text: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    requirements: str = ""            # free-text or comma-separated skills
    remote_type: str = "onsite"       # "remote" | "onsite" | "hybrid"
    status: str = "open"              # "open" | "closed" | "draft" | "paused" | "archived"
    job_type: Optional[str] = None    # internship | full-time | part-time | apprenticeship
    experience_level: Optional[str] = None   # fresher | 0-2 | 2-5 | 5+
    openings: Optional[int] = None
    target_colleges_json: Optional[str] = None
    eligibility: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Application(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    candidate_id: int = Field(foreign_key="candidateuser.id", index=True)
    job_id: int = Field(foreign_key="job.id", index=True)
    resume_id: Optional[int] = Field(default=None, foreign_key="resume.id")
    ats_score: Optional[int] = None
    matched_skills_json: str = "[]"
    missing_skills_json: str = "[]"
    status: str = "ats_check"           # "ats_check" | "repo_verification" | "automated_interview" | "shortlisted" | "rejected"
    applied_at: datetime = Field(default_factory=utc_now)
    baseline_ats_score: Optional[int] = None
    llm_used: bool = Field(default=False)
    project_score: Optional[float] = None
    final_score: Optional[float] = None
    project_summary: Optional[str] = None
    project_fit: Optional[str] = None
    risk_notes: Optional[str] = None
    priority_level: Optional[str] = None
    skills_matched_detail: Optional[str] = None
    skills_gap_detail: Optional[str] = None
    api_used: Optional[str] = None
    parse_method: Optional[str] = None
    repo_match_score: Optional[int] = None
    repo_match_reasoning: Optional[str] = None
    suitability_verdict: Optional[str] = None
    ai_recommendation: Optional[str] = None
    interview_id: Optional[int] = None
    interview_status: Optional[str] = "locked"  # locked | unlocked | in_progress | completed
    interview_risk_score: Optional[int] = None
    interview_risk_level: Optional[str] = None  # low | medium | high
    interview_eval_score: Optional[int] = None
    interview_recommendation: Optional[str] = None
    interview_evidence_url: Optional[str] = None
    interview_transcript_json: Optional[str] = None
    pending_human_review: bool = Field(default=False)
    human_reviewer: Optional[str] = None
    human_decision_notes: Optional[str] = None
    candidate_status: Optional[str] = "applied"  # applied | shortlisted | not_selected | interview | final_result


class DecisionAuditLog(SQLModel, table=True):
    """
    Append-only audit log for all AI scoring, evaluation, and hiring decisions.
    Required for compliance with automated employment decision regulations
    (e.g., NYC LL144, EU AI Act high-risk classification).
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    application_id: Optional[int] = Field(default=None, foreign_key="application.id", index=True)
    candidate_id: Optional[int] = Field(default=None, foreign_key="candidateuser.id", index=True)
    job_id: Optional[int] = Field(default=None, foreign_key="job.id", index=True)
    event_type: str = Field(index=True)  # ats_score | project_score | interview_evaluation | recruiter_confirmation | candidate_deletion_request | data_retention_purge
    ats_score: Optional[int] = None
    baseline_ats_score: Optional[int] = None
    semantic_similarity: Optional[float] = None
    keyword_coverage: Optional[float] = None
    matched_skills_json: str = "[]"
    missing_skills_json: str = "[]"
    project_score: Optional[float] = None
    final_score: Optional[float] = None
    risk_score: Optional[int] = None
    risk_level: Optional[str] = None
    llm_providers_consulted: Optional[str] = None  # JSON array e.g. ["groq", "gemini"]
    raw_verdicts_json: Optional[str] = None
    final_recommendation: Optional[str] = None
    human_reviewer: Optional[str] = None
    human_action: Optional[str] = None  # confirmed_shortlist | confirmed_reject | overridden | deleted
    human_confirmed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)


class DiscoveredSkill(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    term: str = Field(index=True, unique=True)
    branch: Optional[str] = Field(default=None, index=True)
    first_seen_at: datetime = Field(default_factory=utc_now)
    occurrence_count: int = Field(default=1)


class Suggestion(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    text: str
    submitted_at: datetime = Field(default_factory=utc_now)
    submitter: Optional[str] = None



class VectorDoc(SQLModel, table=True):
    """Database-backed vector store (used instead of ChromaDB on hosts with an
    ephemeral disk, e.g. Render free tier + Neon Postgres)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    collection: str = Field(index=True)
    doc_id: str = Field(index=True)
    document: str = ""
    metadata_json: str = "{}"
    embedding_json: str = "[]"
    updated_at: datetime = Field(default_factory=utc_now)


class MediaBlob(SQLModel, table=True):
    """Durable copy of uploaded media (avatars, covers, certificates) so files
    survive container restarts on hosts without a persistent disk."""
    id: Optional[int] = Field(default=None, primary_key=True)
    path: str = Field(index=True, unique=True)
    content_type: str = "application/octet-stream"
    data: bytes = Field(default=b"")
    created_at: datetime = Field(default_factory=utc_now)

class PlatformSetting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value_json: str
    updated_at: datetime = Field(default_factory=utc_now)


class EmailLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    to_email: str = Field(index=True)
    subject: str
    category: str = Field(default="general", index=True)
    provider: Optional[str] = None
    status: str = Field(default="queued", index=True)  # queued | sent | failed | logged
    attempts: int = 0
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)
    sent_at: Optional[datetime] = None


class InterviewSession(SQLModel, table=True):
    """One live AI interview run for an application."""
    id: Optional[int] = Field(default=None, primary_key=True)
    application_id: Optional[int] = Field(default=None, foreign_key="application.id", index=True)
    candidate_id: int = Field(index=True)
    job_id: Optional[int] = Field(default=None, index=True)
    mode: Optional[str] = Field(default="application", index=True)  # application | practice
    practice_kind: Optional[str] = None   # technical | domain | hr | mock
    practice_topic: Optional[str] = None
    status: str = Field(default="active", index=True)  # active | completed | abandoned
    plan_json: str = "[]"          # planned base questions
    transcript_json: str = "[]"    # [{role, text, kind, q_index, ts}]
    question_index: int = 0
    followups_on_current: int = 0
    provider: Optional[str] = None
    latency_json: str = "[]"       # client + server latency samples
    eval_json: Optional[str] = None
    started_at: datetime = Field(default_factory=utc_now)
    completed_at: Optional[datetime] = None


class ProctorSnapshot(SQLModel, table=True):
    """Evidence JPEG captured on-device when a possible rule break is detected
    during a real (non-practice) AI interview, plus one baseline identity
    frame at the start. Bytes live in the DB (like MediaBlob) so they survive
    restarts on free-tier hosts; size is capped (≤150 KB, ≤32 per session) and
    rows are purged after PROCTOR_RETENTION_DAYS."""
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="interviewsession.id", index=True)
    application_id: Optional[int] = Field(default=None, index=True)
    candidate_id: int = Field(index=True)
    job_id: Optional[int] = Field(default=None, index=True)
    kind: str = Field(default="event")          # baseline | event
    event_type: str = Field(default="baseline", index=True)
    severity: str = Field(default="info")       # info | medium | high
    label: Optional[str] = None
    client_ts: Optional[datetime] = None
    width: Optional[int] = None
    height: Optional[int] = None
    size_bytes: int = 0
    content_type: str = "image/jpeg"
    data: bytes = Field(default=b"")
    created_at: datetime = Field(default_factory=utc_now, index=True)


class ProctorEvent(SQLModel, table=True):
    """Timeline of on-device proctoring events for a real AI interview."""
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="interviewsession.id", index=True)
    application_id: Optional[int] = Field(default=None, index=True)
    candidate_id: int = Field(index=True)
    event_type: str = Field(index=True)
    severity: str = "low"                        # low | medium | high
    client_ts: Optional[datetime] = None
    details_json: Optional[str] = None
    snapshot_id: Optional[int] = None
    created_at: datetime = Field(default_factory=utc_now, index=True)


# ─── v2 portal models (student / recruiter / admin redesign) ─────────────────

class StudentProject(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    candidate_id: int = Field(foreign_key="candidateuser.id", index=True)
    title: str
    description: str = ""
    category: str = "academic"          # academic | personal | team
    tags_json: str = "[]"
    tools_json: str = "[]"
    image_path: Optional[str] = None     # media path (uploaded) or None → branch thumbnail
    file_path: Optional[str] = None      # attachment (zip/pdf/cad) stored under media/projects
    links_json: str = "[]"               # [{label, url}]
    status: str = Field(default="draft", index=True)   # draft | under_review | verified | rejected
    verification_note: Optional[str] = None
    team_size: int = 1
    month: Optional[str] = None          # "Apr 2026"
    featured: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class SavedJob(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    candidate_id: int = Field(foreign_key="candidateuser.id", index=True)
    job_id: int = Field(foreign_key="job.id", index=True)
    created_at: datetime = Field(default_factory=utc_now)


class ScheduledInterview(SQLModel, table=True):
    """Human (recruiter-run) interview rounds — distinct from the AI interview."""
    id: Optional[int] = Field(default=None, primary_key=True)
    application_id: int = Field(foreign_key="application.id", index=True)
    job_id: int = Field(foreign_key="job.id", index=True)
    candidate_id: int = Field(index=True)
    recruiter_id: int = Field(index=True)            # RecruiterUser.id (owner)
    round_name: str = "Technical Round 1"
    starts_at: datetime = Field(index=True)
    duration_min: int = 60
    mode: str = "online"                 # online | onsite
    meeting_link: Optional[str] = None
    location: Optional[str] = None
    interviewers: str = ""               # comma-separated names/emails
    status: str = Field(default="scheduled", index=True)  # scheduled | completed | cancelled | no_show
    feedback_json: Optional[str] = None  # {rating 1-5, recommendation, notes, by}
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Offer(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    application_id: int = Field(foreign_key="application.id", index=True)
    job_id: int = Field(foreign_key="job.id", index=True)
    candidate_id: int = Field(index=True)
    recruiter_id: int = Field(index=True)
    ctc: Optional[str] = None            # "₹6.5 LPA" or "₹25,000 / month"
    ctc_amount: Optional[float] = None   # numeric (LPA) for analytics
    offer_date: datetime = Field(default_factory=utc_now)
    joining_date: Optional[str] = None   # ISO date
    status: str = Field(default="sent", index=True)  # draft | sent | accepted | declined | negotiation | withdrawn | joined
    notes: Optional[str] = None
    letter_text: Optional[str] = None
    responded_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class CompanyProfile(SQLModel, table=True):
    """Public employer profile owned by a recruiter account (one per company)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    owner_recruiter_id: int = Field(index=True, unique=True)
    name: str = ""
    tagline: Optional[str] = None
    industries_json: str = "[]"
    headquarters: Optional[str] = None
    location_text: Optional[str] = None
    website: Optional[str] = None
    linkedin: Optional[str] = None
    legal_name: Optional[str] = None
    company_type: Optional[str] = None
    size: Optional[str] = None
    founded: Optional[str] = None
    about: Optional[str] = None
    mission: Optional[str] = None
    vision: Optional[str] = None
    values_json: str = "[]"
    highlights_json: str = "[]"          # [{label, value}]
    locations_json: str = "[]"           # [{name, address, tag, main}]
    hiring_focus_json: str = "[]"
    preferences_json: str = "{}"         # {employment_types, experience, locations, campus}
    benefits_json: str = "[]"
    logo_path: Optional[str] = None
    cover_path: Optional[str] = None
    gallery_json: str = "[]"             # media paths
    updated_at: datetime = Field(default_factory=utc_now)


class TeamMember(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    owner_recruiter_id: int = Field(index=True)
    name: str
    email: str
    title: Optional[str] = None
    access_level: str = "recruiter"      # admin | recruiter | viewer
    status: str = "invited"              # invited | active | inactive
    created_at: datetime = Field(default_factory=utc_now)


class RecruiterNote(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    recruiter_id: int = Field(index=True)
    candidate_id: int = Field(index=True)
    application_id: Optional[int] = Field(default=None, index=True)
    text: str
    created_at: datetime = Field(default_factory=utc_now)


class NewsletterSubscriber(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    source: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)


class ContentFlag(SQLModel, table=True):
    """Moderation queue items (reported jobs, profiles, spam)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str = Field(index=True)        # job | profile | company | application | other
    target_id: Optional[int] = None
    title: str
    detail: Optional[str] = None
    severity: str = "medium"             # low | medium | high
    status: str = Field(default="open", index=True)  # open | resolved | dismissed
    reported_by: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)
    resolved_at: Optional[datetime] = None



# ─── Live external data (official job APIs + learning resources) ─────────────

class ExternalJob(SQLModel, table=True):
    """A job listing pulled from an official, ToS-compliant API (SmartRecruiters,
    Adzuna, Jooble, Greenhouse, Lever). Students apply on the company site."""
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_externaljob_source_extid"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    source: str = Field(index=True)            # smartrecruiters | adzuna | jooble | greenhouse | lever
    external_id: str = Field(index=True)
    company_name: str = ""
    company_slug: Optional[str] = Field(default=None, index=True)
    title: str = ""
    description_text: str = ""                 # cleaned from HTML, max 8000 chars
    location_text: str = ""
    city: Optional[str] = None
    country: Optional[str] = None
    remote_type: Optional[str] = None          # onsite | remote | hybrid
    job_type: Optional[str] = None             # internship | full-time | part-time | apprenticeship
    experience_level: Optional[str] = None     # fresher | 0-2 | 2-5 | 5+
    branch: Optional[str] = Field(default=None, index=True)
    skills_json: str = "[]"
    apply_url: str = ""
    posting_url: Optional[str] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    posted_at: Optional[datetime] = Field(default=None, index=True)
    first_seen_at: datetime = Field(default_factory=utc_now)
    last_seen_at: datetime = Field(default_factory=utc_now)
    last_checked_at: datetime = Field(default_factory=utc_now)
    status: str = Field(default="active", index=True)   # active | expired | hidden
    miss_count: int = 0
    source_version: Optional[str] = None       # provider's change marker (e.g. releasedDate)
    dedupe_key: Optional[str] = Field(default=None, index=True)


class LiveResource(SQLModel, table=True):
    """Fresh learning material per branch: arXiv papers, YouTube lectures and
    admin-uploaded notes (PDF stored via media/MediaBlob)."""
    __table_args__ = (UniqueConstraint("source", "url", name="uq_liveresource_source_url"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    branch: str = Field(index=True)            # one of the 8 core branches, or "all"
    kind: str = Field(default="article", index=True)   # paper | video | article | notes | course
    title: str
    url: Optional[str] = None
    media_path: Optional[str] = None
    source: str = Field(default="admin", index=True)   # arxiv | youtube | admin
    author: Optional[str] = None
    summary: Optional[str] = None
    thumbnail_url: Optional[str] = None
    published_at: Optional[datetime] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utc_now)
    created_by: Optional[str] = None
    status: str = Field(default="active", index=True)  # active | hidden


class SyncRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str = Field(index=True)              # jobs | resources
    source: str = Field(index=True)
    started_at: datetime = Field(default_factory=utc_now, index=True)
    finished_at: Optional[datetime] = None
    status: str = "running"                    # running | ok | error | skipped
    fetched: int = 0
    added: int = 0
    updated: int = 0
    expired: int = 0
    error: Optional[str] = None
    triggered_by: Optional[str] = None


class ExternalApplicationLog(SQLModel, table=True):
    """A student's click-out / self-reported application on a company site."""
    id: Optional[int] = Field(default=None, primary_key=True)
    candidate_id: int = Field(index=True)
    external_job_id: int = Field(index=True)
    action: str = Field(index=True)            # clicked | applied
    created_at: datetime = Field(default_factory=utc_now)


class SavedExternalJob(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    candidate_id: int = Field(index=True)
    external_job_id: int = Field(index=True)
    created_at: datetime = Field(default_factory=utc_now)


def init_db():
    SQLModel.metadata.create_all(engine)
    if engine.url.drivername.startswith("sqlite"):
        _migrate_sqlite()
    _add_missing_columns()
    _relax_not_null("interviewsession", "application_id")


def _relax_not_null(table: str, column: str) -> None:
    """Drop a NOT NULL constraint that an older schema created.
    PostgreSQL supports it directly; SQLite needs a table rebuild."""
    insp = inspect(engine)
    if table not in insp.get_table_names():
        return
    cols = {c["name"]: c for c in insp.get_columns(table)}
    if column not in cols or cols[column].get("nullable", True):
        return
    try:
        if engine.url.drivername.startswith("sqlite"):
            with engine.begin() as conn:
                ddl = conn.execute(text("SELECT sql FROM sqlite_master WHERE type='table' AND name=:t"), {"t": table}).scalar()
                import re as _re
                new_ddl = _re.sub(rf'("?{column}"?\s+INTEGER)\s+NOT NULL', r"\1", ddl, count=1)
                if new_ddl == ddl:
                    return
                conn.execute(text("PRAGMA foreign_keys=OFF"))
                conn.execute(text(f"ALTER TABLE {table} RENAME TO _{table}_old"))
                conn.execute(text(new_ddl))
                names = ", ".join(f'"{c}"' for c in cols)
                conn.execute(text(f"INSERT INTO {table} ({names}) SELECT {names} FROM _{table}_old"))
                conn.execute(text(f"DROP TABLE _{table}_old"))
        else:
            with engine.begin() as conn:
                conn.execute(text(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" DROP NOT NULL'))
    except Exception as exc:  # pragma: no cover
        import logging
        logging.getLogger("ats-platform").warning("[MIGRATE] relax %s.%s failed: %s", table, column, exc)


def _add_missing_columns():
    """Dialect-aware, additive-only migration: adds any model column that is
    missing from an existing table (works for SQLite *and* PostgreSQL).
    New columns are added as NULLable without defaults, which is safe for
    both engines; model-level defaults apply to new rows."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    preparer = engine.dialect.identifier_preparer
    for table in SQLModel.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue
        have = {c["name"] for c in inspector.get_columns(table.name)}
        for col in table.columns:
            if col.name in have or col.primary_key:
                continue
            col_type = col.type.compile(dialect=engine.dialect)
            ddl = f"ALTER TABLE {preparer.quote(table.name)} ADD COLUMN {preparer.quote(col.name)} {col_type}"
            try:
                with engine.begin() as conn:
                    conn.execute(text(ddl))
            except Exception as exc:  # pragma: no cover - best effort
                import logging
                logging.getLogger("ats-platform").warning("[MIGRATE] %s failed: %s", ddl, exc)



def _migrate_sqlite():
    inspector = inspect(engine)
    if "company" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("company")}
    if "owner_username" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE company ADD COLUMN owner_username VARCHAR"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_company_owner_username ON company (owner_username)"))
    jd_columns = {column["name"] for column in inspector.get_columns("jobdescription")} if "jobdescription" in inspector.get_table_names() else set()
    if "jobdescription" in inspector.get_table_names() and "apply_url" not in jd_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE jobdescription ADD COLUMN apply_url VARCHAR"))
    if "user" in inspector.get_table_names():
        user_columns = {column["name"] for column in inspector.get_columns("user")}
        if "name" not in user_columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE user ADD COLUMN name VARCHAR DEFAULT ''"))
        if "phone" not in user_columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE user ADD COLUMN phone VARCHAR"))
        if "email_verified" not in user_columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE user ADD COLUMN email_verified BOOLEAN DEFAULT 0"))
    if "application" in inspector.get_table_names():
        app_columns = {column["name"] for column in inspector.get_columns("application")}
        
        new_cols = [
            ("baseline_ats_score", "INTEGER"),
            ("llm_used", "BOOLEAN"),
            ("project_score", "FLOAT"),
            ("final_score", "FLOAT"),
            ("project_summary", "VARCHAR"),
            ("project_fit", "VARCHAR"),
            ("risk_notes", "VARCHAR"),
            ("priority_level", "VARCHAR"),
            ("skills_matched_detail", "VARCHAR"),
            ("skills_gap_detail", "VARCHAR"),
            ("api_used", "VARCHAR"),
            ("parse_method", "VARCHAR"),
            ("repo_match_score", "INTEGER"),
            ("repo_match_reasoning", "VARCHAR"),
            ("suitability_verdict", "VARCHAR"),
            ("ai_recommendation", "VARCHAR"),
            ("interview_id", "INTEGER"),
            ("interview_status", "VARCHAR"),
            ("interview_risk_score", "INTEGER"),
            ("interview_risk_level", "VARCHAR"),
            ("interview_eval_score", "INTEGER"),
            ("interview_recommendation", "VARCHAR"),
            ("interview_evidence_url", "VARCHAR"),
            ("interview_transcript_json", "VARCHAR"),
            ("pending_human_review", "BOOLEAN DEFAULT 0"),
            ("human_reviewer", "VARCHAR"),
            ("human_decision_notes", "VARCHAR"),
            ("candidate_status", "VARCHAR DEFAULT 'applied'"),
        ]
        with engine.begin() as conn:
            for col_name, col_type in new_cols:
                if col_name not in app_columns:
                    conn.execute(text(f"ALTER TABLE application ADD COLUMN {col_name} {col_type}"))

    if "candidateprofile" in inspector.get_table_names():
        cp_columns = {column["name"] for column in inspector.get_columns("candidateprofile")}
        cp_new_cols = [
            ("project_description", "VARCHAR"),
            ("project_summary", "VARCHAR"),
            ("project_general_score", "INTEGER"),
            ("project_score", "FLOAT"),
            ("candidate_status", "VARCHAR DEFAULT 'applied'"),
            ("certifications_json", "VARCHAR DEFAULT '[]'"),
            ("avatar_path", "VARCHAR"),
            ("cover_photo_path", "VARCHAR"),
        ]
        with engine.begin() as conn:
            for col_name, col_type in cp_new_cols:
                if col_name not in cp_columns:
                    conn.execute(text(f"ALTER TABLE candidateprofile ADD COLUMN {col_name} {col_type}"))

    if "recruiterprofile" in inspector.get_table_names():
        rp_columns = {column["name"] for column in inspector.get_columns("recruiterprofile")}
        rp_new_cols = [
            ("headline", "VARCHAR DEFAULT ''"),
            ("bio", "VARCHAR DEFAULT ''"),
            ("avatar_path", "VARCHAR"),
            ("cover_photo_path", "VARCHAR"),
            ("company_name", "VARCHAR"),
        ]
        with engine.begin() as conn:
            for col_name, col_type in rp_new_cols:
                if col_name not in rp_columns:
                    conn.execute(text(f"ALTER TABLE recruiterprofile ADD COLUMN {col_name} {col_type}"))



def get_session():
    with Session(engine) as session:
        yield session
