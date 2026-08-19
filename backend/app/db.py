import os
from sqlalchemy import inspect, text
from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field, create_engine, Session

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))  # -> backend/
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

DB_PATH = os.path.join(DATA_DIR, "ats.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)


class Company(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    owner_username: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class JobDescription(SQLModel, table=True):
    """A company can update its title/JD over time; we keep the current one per company."""
    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="company.id")
    title: str
    description: str
    apply_url: Optional[str] = None
    vector_doc_id: str  # id used in the chroma "jobs" collection
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Resume(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    filename: str
    file_path: str
    vector_doc_id: str  # id used in the chroma "resumes" collection
    content_hash: str = Field(index=True)  # sha256 of extracted text, used for dedup
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)


class AnalysisCache(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    cache_key: str = Field(index=True, unique=True)
    payload_json: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class RecruiterUser(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


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


def get_session():
    with Session(engine) as session:
        yield session
