import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
import io
import json
from unittest.mock import patch

from app.main import app
from app.db import engine, CandidateUser, User, Application, Job, JobDescription, Company
from app.auth import create_access_token

client = TestClient(app)

@pytest.fixture
def test_candidate():
    with Session(engine) as session:
        user = session.exec(select(CandidateUser).where(CandidateUser.username == "testscorecand@example.com")).first()
        if not user:
            user = CandidateUser(username="testscorecand@example.com", password_hash="dummy")
            session.add(user)
            session.commit()
            session.refresh(user)
            
        base_user = session.exec(select(User).where(User.email == "testscorecand@example.com")).first()
        if not base_user:
            base_user = User(email="testscorecand@example.com", password_hash="dummy", role="candidate")
            session.add(base_user)
            session.commit()
        yield user

@pytest.fixture
def candidate_token(test_candidate):
    return create_access_token(test_candidate.username, role="candidate")

@pytest.fixture
def sample_job():
    with Session(engine) as session:
        # Create a company and a job to tie the application to
        company = session.exec(select(Company).where(Company.name == "Score Company")).first()
        if not company:
            company = Company(name="Score Company")
            session.add(company)
            session.commit()
            session.refresh(company)

        job = session.exec(select(Job).where(Job.title == "Score Job")).first()
        if not job:
            job = Job(recruiter_id=1, company_id=company.id, title="Score Job", description="Need a Python dev.", location_text="Remote")
            session.add(job)
            session.commit()
            session.refresh(job)
        yield job

@pytest.fixture
def sample_application(test_candidate, sample_job):
    with Session(engine) as session:
        app_record = session.exec(select(Application).where(Application.candidate_id == test_candidate.id, Application.job_id == sample_job.id)).first()
        if not app_record:
            app_record = Application(candidate_id=test_candidate.id, job_id=sample_job.id, ats_score=80)
            session.add(app_record)
            session.commit()
            session.refresh(app_record)
        yield app_record

@patch("app.services.scorer.score_student_job")
def test_score_project_endpoint(mock_scorer, candidate_token, sample_application):
    # Mock the scorer result
    mock_scorer.return_value = {
        "project_score": 90.0,
        "final_score": 85.0,
        "project_summary": "Great Python project.",
        "skills_matched": ["Python"],
        "skills_missing": ["React"],
        "priority_level": "High",
        "api_used": "mocked"
    }

    # Dummy file
    file_content = b"print('hello world')"
    file_obj = io.BytesIO(file_content)
    file_obj.name = "script.py"

    response = client.post(
        "/api/candidate/score-project",
        headers={"Authorization": f"Bearer {candidate_token}"},
        data={"application_id": sample_application.id},
        files={"file": ("script.py", file_obj, "text/plain")}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["project_score"] == 90.0
    assert data["final_score"] == 85.0
    assert data["parse_method"] == "code_text"

    # Verify DB updated
    with Session(engine) as session:
        app_updated = session.get(Application, sample_application.id)
        assert app_updated.status == "repo_verification"
        assert app_updated.project_score == 90.0
        assert app_updated.final_score == 85.0
