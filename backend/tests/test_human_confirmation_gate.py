import json
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from app.main import app
from app.db import engine, Application, DecisionAuditLog, CandidateUser, RecruiterUser, Job
from app.auth import create_access_token


@pytest.fixture
def client():
    return TestClient(app)


def test_human_confirmation_gate_blocks_auto_rejection(client):
    with Session(engine) as session:
        from app.db import User
        user = User(email="gate_rec_test@example.com", role="recruiter", password_hash="hash")
        rec = RecruiterUser(username="gate_rec_test@example.com", password_hash="hash")
        cand = CandidateUser(username="gate_cand_test@example.com", password_hash="hash")
        session.add(user)
        session.add(rec)
        session.add(cand)
        session.commit()
        session.refresh(rec)
        session.refresh(cand)

        job = Job(recruiter_id=rec.id, title="Lead Architect", description="Expert C++ Systems")
        session.add(job)
        session.commit()
        session.refresh(job)

        # Application with low score flagged for human review
        appl = Application(
            candidate_id=cand.id,
            job_id=job.id,
            ats_score=35,
            status="ats_check",
            pending_human_review=True,
            suitability_verdict="Not a Fit",
        )
        session.add(appl)
        session.commit()
        session.refresh(appl)
        app_id = appl.id
        job_id = job.id

    rec_token = create_access_token(username="gate_rec_test@example.com", role="recruiter")
    headers = {"Authorization": f"Bearer {rec_token}"}

    # 1. Recruiter reviews applicants and sees pending_human_review is True
    res = client.get(f"/api/recruiter/jobs/{job_id}/applicants", headers=headers)
    assert res.status_code == 200
    applicants = res.json()["applicants"]
    matched = next((a for a in applicants if a["application_id"] == app_id), None)
    assert matched is not None
    assert matched["pending_human_review"] is True

    # 2. Recruiter explicitly confirms human decision (e.g. override to shortlisted)
    confirm_res = client.post(
        f"/api/recruiter/jobs/{job_id}/applicants/{app_id}/confirm-decision",
        data={"decision": "shortlisted", "notes": "Candidate has equivalent domain experience outside keywords."},
        headers=headers,
    )
    assert confirm_res.status_code == 200
    assert confirm_res.json()["pending_human_review"] is False
    assert confirm_res.json()["new_status"] == "shortlisted"
    assert confirm_res.json()["human_reviewer"] == "gate_rec_test@example.com"

    # 3. Verify DecisionAuditLog captures who confirmed and when
    with Session(engine) as session:
        audit_records = session.exec(
            select(DecisionAuditLog).where(
                DecisionAuditLog.application_id == app_id,
                DecisionAuditLog.event_type == "recruiter_confirmation"
            )
        ).all()
        assert len(audit_records) >= 1
        record = audit_records[-1]
        assert record.human_reviewer == "gate_rec_test@example.com"
        assert record.human_action == "confirmed_shortlisted"
        assert "equivalent domain experience" in record.final_recommendation
