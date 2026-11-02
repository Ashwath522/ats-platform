"""Focused Phase 2 contract tests for browser evidence and extraction status."""
import hashlib
import json
import os
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.auth import create_access_token
from app.db import CandidateProfile, CandidateUser, ProjectAnalysisJob, ProjectFile, StudentProject, engine, utc_now
from app.main import app
from app.services.media_utils import MEDIA_DIR
from app.services.project_analysis.jobs import mark_stuck
from app.services.project_analysis.schemas import Claim, Evidence, enforce_claim_evidence


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _make_student(email):
    with Session(engine) as s:
        user = CandidateUser(username=email, password_hash="x")
        s.add(user); s.commit(); s.refresh(user)
        s.add(CandidateProfile(candidate_id=user.id, contact_email=email, full_name=email.split("@")[0])); s.commit()
        return user.id


def _headers(email):
    return {"Authorization": f"Bearer {create_access_token(email, role='candidate')}"}


def _project_file(email="one@example.com", filename="notes.py", data=b"import os\nprint('ok')\n"):
    cid = _make_student(email)
    with Session(engine) as s:
        p = StudentProject(candidate_id=cid, title="Evidence project", domain="software", description="A sufficiently long project description for analysis.", challenge_code="1234")
        s.add(p); s.commit(); s.refresh(p)
        digest = hashlib.sha256(data).hexdigest(); rel=f"projects/files/test_{p.id}_{filename}"; path=os.path.join(MEDIA_DIR, rel); os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as out: out.write(data)
        f=ProjectFile(project_id=p.id,candidate_id=cid,filename=filename,ext=os.path.splitext(filename)[1],mime="text/plain",size_bytes=len(data),sha256=digest,media_path=rel,kind="code")
        s.add(f); s.commit(); s.refresh(f)
        j=ProjectAnalysisJob(project_id=p.id,candidate_id=cid,input_hash=digest,status="running",stage="extract_files",progress=20,stages_json="[]")
        s.add(j); s.commit(); s.refresh(j)
        return cid,p.id,f.id,j.id,digest


def _seed_result(job_id):
    with Session(engine) as s:
        j=s.get(ProjectAnalysisJob,job_id); j.result_json=json.dumps({"version":"pa:v1","project_id":j.project_id,"domain":"software","stages":[],"evidence":[],"claims":[],"warnings":[],"scores":{},"created_at":utc_now().isoformat()}); s.add(j); s.commit()


def test_evidence_owner_hash_limits_idempotency_and_client_origin(client):
    _, pid, fid, jid, digest = _project_file(); _seed_result(jid); h=_headers("one@example.com")
    evidence={"id":"browser-1","source_type":"file","source_ref":str(fid),"locator":None,"fact":"2 lines; imports: os","method":"parsed","confidence":"high","origin":"server"}
    r=client.post(f"/api/student/projects/{pid}/analysis/{jid}/evidence",headers=h,json={"file_id":fid,"sha256":digest,"evidence":[evidence],"warnings":[]})
    assert r.status_code==200
    with Session(engine) as s: stored=json.loads(s.get(ProjectAnalysisJob,jid).result_json)["evidence"]; assert stored[0]["origin"]=="client"
    evidence["id"]="browser-2"; r=client.post(f"/api/student/projects/{pid}/analysis/{jid}/evidence",headers=h,json={"file_id":fid,"sha256":digest,"evidence":[evidence],"warnings":[]}); assert r.status_code==200
    with Session(engine) as s: assert [x["id"] for x in json.loads(s.get(ProjectAnalysisJob,jid).result_json)["evidence"]]==["browser-2"]
    assert client.post(f"/api/student/projects/{pid}/analysis/{jid}/evidence",headers=h,json={"file_id":fid,"sha256":"bad","evidence":[]}).status_code==400
    assert client.post(f"/api/student/projects/{pid}/analysis/{jid}/evidence",headers=h,json={"file_id":fid,"sha256":digest,"evidence":[{**evidence,"fact":"x"*501}]}).status_code==422
    assert client.post(f"/api/student/projects/{pid}/analysis/{jid}/evidence",headers=_headers("two@example.com"),json={"file_id":fid,"sha256":digest,"evidence":[]}).status_code==404


def test_text_server_recheck_mismatch_warning_and_match_confirmation(client):
    _,pid,fid,jid,digest=_project_file(data=b"one\ntwo\n"); _seed_result(jid); h=_headers("one@example.com")
    body={"file_id":fid,"sha256":digest,"evidence":[{"id":"e1","source_type":"file","source_ref":str(fid),"fact":"99 lines","method":"parsed","confidence":"high"}]}
    assert client.post(f"/api/student/projects/{pid}/analysis/{jid}/evidence",headers=h,json=body).status_code==200
    with Session(engine) as s: result=json.loads(s.get(ProjectAnalysisJob,jid).result_json); assert result["evidence"][0]["confidence"]=="low"; assert result["warnings"]
    body["evidence"][0]["id"]="e2"; body["evidence"][0]["fact"]="2 lines"; assert client.post(f"/api/student/projects/{pid}/analysis/{jid}/evidence",headers=h,json=body).status_code==200
    with Session(engine) as s: assert json.loads(s.get(ProjectAnalysisJob,jid).result_json)["evidence"][0]["confirmed"] is True


def test_client_only_evidence_cannot_verify_claim():
    e=Evidence(id="e1",source_type="file",source_ref="1",fact="fact",method="parsed",confidence="high",origin="client")
    claim=Claim(id="c1",text="claim",origin="document",status="verified",evidence_ids=["e1"])
    assert enforce_claim_evidence([claim],[e])[0].status=="unverified"


def test_extract_stage_running_done_and_thirty_minute_timeout():
    _,_,_,jid,_=_project_file()
    with Session(engine) as s:
        j=s.get(ProjectAnalysisJob,jid); j.updated_at=utc_now()-timedelta(minutes=31); s.add(j); s.commit(); s.refresh(j)
    mark_stuck(j)
    with Session(engine) as s:
        j=s.get(ProjectAnalysisJob,jid); assert j.status=="failed"; assert "Resume analysis" in j.error


def test_client_status_updates_extract_stage(client):
    _,pid,_,jid,_=_project_file(); r=client.post(f"/api/student/projects/{pid}/analysis/{jid}/client-status",headers=_headers("one@example.com"),json={"percentage":45,"current_file":"notes.py"})
    assert r.status_code==200 and r.json()["stage"]=="extract_files" and r.json()["progress"]==49
