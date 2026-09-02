import os
from sqlalchemy import inspect, text
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

DB_PATH = os.path.join(DATA_DIR, "ats.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)


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


class RecruiterRequest(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    email: str = Field(index=True)
    phone: str
    status: str = Field(default="pending", index=True)  # pending | approved | rejected
    submitted_at: datetime = Field(default_factory=utc_now)
    decided_at: Optional[datetime] = None


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


class CandidateProfile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    candidate_id: int = Field(foreign_key="candidateuser.id", unique=True, index=True)
    headline: str = ""
    bio: str = ""
    branch: Optional[str] = None      # candidate's target core branch
    skills_json: str = "[]"           # JSON array of skill strings
    experience_json: str = "[]"       # JSON array of {title, company, start, end, description}
    education_json: str = "[]"        # JSON array of {degree, institution, year}
    resume_id: Optional[int] = Field(default=None, foreign_key="resume.id")
    project_description: Optional[str] = None
    project_summary: Optional[str] = None
    project_general_score: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    # Optional EEO self-identification — candidate-controlled, never exposed to recruiters
    gender: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
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
    status: str = "open"              # "open" | "closed"
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



def init_db():
    SQLModel.metadata.create_all(engine)
    _migrate_sqlite()


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
            ("project_general_score", "INTEGER")
        ]
        with engine.begin() as conn:
            for col_name, col_type in cp_new_cols:
                if col_name not in cp_columns:
                    conn.execute(text(f"ALTER TABLE candidateprofile ADD COLUMN {col_name} {col_type}"))



def get_session():
    with Session(engine) as session:
        yield session
