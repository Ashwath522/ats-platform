"""
backend/tests/test_repo_verification_integration.py
───────────────────────────────────────────────────
Comprehensive test suite for the Repo Verification Integration:
1. File Parsers (PDF, DOCX, ZIP, and generic router)
2. Gemini generate_project_summary extension & graceful fallback
3. Project Scorer scoring and fallback calculation
4. Candidate project upload endpoint (POST /candidate/project-upload)
5. Candidate simplified status endpoint (GET /candidate/status)
6. Recruiter repo-verify batch endpoint (POST /recruiter/jobs/{job_id}/repo-verify)
"""
import os
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.main import app
from app.db import (
    engine,
    User,
    CandidateUser,
    CandidateProfile,
    RecruiterUser,
    Company,
    Job,
    Application,
    DecisionAuditLog,
)
from app.auth import create_access_token, hash_password
from app.services.project_parsers import parse_project_file, parse_pdf, parse_docx, parse_zip
from app.services.gemini_client import GeminiClient
from app.services.project_scorer import score_project
from app.config import REPO_WEIGHT_ATS, REPO_WEIGHT_PROJECT


@pytest.fixture
def client():
    return TestClient(app)


# ─── 1. Parser Tests ──────────────────────────────────────────────────────────

def test_project_parsers_extract_content():
    fixtures_dir = os.path.join(os.path.dirname(__file__), "fixtures")
    pdf_path = os.path.join(fixtures_dir, "sample_project.pdf")
    docx_path = os.path.join(fixtures_dir, "sample_project.docx")
    zip_path = os.path.join(fixtures_dir, "sample_project.zip")
    txt_path = os.path.join(fixtures_dir, "sample_project.txt")

    # PDF
    pdf_text = parse_pdf(pdf_path)
    assert len(pdf_text) > 0
    assert "FastAPI" in pdf_text or "Python" in pdf_text

    # DOCX
    docx_text = parse_docx(docx_path)
    assert len(docx_text) > 0
    assert "FastAPI" in docx_text or "Python" in docx_text

    # ZIP
    zip_text = parse_zip(zip_path)
    assert len(zip_text) > 0
    assert "main.py" in zip_text
    assert "FastAPI" in zip_text

    # Router
    assert len(parse_project_file(txt_path)) > 0
    assert len(parse_project_file(pdf_path)) > 0
    assert len(parse_project_file(docx_path)) > 0
    assert len(parse_project_file(zip_path)) > 0
    assert parse_project_file("nonexistent_file.xyz") == ""


# ─── 2. Gemini generate_project_summary Extension ─────────────────────────────

def test_gemini_generate_project_summary_fallback():
    client = GeminiClient(api_key="")
    summary = client.generate_project_summary("def add(a, b): return a + b", "Basic math utility in Python")
    assert len(summary) > 0
    assert "Basic math utility" in summary or "Python" in summary or "fallback" in summary.lower()


# ─── 3. Project Scorer Fallback Path ──────────────────────────────────────────

def test_project_scorer_fallback_calculation(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    class DummyApp:
        ats_score = 80
        project_summary = "Built microservices in Python using FastAPI, PostgreSQL, and Redis caching."

    class DummyJob:
        description = "Backend Engineer required. Strong Python, FastAPI, PostgreSQL, Docker."

    res = score_project(DummyApp(), DummyJob())
    assert "project_score" in res
    assert "final_score" in res
    assert 0 <= res["project_score"] <= 100
    assert 0 <= res["final_score"] <= 100
    expected_final = round((REPO_WEIGHT_ATS * 80) + (REPO_WEIGHT_PROJECT * res["project_score"]), 1)
    assert res["final_score"] == expected_final
    assert len(res["reasoning"]) > 0


# ─── 4. Candidate Project Upload & Simplified Status Endpoints ────────────────

def test_candidate_project_upload_and_status(client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    cand_email = "candidate_upload_test@example.com"
    with Session(engine) as session:
        cand_user = User(name="Charlie Coder", email=cand_email, role="candidate", password_hash=hash_password("pwd"), email_verified=True)
        cand_auth = CandidateUser(username=cand_email, password_hash=hash_password("pwd"))
        session.add(cand_user)
        session.add(cand_auth)
        session.commit()
        session.refresh(cand_auth)

        cand_profile = CandidateProfile(candidate_id=cand_auth.id, full_name="Charlie Coder")
        session.add(cand_profile)
        session.commit()

    token = create_access_token(username=cand_email, role="candidate")
    headers = {"Authorization": f"Bearer {token}"}

    # Project Upload via POST /candidate/project-upload
    fixtures_dir = os.path.join(os.path.dirname(__file__), "fixtures")
    zip_path = os.path.join(fixtures_dir, "sample_project.zip")
    with open(zip_path, "rb") as f:
        res = client.post(
            "/candidate/project-upload",
            files={"file": ("portfolio.zip", f, "application/zip")},
            data={"description": "Full-stack cloud application with FastAPI backend."},
            headers=headers,
        )

    assert res.status_code == 200
    data = res.json()
    assert data["candidate_status"] == "applied"
    assert "project_summary" not in data

    # Simplified status endpoint via GET /candidate/status
    status_res = client.get("/candidate/status", headers=headers)
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert "status" in status_data
    # Must be only the simplified enum
    assert status_data["status"] in {"applied", "shortlisted", "not_selected", "interview", "final_result"}
    # No leaked score fields
    assert "ats_score" not in status_data
    assert "project_score" not in status_data
    assert "final_score" not in status_data


# ─── 5. Recruiter Repo-Verify Batch Endpoint ──────────────────────────────────

def test_recruiter_repo_verify_batch_ranking(client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    rec_email = "recruiter_batch_test@example.com"
    cand1_email = "cand1_batch@example.com"
    cand2_email = "cand2_batch@example.com"

    with Session(engine) as session:
        rec_user = User(name="Recruiter Dan", email=rec_email, role="recruiter", password_hash=hash_password("pwd"), email_verified=True)
        rec_auth = RecruiterUser(username=rec_email, password_hash=hash_password("pwd"))
        session.add(rec_user)
        session.add(rec_auth)
        session.commit()
        session.refresh(rec_auth)

        company = Company(name="Test Org", recruiter_id=rec_auth.id)
        session.add(company)
        session.commit()
        session.refresh(company)

        job = Job(
            recruiter_id=rec_auth.id,
            company_id=company.id,
            title="Backend Python Specialist",
            description="Looking for high proficiency in Python, FastAPI, PostgreSQL microservices.",
            status="open",
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id

        # Candidate 1: High match project
        c1_user = CandidateUser(username=cand1_email, password_hash=hash_password("pwd"))
        session.add(c1_user)
        session.commit()
        session.refresh(c1_user)
        c1_id = c1_user.id

        c1_prof = CandidateProfile(
            candidate_id=c1_id,
            project_summary="Expert Python FastAPI system with PostgreSQL, Docker, Redis, and high concurrency.",
        )
        session.add(c1_prof)

        app1 = Application(
            candidate_id=c1_id,
            job_id=job_id,
            ats_score=85,
            status="shortlisted",  # Stage 1 shortlisted
            candidate_status="applied",
            project_summary="Expert Python FastAPI system with PostgreSQL, Docker, Redis, and high concurrency.",
        )
        session.add(app1)

        # Candidate 2: Weaker match project
        c2_user = CandidateUser(username=cand2_email, password_hash=hash_password("pwd"))
        session.add(c2_user)
        session.commit()
        session.refresh(c2_user)
        c2_id = c2_user.id

        c2_prof = CandidateProfile(
            candidate_id=c2_id,
            project_summary="Basic HTML/CSS website with minimal JavaScript.",
        )
        session.add(c2_prof)

        app2 = Application(
            candidate_id=c2_id,
            job_id=job_id,
            ats_score=70,
            status="shortlisted",  # Stage 1 shortlisted
            candidate_status="applied",
            project_summary="Basic HTML/CSS website with minimal JavaScript.",
        )
        session.add(app2)

        session.commit()

    rec_token = create_access_token(username=rec_email, role="recruiter")
    rec_headers = {"Authorization": f"Bearer {rec_token}"}

    # Run Stage 2 Repo Verification with slot cap = 1
    verify_res = client.post(
        f"/recruiter/jobs/{job_id}/repo-verify?slot_count=1",
        headers=rec_headers,
    )
    assert verify_res.status_code == 200
    data = verify_res.json()
    assert data["total_evaluated"] == 2
    assert data["shortlist_count"] == 1
    shortlist = data["shortlist"]
    assert len(shortlist) == 2

    # Verify ranking: Candidate 1 (higher project/final score) is Rank #1
    assert shortlist[0]["candidate_id"] == c1_id
    assert shortlist[0]["rank"] == 1
    assert shortlist[0]["candidate_status"] == "shortlisted"
    assert shortlist[0]["final_score"] >= shortlist[1]["final_score"]

    # Candidate 2 was capped out beyond slot count 1, so marked not_selected
    assert shortlist[1]["candidate_id"] == c2_id
    assert shortlist[1]["rank"] == 2
    assert shortlist[1]["candidate_status"] == "not_selected"

    # Verify DB state and DecisionAuditLog entries
    with Session(engine) as session:
        db_app1 = session.exec(select(Application).where(Application.candidate_id == c1_id)).first()
        db_app2 = session.exec(select(Application).where(Application.candidate_id == c2_id)).first()
        assert db_app1.candidate_status == "shortlisted"
        assert db_app2.candidate_status == "not_selected"
        assert db_app1.final_score is not None

        audit_logs = session.exec(
            select(DecisionAuditLog).where(DecisionAuditLog.job_id == job_id)
        ).all()
        assert len(audit_logs) >= 2

