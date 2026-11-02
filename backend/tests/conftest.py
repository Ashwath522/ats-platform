import os
import sys
import shutil

# Ensure backend root is in python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Set environment variables for testing before importing anything
TEST_DATA_DIR = os.environ.get("ATS_TEST_DATA_DIR") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data_test"))
os.environ["ATS_DATA_DIR"] = TEST_DATA_DIR
os.environ["TESTING"] = "1"
os.environ.setdefault("LIVE_SYNC_AUTO", "false")   # no background syncs during tests

# Never let a developer's backend/.env leak into tests (main.py calls
# load_dotenv, which does not override variables that already exist): no real
# database, admin bootstrap, AI keys or email provider.
for _k in ("DATABASE_URL", "ADMIN_EMAIL", "ADMIN_PASSWORD", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY",
           "BREVO_API_KEY", "RESEND_API_KEY", "INTERVIEW_LLM_BASE_URL", "OLLAMA_BASE_URL", "GITHUB_TOKEN", "SENTRY_DSN"):
    os.environ[_k] = ""
os.environ["EMAIL_PROVIDER"] = "console"
# Opt-in: run the suite against a scratch PostgreSQL database (all tables are wiped per test).
if os.environ.get("ATS_TEST_DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["ATS_TEST_DATABASE_URL"]
os.environ["MEDIA_STORE"] = "disk"

# Clean up any leftover test data directory from previous runs *before* engine starts
shutil.rmtree(TEST_DATA_DIR, ignore_errors=True)
os.makedirs(TEST_DATA_DIR, exist_ok=True)

import pytest
from sqlmodel import Session, SQLModel, text
from app.db import engine, init_db
from app.resume_utils import vector_store

@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    # Initialize the tables in the test database
    init_db()
    yield
    # Clean up after all tests are done
    shutil.rmtree(TEST_DATA_DIR, ignore_errors=True)

@pytest.fixture(autouse=True)
def clean_database():
    """Autouse fixture to clean SQLite tables and Chroma collections before every test."""
    # 1. Clear SQLite tables
    with Session(engine) as session:
        for table in reversed(SQLModel.metadata.sorted_tables):
            session.exec(text(f'DELETE FROM "{table.name}"'))
        session.commit()

    # 2. Clear ChromaDB collections
    try:
        for col in vector_store.client.list_collections():
            vector_store.client.delete_collection(col.name)
    except Exception:
        pass

    yield
