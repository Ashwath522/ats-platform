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


@pytest.fixture
def client():
    return TestClient(app)


def test_full_hiring_flow_end_to_end(client):
    """
    Complete E2E Business Flow:
    1. Candidate and Recruiter account creation & auth setup.
    2. Recruiter posts an open engineering job.
    3. Candidate creates profile, gets scored, and applies.
    4. Recruiter reviews applicants and sees scoring signals.
    5. Recruiter confirms/shortlists candidate -> DecisionAuditLog captures event and updates human review gate.
    6. Candidate inspects plain-language explainability breakdown for the application.
    """
    cand_email = "e2e_candidate@example.com"
    rec_email = "e2e_recruiter@example.com"

    # Step 1: User & Role setup
    with Session(engine) as session:
        cand_user = User(name="Alice Dev", email=cand_email, role="candidate", password_hash=hash_password("pass123"), email_verified=True)
        rec_user = User(name="Bob Recruiter", email=rec_email, role="recruiter", password_hash=hash_password("pass123"), email_verified=True)
        cand_auth = CandidateUser(username=cand_email, password_hash=hash_password("pass123"))
        rec_auth = RecruiterUser(username=rec_email, password_hash=hash_password("pass123"))

        session.add(cand_user)
        session.add(rec_user)
        session.add(cand_auth)
        session.add(rec_auth)
        session.commit()
        session.refresh(cand_auth)
        session.refresh(rec_auth)

        # Company & Job creation
        company = Company(name="Acme Tech", recruiter_id=rec_auth.id)
        session.add(company)
        session.commit()
        session.refresh(company)

        job = Job(
            recruiter_id=rec_auth.id,
            company_id=company.id,
            title="Senior Python Backend Engineer",
            branch="Software",
            description="Looking for an experienced Python developer with FastAPI, PostgreSQL, Docker, and Redis expertise to build high-scale APIs.",
            status="open",
        )
        session.add(job)
        session.commit()
        session.refresh(job)

        cand_profile = CandidateProfile(
            candidate_id=cand_auth.id,
            full_name="Alice Dev",
            branch="Software",
            experience_years=4.5,
            skills_text="Python, FastAPI, PostgreSQL, Docker, REST, SQL",
            github_url="https://github.com/alice/fastapi-service",
        )
        session.add(cand_profile)
        session.commit()
        session.refresh(cand_profile)

        job_id = job.id
        cand_id = cand_auth.id

    cand_token = create_access_token(username=cand_email, role="candidate")
    rec_token = create_access_token(username=rec_email, role="recruiter")
    cand_headers = {"Authorization": f"Bearer {cand_token}"}
    rec_headers = {"Authorization": f"Bearer {rec_token}"}

    # Step 2: Candidate tests direct ATS scoring check
    score_check_res = client.post(
        "/api/candidate/ats-score",
        files={"file": ("resume.txt", b"Experienced Python Engineer with 4 years building FastAPI and PostgreSQL backend services and microservices with Docker.", "text/plain")},
        data={
            "job_description": "Senior Python Backend Engineer with FastAPI, PostgreSQL, Docker, and Redis expertise.",
            "role_id": "",
        },
        headers=cand_headers,
    )
    assert score_check_res.status_code == 200
    score_data = score_check_res.json()
    assert "ats_score" in score_data
    assert score_data["ats_score"] > 60
    assert "FastAPI" in score_data["matched_skills"] or "Python" in score_data["matched_skills"]

    # Step 3: Application submission
    with Session(engine) as session:
        final_score_val = round(0.4 * score_data["ats_score"] + 0.6 * 88)
        app_record = Application(
            candidate_id=cand_id,
            job_id=job_id,
            ats_score=score_data["ats_score"],
            repo_match_score=88,
            final_ats_score=score_data["ats_score"],
            final_score=final_score_val,
            status="ats_check",
            pending_human_review=True,
            suitability_verdict="Review Required",
            matched_skills_csv=",".join(score_data["matched_skills"]),
            missing_skills_csv=",".join(score_data["missing_skills"]),
        )
        session.add(app_record)
        session.commit()
        session.refresh(app_record)
        app_id = app_record.id

    # Step 4: Recruiter reviews applicants for the job
    rec_view_res = client.get(f"/api/recruiter/jobs/{job_id}/applicants", headers=rec_headers)
    assert rec_view_res.status_code == 200
    applicants = rec_view_res.json().get("applicants", [])
    matched_app = next((a for a in applicants if a["application_id"] == app_id), None)
    assert matched_app is not None
    assert matched_app["final_score"] > 0
    assert matched_app["pending_human_review"] is True

    # Step 5: Recruiter confirms human decision (shortlist candidate)
    confirm_res = client.post(
        f"/api/recruiter/jobs/{job_id}/applicants/{app_id}/confirm-decision",
        data={"decision": "shortlisted", "notes": "Strong Python & FastAPI background confirmed"},
        headers=rec_headers,
    )
    assert confirm_res.status_code == 200
    confirm_data = confirm_res.json()
    assert confirm_data["new_status"] == "shortlisted"
    assert confirm_data["pending_human_review"] is False

    # Assert DB state and DecisionAuditLog
    with Session(engine) as session:
        updated_app = session.get(Application, app_id)
        assert updated_app.status == "shortlisted"
        assert updated_app.pending_human_review is False

        audit_entry = session.exec(
            select(DecisionAuditLog)
            .where(DecisionAuditLog.application_id == app_id)
            .where(DecisionAuditLog.event_type == "recruiter_confirmation")
        ).first()
        assert audit_entry is not None
        assert audit_entry.human_reviewer == rec_email
        assert audit_entry.human_action == "confirmed_shortlisted"

    # Step 6: Candidate inspects explainability breakdown
    explain_res = client.get(f"/api/candidate/jobs/applications/{app_id}/explainability", headers=cand_headers)
    assert explain_res.status_code == 200
    explain_data = explain_res.json()
    assert explain_data["application_id"] == app_id
    assert "summary_verdict" in explain_data
    assert "summary_text" in explain_data
    assert "components" in explain_data
    assert len(explain_data["components"]) >= 2
    assert explain_data["human_review_status"] == "Confirmed"
    assert explain_data["human_reviewer"] == rec_email
    assert len(explain_data["recommendations"]) > 0

