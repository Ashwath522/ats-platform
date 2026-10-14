"""Sign in with Google: token checks and role rules."""
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api import google_auth
from app.auth import decode_token_payload, hash_password
from app.db import CandidateProfile, CandidateUser, User, engine
from app.main import app

CID = "1234-test.apps.googleusercontent.com"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", CID)
    with TestClient(app) as c:
        yield c


def fake_google(email, verified=True, aud=CID, iss="https://accounts.google.com", name="Asha Rao"):
    def verify(credential, audience):
        if credential == "bad":
            raise ValueError("bad signature")
        assert audience == CID
        return {"email": email, "email_verified": verified, "aud": aud, "iss": iss, "name": name}
    return verify


def test_config_reports_client_id(client, monkeypatch):
    assert client.get("/api/auth/google/config").json() == {"enabled": True, "client_id": CID}
    monkeypatch.delenv("GOOGLE_CLIENT_ID")
    assert client.get("/api/auth/google/config").json()["enabled"] is False
    assert client.post("/api/auth/google", json={"credential": "x"}).status_code == 503


def test_new_student_is_created_and_signed_in(client, monkeypatch):
    monkeypatch.setattr(google_auth, "verify_token", fake_google("New.Student@Gmail.com"))
    r = client.post("/api/auth/google", json={"credential": "tok", "role": "candidate"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] is True and body["username"] == "new.student@gmail.com"
    assert decode_token_payload(body["access_token"])["role"] == "candidate"
    with Session(engine) as s:
        u = s.exec(select(CandidateUser).where(CandidateUser.username == "new.student@gmail.com")).one()
        prof = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == u.id)).one()
        assert prof.full_name == "Asha Rao" and prof.contact_email == "new.student@gmail.com"
    # Second time: same account, not a duplicate.
    again = client.post("/api/auth/google", json={"credential": "tok"}).json()
    assert again["created"] is False and again["username"] == "new.student@gmail.com"
    # And the student can use the normal profile API with that token.
    assert client.get("/api/candidate/profile", headers={"Authorization": f"Bearer {again['access_token']}"}).status_code == 200


def test_existing_password_student_matches_case_insensitively(client, monkeypatch):
    with Session(engine) as s:
        s.add(CandidateUser(username="Mixed.Case@example.com", password_hash=hash_password("Password123")))
        s.commit()
    monkeypatch.setattr(google_auth, "verify_token", fake_google("mixed.case@example.com"))
    r = client.post("/api/auth/google", json={"credential": "tok"})
    assert r.status_code == 200 and r.json()["username"] == "Mixed.Case@example.com" and r.json()["created"] is False


@pytest.mark.parametrize("kw,status", [({"verified": False}, 403), ({"aud": "someone-else"}, 401), ({"iss": "evil.com"}, 401)])
def test_rejects_unverified_or_foreign_tokens(client, monkeypatch, kw, status):
    monkeypatch.setattr(google_auth, "verify_token", fake_google("x@gmail.com", **kw))
    assert client.post("/api/auth/google", json={"credential": "tok"}).status_code == status


def test_bad_signature_is_401(client, monkeypatch):
    monkeypatch.setattr(google_auth, "verify_token", fake_google("x@gmail.com"))
    assert client.post("/api/auth/google", json={"credential": "bad"}).status_code == 401


def test_suspended_student_blocked(client, monkeypatch):
    with Session(engine) as s:
        s.add(CandidateUser(username="sus@gmail.com", password_hash=hash_password("Password123"), status="suspended"))
        s.commit()
    monkeypatch.setattr(google_auth, "verify_token", fake_google("sus@gmail.com"))
    assert client.post("/api/auth/google", json={"credential": "tok"}).status_code == 403


def test_recruiter_only_if_approved(client, monkeypatch):
    monkeypatch.setattr(google_auth, "verify_token", fake_google("stranger@company.com"))
    r = client.post("/api/auth/google", json={"credential": "tok", "role": "recruiter"})
    assert r.status_code == 403 and "Contact Us" in r.json()["detail"]
    with Session(engine) as s:   # nothing created for an unknown recruiter
        assert s.exec(select(User).where(User.email == "stranger@company.com")).first() is None
        s.add(User(name="Hr", email="hr@company.com", role="recruiter", password_hash=hash_password("Password123"), email_verified=True))
        s.commit()
    monkeypatch.setattr(google_auth, "verify_token", fake_google("hr@company.com"))
    r = client.post("/api/auth/google", json={"credential": "tok", "role": "recruiter"})
    assert r.status_code == 200 and r.json()["role"] == "recruiter"
    assert decode_token_payload(r.json()["access_token"])["role"] == "recruiter"


def test_admin_role(client, monkeypatch):
    with Session(engine) as s:
        s.add(User(name="Admin", email="boss@gmail.com", role="admin", password_hash=hash_password("Password123"), email_verified=True))
        s.commit()
    monkeypatch.setattr(google_auth, "verify_token", fake_google("boss@gmail.com"))
    assert client.post("/api/auth/google", json={"credential": "tok", "role": "admin"}).json()["role"] == "admin"
    # admins can also come in through the recruiter page's Google button
    assert client.post("/api/auth/google", json={"credential": "tok", "role": "recruiter"}).json()["role"] == "admin"
    monkeypatch.setattr(google_auth, "verify_token", fake_google("student@gmail.com"))
    assert client.post("/api/auth/google", json={"credential": "tok", "role": "admin"}).status_code == 403
