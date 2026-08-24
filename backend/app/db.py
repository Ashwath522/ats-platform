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
    status: str = "applied"           # "applied" | "reviewed" | "shortlisted" | "rejected"
    applied_at: datetime = Field(default_factory=utc_now)


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


def get_session():
    with Session(engine) as session:
        yield session
