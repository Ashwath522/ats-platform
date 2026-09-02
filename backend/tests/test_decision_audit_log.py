import json
import pytest
from sqlmodel import Session, select
from app.db import engine, Application, DecisionAuditLog, CandidateUser, Job, Company, RecruiterUser
from app.services.audit import record_audit_event


def test_decision_audit_log_model_and_immutability():
    with Session(engine) as session:
        # Create user and job
        cand = CandidateUser(username="audit_cand_1", password_hash="hash")
        rec = RecruiterUser(username="audit_rec_1", password_hash="hash")
        session.add(cand)
        session.add(rec)
        session.commit()
        session.refresh(cand)
        session.refresh(rec)

        job = Job(recruiter_id=rec.id, title="Audit Test Engineer", description="Audit JD Python SQL")
        session.add(job)
        session.commit()
        session.refresh(job)

        app = Application(
            candidate_id=cand.id,
            job_id=job.id,
            ats_score=82,
            baseline_ats_score=80,
            status="ats_check",
            matched_skills_json=json.dumps(["python", "sql"]),
            missing_skills_json=json.dumps(["docker"]),
        )
        session.add(app)
        session.commit()
        session.refresh(app)

        # Record audit event
        entry = record_audit_event(
            session=session,
            event_type="ats_score",
            application_id=app.id,
            candidate_id=cand.id,
            job_id=job.id,
            ats_score=82,
            baseline_ats_score=80,
            semantic_similarity=0.85,
            keyword_coverage=0.75,
            matched_skills=["python", "sql"],
            missing_skills=["docker"],
            final_score=82,
            llm_providers_consulted=["gemini"],
            raw_verdicts={"llm_score": 85, "reasoning": "Solid match"},
            final_recommendation="Strong Fit",
        )

        assert entry.id is not None
        assert entry.event_type == "ats_score"
        assert entry.ats_score == 82
        assert json.loads(entry.matched_skills_json) == ["python", "sql"]
        assert entry.llm_providers_consulted == json.dumps(["gemini"])
        assert entry.created_at is not None

        # Verify it can be retrieved from DecisionAuditLog table
        logs = session.exec(
            select(DecisionAuditLog).where(DecisionAuditLog.application_id == app.id)
        ).all()
        assert len(logs) >= 1
        assert any(l.event_type == "ats_score" and l.ats_score == 82 for l in logs)
