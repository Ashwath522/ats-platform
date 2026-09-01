import os
import sys
import shutil

# Ensure backend root is in python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Set environment variables for testing before importing anything
TEST_DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data_test"))
os.environ["ATS_DATA_DIR"] = TEST_DATA_DIR
os.environ["TESTING"] = "1"

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
            session.exec(text(f"DELETE FROM {table.name}"))
        session.commit()

    # 2. Clear ChromaDB collections
    try:
        for col in vector_store.client.list_collections():
            vector_store.client.delete_collection(col.name)
    except Exception:
        pass

    yield
