import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.auth import create_access_token
from app.db import Job, Application, RecruiterUser, CandidateUser, User, engine, init_db
from app.main import app

client = TestClient(app)

def _email(prefix):
    return f"{prefix}-{time.time_ns()}@example.com"

def test_recruiter_can_update_application_status():
    init_db()
    recruiter_email = _email("rec_update")
    candidate_email = _email("cand_update")
    
    with Session(engine) as session:
        # Create recruiter auth user and app user
        user = User(email=recruiter_email, role="recruiter", password_hash="test")
        session.add(user)
        recruiter = RecruiterUser(username=recruiter_email, password_hash="test")
        session.add(recruiter)
        
        # Create candidate
        candidate = CandidateUser(username=candidate_email, password_hash="test")
        session.add(candidate)
        session.commit()
        
        session.refresh(recruiter)
        session.refresh(candidate)
        
        # Create job
        job = Job(recruiter_id=recruiter.id, title="Test Job", description="Test Desc")
        session.add(job)
        session.commit()
        session.refresh(job)
        
        # Create application
        app_obj = Application(candidate_id=candidate.id, job_id=job.id, status="applied")
        session.add(app_obj)
        session.commit()
        session.refresh(app_obj)
        
        app_id = app_obj.id
        job_id = job.id

    token = create_access_token(recruiter_email, role="recruiter")
    headers = {"Authorization": f"Bearer {token}"}
    
    # Update status to 'shortlisted'
    resp = client.put(
        f"/api/recruiter/jobs/{job_id}/applicants/{app_id}/status",
        data={"status": "shortlisted"},
        headers=headers
    )
    
    assert resp.status_code == 200
    assert resp.json()["new_status"] == "shortlisted"
    
    with Session(engine) as session:
        updated_app = session.get(Application, app_id)
        assert updated_app.status == "shortlisted"

def test_recruiter_cannot_update_invalid_status():
    init_db()
    recruiter_email = _email("rec_invalid")
    
    with Session(engine) as session:
        user = User(email=recruiter_email, role="recruiter", password_hash="test")
        session.add(user)
        recruiter = RecruiterUser(username=recruiter_email, password_hash="test")
        candidate = CandidateUser(username=_email("c"), password_hash="test")
        session.add(recruiter)
        session.add(candidate)
        session.commit()
        
        job = Job(recruiter_id=recruiter.id, title="J", description="D")
        session.add(job)
        session.commit()
        
        app_obj = Application(candidate_id=candidate.id, job_id=job.id, status="applied")
        session.add(app_obj)
        session.commit()
        
        app_id = app_obj.id
        job_id = job.id

    token = create_access_token(recruiter_email, role="recruiter")
    
    resp = client.put(
        f"/api/recruiter/jobs/{job_id}/applicants/{app_id}/status",
        data={"status": "invalid_status"},
        headers={"Authorization": f"Bearer {token}"}
    )
    
    assert resp.status_code == 400
    assert "Invalid status" in resp.json()["detail"]
