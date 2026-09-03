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

    # Step 3: Application submission (initial status = ats_check, interview_status = locked)
    with Session(engine) as session:
        app_record = Application(
            candidate_id=cand_id,
            job_id=job_id,
            ats_score=score_data["ats_score"],
            final_ats_score=score_data["ats_score"],
            status="ats_check",
            interview_status="locked",
            pending_human_review=True,
            suitability_verdict="Review Required",
            matched_skills_csv=",".join(score_data["matched_skills"]),
            missing_skills_csv=",".join(score_data["missing_skills"]),
        )
        session.add(app_record)
        session.commit()
        session.refresh(app_record)
        app_id = app_record.id

    # Step 4: Gate check — Repo verification is REJECTED on a non-shortlisted applicant (Stage 1 gate)
    premature_repo_res = client.post(
        f"/api/recruiter/jobs/{job_id}/applicants/{app_id}/evaluate-repo",
        headers=rec_headers,
    )
    assert premature_repo_res.status_code == 400
    assert "shortlisted state" in premature_repo_res.json()["detail"].lower()

    # Step 5: Candidate uploads project file — interview_status MUST STAY "locked" (no auto-unlock)
    project_upload_res = client.post(
        "/api/candidate/score-project",
        files={"file": ("project.py", b"import fastapi\napp = fastapi.FastAPI()\n# High performance async backend with postgres connection pool", "text/plain")},
        data={"application_id": str(app_id), "description": "Production FastAPI backend service with PostgreSQL pooling"},
        headers=cand_headers,
    )
    assert project_upload_res.status_code == 200

    with Session(engine) as session:
        app_after_upload = session.get(Application, app_id)
        assert app_after_upload.interview_status == "locked"

    # Candidate checking interview access is DENIED
    access_res = client.get(f"/api/candidate/applications/{app_id}/interview_access")
    assert access_res.status_code == 200
    assert access_res.json()["allowed"] is False
    assert access_res.json()["interview_status"] == "locked"

    # Step 6: Recruiter reviews applicants and approves Stage 1 (shortlist)
    rec_view_res = client.get(f"/api/recruiter/jobs/{job_id}/applicants", headers=rec_headers)
    assert rec_view_res.status_code == 200
    applicants = rec_view_res.json().get("applicants", [])
    matched_app = next((a for a in applicants if a["application_id"] == app_id), None)
    assert matched_app is not None

    confirm_res = client.post(
        f"/api/recruiter/jobs/{job_id}/applicants/{app_id}/confirm-decision",
        data={"decision": "shortlisted", "notes": "Stage 1: Strong Python & FastAPI background confirmed"},
        headers=rec_headers,
    )
    assert confirm_res.status_code == 200
    assert confirm_res.json()["new_status"] == "shortlisted"

    # Step 7: Recruiter performs Stage 2 Repo Verification (now allowed on shortlisted candidate)
    repo_eval_res = client.post(
        f"/api/recruiter/jobs/{job_id}/applicants/{app_id}/evaluate-repo",
        headers=rec_headers,
    )
    assert repo_eval_res.status_code == 200
    repo_data = repo_eval_res.json()
    assert "repo_match_score" in repo_data
    assert "final_score" in repo_data
    assert repo_data["final_score"] is not None

    # Assert final_score is correctly computed using configurable weights and persisted
    with Session(engine) as session:
        verified_app = session.get(Application, app_id)
        assert verified_app.status == "shortlisted"
        assert verified_app.repo_match_score is not None
        assert verified_app.final_score is not None
        from app.services.scorer import calculate_final_score
        expected_final = calculate_final_score(float(verified_app.ats_score), float(verified_app.repo_match_score))
        assert verified_app.final_score == expected_final
        # Interview MUST STILL be locked (repo evaluation does not auto-unlock)
        assert verified_app.interview_status == "locked"

    # Step 8: Recruiter explicitly unlocks interview (Stage 2 human gate)
    unlock_res = client.post(
        f"/api/recruiter/jobs/{job_id}/applicants/{app_id}/unlock-interview",
        data={"notes": "Stage 2 repo verified: architecture approved, unlocking AI interview."},
        headers=rec_headers,
    )
    assert unlock_res.status_code == 200
    assert unlock_res.json()["interview_status"] == "unlocked"

    # Verify DB state and DecisionAuditLog event for unlock
    with Session(engine) as session:
        unlocked_app = session.get(Application, app_id)
        assert unlocked_app.interview_status == "unlocked"

        unlock_audit = session.exec(
            select(DecisionAuditLog)
            .where(DecisionAuditLog.application_id == app_id)
            .where(DecisionAuditLog.event_type == "recruiter_interview_unlock")
        ).first()
        assert unlock_audit is not None
        assert unlock_audit.human_reviewer == rec_email
        assert unlock_audit.human_action == "unlocked_interview"

    # Now candidate checking interview access is ALLOWED
    access_unlocked_res = client.get(f"/api/candidate/applications/{app_id}/interview_access")
    assert access_unlocked_res.status_code == 200
    assert access_unlocked_res.json()["allowed"] is True
    assert access_unlocked_res.json()["interview_status"] == "unlocked"

    # Step 9: Candidate inspects explainability breakdown
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


