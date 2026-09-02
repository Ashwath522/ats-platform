import datetime
import json
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from app.main import app
from app.db import engine, Application, DecisionAuditLog, CandidateUser, RecruiterUser, Job, utc_now
from app.auth import create_access_token
from app.services.retention import purge_expired_proctoring_data


@pytest.fixture
def client():
    return TestClient(app)


def test_candidate_data_deletion_request(client):
    with Session(engine) as session:
        cand = CandidateUser(username="delete_cand_user", password_hash="hash")
        rec = RecruiterUser(username="delete_rec_user", password_hash="hash")
        session.add(cand)
        session.add(rec)
        session.commit()
        session.refresh(cand)
        session.refresh(rec)

        job = Job(recruiter_id=rec.id, title="Proctoring Test Job", description="Description")
        session.add(job)
        session.commit()
        session.refresh(job)

        appl = Application(
            candidate_id=cand.id,
            job_id=job.id,
            ats_score=80,
            status="automated_interview",
            interview_status="completed",
            interview_eval_score=85,
            interview_risk_score=15,
            interview_risk_level="low",
            interview_evidence_url="/api/evidence/candidate123.webm",
            interview_transcript_json=json.dumps([{"question": "Q1", "answer": "A1"}]),
        )
        session.add(appl)
        session.commit()
        session.refresh(appl)
        app_id = appl.id

    cand_token = create_access_token(username="delete_cand_user", role="candidate")
    headers = {"Authorization": f"Bearer {cand_token}"}

    # Candidate requests data deletion
    del_res = client.post(f"/api/candidate/applications/{app_id}/request-data-deletion", headers=headers)
    assert del_res.status_code == 200

    # Verify raw media purged while scores and audit log remain
    with Session(engine) as session:
        updated_app = session.get(Application, app_id)
        assert updated_app.interview_evidence_url == "[Deleted upon candidate request]"
        assert updated_app.interview_transcript_json == "[]"
        # Scores preserved
        assert updated_app.interview_eval_score == 85
        assert updated_app.interview_risk_score == 15

        # Audit log written
        audit_log = session.exec(
            select(DecisionAuditLog).where(
                DecisionAuditLog.application_id == app_id,
                DecisionAuditLog.event_type == "candidate_deletion_request"
            )
        ).first()
        assert audit_log is not None
        assert audit_log.human_reviewer == "delete_cand_user"
        assert audit_log.human_action == "deleted_proctoring_data"


def test_data_retention_window_purge():
    with Session(engine) as session:
        # App completed 40 days ago
        old_date = utc_now() - datetime.timedelta(days=40)
        old_app = Application(
            candidate_id=1,
            job_id=1,
            ats_score=75,
            status="automated_interview",
            interview_status="completed",
            applied_at=old_date,
            interview_eval_score=80,
            interview_risk_score=12,
            interview_evidence_url="/api/evidence/old_video.webm",
            interview_transcript_json=json.dumps([{"question": "Old Q", "answer": "Old A"}]),
        )
        session.add(old_app)
        session.commit()
        session.refresh(old_app)
        old_app_id = old_app.id

        # App completed 5 days ago (within retention window)
        recent_date = utc_now() - datetime.timedelta(days=5)
        recent_app = Application(
            candidate_id=1,
            job_id=1,
            ats_score=85,
            status="automated_interview",
            interview_status="completed",
            applied_at=recent_date,
            interview_eval_score=90,
            interview_risk_score=8,
            interview_evidence_url="/api/evidence/recent_video.webm",
            interview_transcript_json=json.dumps([{"question": "Recent Q", "answer": "Recent A"}]),
        )
        session.add(recent_app)
        session.commit()
        session.refresh(recent_app)
        recent_app_id = recent_app.id

        # Execute 30-day retention purge
        result = purge_expired_proctoring_data(session, retention_days=30)
        assert result["purged_count"] >= 1

        # Check old app was purged
        refreshed_old = session.get(Application, old_app_id)
        assert refreshed_old.interview_evidence_url.startswith("[Purged per 30-day")
        assert refreshed_old.interview_transcript_json == "[]"
        assert refreshed_old.interview_eval_score == 80  # preserved

        # Check recent app was NOT purged
        refreshed_recent = session.get(Application, recent_app_id)
        assert refreshed_recent.interview_evidence_url == "/api/evidence/recent_video.webm"
