"""Tests for the v2 admin portal API (pages 23–24 and supporting admin pages) —
app/api/admin_portal.py, plus suspension enforcement at login."""
import json

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.auth import create_access_token, hash_password
from app.db import (
    Application, CandidateProfile, CandidateUser, ContentFlag, DecisionAuditLog, Job, Offer, RecruiterRequest,
    RecruiterUser, StudentProject, User, engine,
)
from app.main import app

P = "/api/admin/portal"
PW = "Secret#12345"


def _hdr(email, role):
    return {"Authorization": f"Bearer {create_access_token(email, role=role)}"}


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def world():
    with Session(engine) as s:
        admin = User(name="Ada Admin", email="admin@corelink.test", role="admin", password_hash=hash_password(PW), email_verified=True)
        rec = User(name="Rita Recruiter", email="rita@acme.test", role="recruiter", password_hash=hash_password(PW), email_verified=True)
        s.add_all([admin, rec])
        ru = RecruiterUser(username="rita@acme.test", password_hash=hash_password(PW))
        s.add(ru)
        s.commit()
        s.refresh(ru)
        c1 = CandidateUser(username="asha@student.test", password_hash=hash_password(PW))
        c2 = CandidateUser(username="bala@student.test", password_hash=hash_password(PW))
        s.add_all([c1, c2])
        s.commit()
        s.refresh(c1)
        s.refresh(c2)
        s.add(CandidateProfile(candidate_id=c1.id, full_name="Asha Rao", branch="Mechanical Engineering", college="NIT Trichy", contact_email="asha@student.test"))
        s.add(CandidateProfile(candidate_id=c2.id, full_name="Bala K", branch="civil", college="IIT Madras"))
        s.add(RecruiterRequest(name="Rita Recruiter", email="rita@acme.test", phone="+91 90000 00000", company_name="Acme Industries",
                               company_website="https://acme.test", status="approved", verification_verdict="verified", verification_score=80))
        s.add(RecruiterRequest(name="Pending Person", email="pp@newco.test", phone="+91 90000 00001", company_name="NewCo Engineering",
                               company_website="https://newco.test", status="pending", verification_verdict="review", verification_score=55))
        job = Job(recruiter_id=ru.id, title="Design Engineer", description="CAD", branch="mechanical", status="open", location_text="Pune")
        s.add(job)
        s.commit()
        s.refresh(job)
        a = Application(candidate_id=c1.id, job_id=job.id, ats_score=78, status="shortlisted")
        s.add(a)
        s.commit()
        s.refresh(a)
        s.add(Offer(application_id=a.id, job_id=job.id, candidate_id=c1.id, recruiter_id=ru.id, ctc="₹6 LPA", ctc_amount=6.0, status="accepted"))
        s.add(StudentProject(candidate_id=c1.id, title="Gearbox design", status="under_review"))
        s.commit()
        pending = s.exec(select(RecruiterRequest).where(RecruiterRequest.status == "pending")).first()
        return {"admin": _hdr("admin@corelink.test", "admin"), "c1": c1.id, "c2": c2.id, "job": job.id, "rec_uid": f"u-{s.exec(select(User).where(User.email == 'rita@acme.test')).first().id}",
                "admin_uid": f"u-{s.exec(select(User).where(User.email == 'admin@corelink.test')).first().id}", "pending": pending.id}


def test_admin_endpoints_require_admin(client, world):
    for h in ({}, _hdr("rita@acme.test", "recruiter"), _hdr("asha@student.test", "candidate")):
        r = client.get(f"{P}/users", headers=h)
        assert r.status_code in (401, 403)
    assert client.get(f"{P}/overview", headers=world["admin"]).status_code == 200


def test_users_unified_list_and_filters(client, world):
    r = client.get(f"{P}/users", headers=world["admin"]).json()
    ids = {u["id"] for u in r["items"]}
    assert f"c-{world['c1']}" in ids and world["rec_uid"] in ids and world["admin_uid"] in ids
    assert r["kpis"]["candidates"] == 2 and r["kpis"]["recruiters"] == 1
    assert r["counts"]["pending"] >= 1  # the pending recruiter request shows as r-<id>
    r = client.get(f"{P}/users?tab=candidates&q=asha", headers=world["admin"]).json()
    assert [u["name"] for u in r["items"]] == ["Asha Rao"]
    assert r["items"][0]["branch"] == "mechanical"
    assert client.get(f"{P}/users?tab=nope", headers=world["admin"]).status_code == 400
    d = client.get(f"{P}/users/c-{world['c1']}", headers=world["admin"]).json()
    assert d["stats"]["applications"] == 1 and any("Applied" in e["title"] for e in d["activity"])


def test_suspend_blocks_candidate_login_and_api(client, world):
    uid = f"c-{world['c1']}"
    assert client.post("/api/candidate/auth/login", data={"username": "asha@student.test", "password": PW}).status_code == 200
    r = client.post(f"{P}/users/{uid}/actions", json={"action": "suspend"}, headers=world["admin"])
    assert r.status_code == 200 and r.json()["status"] == "suspended"
    assert client.post("/api/candidate/auth/login", data={"username": "asha@student.test", "password": PW}).status_code == 403
    assert client.get("/api/candidate/profile", headers=_hdr("asha@student.test", "candidate")).status_code == 403
    client.post(f"{P}/users/{uid}/actions", json={"action": "reactivate"}, headers=world["admin"])
    assert client.post("/api/candidate/auth/login", data={"username": "asha@student.test", "password": PW}).status_code == 200


def test_suspend_blocks_recruiter_login(client, world):
    uid = world["rec_uid"]
    assert client.post("/api/recruiter/auth/login", data={"username": "rita@acme.test", "password": PW}).status_code == 200
    assert client.post(f"{P}/users/{uid}/actions", json={"action": "suspend"}, headers=world["admin"]).status_code == 200
    r = client.post("/api/recruiter/auth/login", data={"username": "rita@acme.test", "password": PW})
    assert r.status_code == 403
    assert client.get("/api/recruiter/portal/overview", headers=_hdr("rita@acme.test", "recruiter")).status_code == 403
    client.post(f"{P}/users/{uid}/actions", json={"action": "reactivate"}, headers=world["admin"])
    assert client.post("/api/recruiter/auth/login", data={"username": "rita@acme.test", "password": PW}).status_code == 200


def test_admin_cannot_suspend_or_delete_self(client, world):
    me = world["admin_uid"]
    assert client.post(f"{P}/users/{me}/actions", json={"action": "suspend"}, headers=world["admin"]).status_code == 400
    assert client.delete(f"{P}/users/{me}", headers=world["admin"]).status_code == 400


def test_verify_edit_notes_and_audit(client, world):
    uid = f"c-{world['c2']}"
    assert client.post(f"{P}/users/{uid}/actions", json={"action": "verify"}, headers=world["admin"]).status_code == 200
    row = client.get(f"{P}/users/{uid}", headers=world["admin"]).json()
    assert row["verification"] == "verified"
    r = client.patch(f"{P}/users/{uid}", json={"name": "Bala Krishnan", "phone": "+91 99999 11111"}, headers=world["admin"])
    assert r.status_code == 200 and r.json()["user"]["name"] == "Bala Krishnan"
    assert client.patch(f"{P}/users/{uid}", json={"email": "asha@student.test"}, headers=world["admin"]).status_code == 409
    assert client.patch(f"{P}/users/{uid}", json={"phone": "call me"}, headers=world["admin"]).status_code == 422
    notes = client.post(f"{P}/users/{uid}/notes", json={"text": "Checked college ID"}, headers=world["admin"]).json()["notes"]
    assert notes[0]["text"] == "Checked college ID"
    logs = client.get(f"{P}/audit-logs?event_type=admin_action", headers=world["admin"]).json()
    actions = {i["human_action"] for i in logs["items"]}
    assert f"verify_user:{uid}" in actions and f"edit_user:{uid}" in actions
    detail = client.get(f"{P}/audit-logs/{logs['items'][0]['id']}", headers=world["admin"])
    assert detail.status_code == 200


def test_delete_candidate_removes_data(client, world):
    uid = f"c-{world['c1']}"
    assert client.delete(f"{P}/users/{uid}", headers=world["admin"]).status_code == 200
    with Session(engine) as s:
        assert s.get(CandidateUser, world["c1"]) is None
        assert not s.exec(select(Application).where(Application.candidate_id == world["c1"])).all()
    # a recruiter that owns jobs cannot be deleted (suspend instead)
    assert client.delete(f"{P}/users/{world['rec_uid']}", headers=world["admin"]).status_code == 409


def test_companies_jobs_and_moderation(client, world):
    co = client.get(f"{P}/companies", headers=world["admin"]).json()
    names = {c["name"]: c for c in co["items"]}
    assert "Acme Industries" in names and names["NewCo Engineering"]["status"] == "pending"
    assert names["Acme Industries"]["jobs"] == 1
    detail = client.get(f"{P}/companies/{names['Acme Industries']['id']}", headers=world["admin"]).json()
    assert detail["jobs"][0]["title"] == "Design Engineer"

    jobs = client.get(f"{P}/jobs?q=design", headers=world["admin"]).json()
    assert jobs["total"] == 1 and jobs["items"][0]["company"] == "Acme Industries"
    assert client.get(f"{P}/jobs?export=true", headers=world["admin"]).json()["total"] == 1
    jid = world["job"]
    assert client.post(f"{P}/jobs/{jid}/status", json={"status": "closed"}, headers=world["admin"]).json()["status"] == "closed"
    assert client.post(f"{P}/jobs/{jid}/status", json={"status": "bogus"}, headers=world["admin"]).status_code == 422
    f = client.post(f"{P}/jobs/{jid}/flag", json={"reason": "Misleading salary", "severity": "high"}, headers=world["admin"]).json()
    assert f["status"] == "open" and f["kind"] == "job"
    assert client.get(f"{P}/jobs/{jid}", headers=world["admin"]).json()["flags"][0]["severity"] == "high"
    assert client.post(f"{P}/flags/{f['id']}", json={"status": "resolved"}, headers=world["admin"]).json()["status"] == "resolved"
    assert client.get(f"{P}/flags?status=open", headers=world["admin"]).json()["items"] == []
    assert client.post(f"{P}/flags", json={"kind": "weird", "title": "x x x"}, headers=world["admin"]).status_code == 422

    pr = client.get(f"{P}/projects", headers=world["admin"]).json()["items"]
    assert pr[0]["title"] == "Gearbox design"
    assert client.post(f"{P}/projects/{pr[0]['id']}/reject", json={}, headers=world["admin"]).status_code == 422
    assert client.post(f"{P}/projects/{pr[0]['id']}/verify", json={"note": "Nice"}, headers=world["admin"]).json()["status"] == "verified"


def test_recruiter_request_approve_and_reject_are_audited(client, world, monkeypatch):
    monkeypatch.setenv("DEV_MODE", "1")
    with Session(engine) as s:
        other = RecruiterRequest(name="Second", email="two@other.test", phone="+91 90000 00002", company_name="Other Co", status="pending")
        s.add(other)
        s.commit()
        s.refresh(other)
        other_id = other.id
    r = client.post(f"{P}/recruiter-requests/{world['pending']}/approve", headers=world["admin"])
    assert r.status_code == 200 and r.json()["approved"] is True
    with Session(engine) as s:
        assert s.exec(select(User).where(User.email == "pp@newco.test", User.role == "recruiter")).first()
    assert client.post(f"{P}/recruiter-requests/{world['pending']}/approve", headers=world["admin"]).status_code == 400
    r = client.post(f"{P}/recruiter-requests/{other_id}/reject", json={"reason": "Unverifiable"}, headers=world["admin"])
    assert r.status_code == 200
    hist = client.get(f"{P}/recruiter-requests?status=decided", headers=world["admin"]).json()["items"]
    assert {h["status"] for h in hist} >= {"approved", "rejected"}
    with Session(engine) as s:
        acts = {a.human_action for a in s.exec(select(DecisionAuditLog).where(DecisionAuditLog.event_type == "admin_action")).all()}
    assert f"approve_recruiter_request:r-{world['pending']}" in acts and f"reject_recruiter_request:r-{other_id}" in acts


def test_lists_reports_and_overview(client, world):
    h = world["admin"]
    apps = client.get(f"{P}/applications?q=asha", headers=h).json()
    assert apps["total"] == 1 and apps["items"][0]["candidate"]["name"] == "Asha Rao"
    assert client.get(f"{P}/interviews", headers=h).status_code == 200
    offers = client.get(f"{P}/offers", headers=h).json()
    assert offers["kpis"]["accepted"] == 1 and offers["kpis"]["avg_ctc"] == 6.0
    ov = client.get(f"{P}/overview", headers=h).json()
    assert ov["kpis"]["users"]["value"] >= 4 and ov["kpis"]["hires"]["value"] == 1
    for kind in ("users", "companies", "jobs", "applications", "hires"):
        rep = client.get(f"{P}/reports/{kind}", headers=h)
        assert rep.status_code == 200 and rep.json()["columns"]
    assert client.get(f"{P}/reports/secrets", headers=h).status_code == 404
    assert client.get(f"{P}/overview?start=2026-05-01&end=2026-01-01", headers=h).status_code == 400


def test_settings_and_public_stats(client, world):
    h = world["admin"]
    st = client.get(f"{P}/settings", headers=h).json()
    assert st["settings"]["public_stats"] is True and "health" in st
    assert client.put(f"{P}/settings", json={"support_email": "nope"}, headers=h).status_code == 422
    assert client.put(f"{P}/settings", json={"retention_days": 2}, headers=h).status_code == 422
    assert client.put(f"{P}/settings", json={"announcement_enabled": True, "announcement_text": ""}, headers=h).status_code == 422
    r = client.put(f"{P}/settings", json={"support_email": "Help@CoreLink.test", "announcement_enabled": True,
                                           "announcement_text": "Campus season is open", "announcement_tone": "success"}, headers=h)
    assert r.status_code == 200 and r.json()["settings"]["support_email"] == "help@corelink.test"
    assert client.put(f"{P}/settings", json={"public_stats": False}, headers=_hdr("rita@acme.test", "recruiter")).status_code == 403

    pub = client.get("/api/public/stats").json()  # no auth
    assert pub["announcement"] == {"text": "Campus season is open", "tone": "success"}
    assert pub["support_email"] == "help@corelink.test"
    assert pub["students"] == 2 and pub["open_jobs"] == 1
    assert "Acme Industries" in pub["company_names"] and "NewCo Engineering" not in pub["company_names"]
    assert not any(k in json.dumps(pub) for k in ("asha@", "rita@", "password"))
