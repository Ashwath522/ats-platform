"""Truecaller mobile-web verification: start → callback → status."""
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api import truecaller_auth
from app.auth import create_access_token, hash_password
from app.db import CandidateUser, engine
from app.main import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("TRUECALLER_PARTNER_KEY", "pk_test_123")
    with TestClient(app) as c:
        yield c


def fake_truecaller(phone="919876543210", email="", first="Asha", last="Rao"):
    def fetch(endpoint, token):
        assert token == "tok-1"
        return {"phoneNumbers": [phone], "name": {"first": first, "last": last},
                "onlineIdentities": {"email": email} if email else {}}
    return fetch


def _student(email="stu@example.com"):
    with Session(engine) as s:
        s.add(CandidateUser(username=email, password_hash=hash_password("Password123")))
        s.commit()
    return {"Authorization": f"Bearer {create_access_token(email, role='candidate')}"}


def _flow(client, purpose="login", headers=None, accept=True):
    r = client.post("/api/auth/truecaller/start", json={"purpose": purpose}, headers=headers or {})
    assert r.status_code == 200, r.text
    nonce = r.json()["nonce"]
    assert client.get(f"/api/auth/truecaller/status?nonce={nonce}").json()["status"] == "pending"
    cb = {"requestId": nonce, "accessToken": "tok-1", "endpoint": "https://profile4-noneu.truecaller.com/v1/default"} if accept \
        else {"requestId": nonce, "status": "user_rejected"}
    assert client.post("/api/auth/truecaller/callback", json=cb).status_code == 200
    return nonce, client.get(f"/api/auth/truecaller/status?nonce={nonce}").json()


def test_config(client, monkeypatch):
    assert client.get("/api/auth/truecaller/config").json() == {"enabled": True, "partner_key": "pk_test_123", "partner_name": "CoreLink"}
    monkeypatch.setenv("TRUECALLER_PARTNER_KEY", "")
    assert client.get("/api/auth/truecaller/config").json()["enabled"] is False
    assert client.post("/api/auth/truecaller/start", json={}).status_code == 503


def test_verify_phone_then_login_with_it(client, monkeypatch):
    monkeypatch.setattr(truecaller_auth, "fetch_profile", fake_truecaller())
    h = _student()
    assert client.post("/api/auth/truecaller/start", json={"purpose": "verify_phone"}).status_code == 401
    _, st = _flow(client, "verify_phone", h)
    assert st == {"status": "verified", "purpose": "verify_phone", "phone": "+919876543210"}
    prof = client.get("/api/candidate/profile", headers=h).json()
    assert prof["phone_verified"] is True and prof["contact_phone"] == "+919876543210"
    assert "phone_verified" not in (prof.get("preferences") or {})
    # Editing other fields keeps it; changing the number drops it.
    assert client.put("/api/candidate/profile", headers=h, json={"headline": "x"}).json()["phone_verified"] is True
    assert client.put("/api/candidate/profile", headers=h, json={"contact_phone": "+91 90000 00000"}).json()["phone_verified"] is False
    client.put("/api/candidate/profile", headers=h, json={"contact_phone": "+919876543210"})
    assert client.get("/api/candidate/profile", headers=h).json()["phone_verified"] is False   # needs re-verification
    _flow(client, "verify_phone", h)
    # Now Truecaller login finds the account by its verified phone.
    _, st = _flow(client, "login")
    assert st["status"] == "verified" and st["username"] == "stu@example.com" and st["access_token"]


def test_login_creates_account_from_truecaller_email(client, monkeypatch):
    monkeypatch.setattr(truecaller_auth, "fetch_profile", fake_truecaller(phone="+91 99887 76655", email="New.User@Gmail.com"))
    _, st = _flow(client, "login")
    assert st["status"] == "verified" and st["username"] == "new.user@gmail.com" and st["created"] is True
    h = {"Authorization": f"Bearer {st['access_token']}"}
    prof = client.get("/api/candidate/profile", headers=h).json()
    assert prof["phone_verified"] is True and prof["full_name"] == "Asha Rao"


def test_login_without_account_or_email(client, monkeypatch):
    monkeypatch.setattr(truecaller_auth, "fetch_profile", fake_truecaller(phone="919000011111"))
    _, st = _flow(client, "login")
    assert st["status"] == "no_account" and "Sign up" in st["detail"]


def test_rejected_single_use_and_bad_endpoint(client, monkeypatch):
    _, st = _flow(client, accept=False)
    assert st["status"] == "rejected"
    monkeypatch.setattr(truecaller_auth, "fetch_profile", fake_truecaller(email="once@gmail.com"))
    nonce, st = _flow(client)
    assert st["status"] == "verified"
    assert client.get(f"/api/auth/truecaller/status?nonce={nonce}").json()["status"] == "used"
    # Callbacks for unknown nonces or non-Truecaller endpoints are ignored.
    assert client.post("/api/auth/truecaller/callback", json={"requestId": "0" * 32, "accessToken": "x", "endpoint": "https://x"}).json() == {"ok": False}
    with pytest.raises(ValueError):
        truecaller_auth._fetch_profile("https://evil.example/profile", "t")
    with pytest.raises(ValueError):
        truecaller_auth._fetch_profile("http://api4.truecaller.com/x", "t")


def test_phone_already_verified_elsewhere(client, monkeypatch):
    monkeypatch.setattr(truecaller_auth, "fetch_profile", fake_truecaller(phone="919111122222"))
    _flow(client, "verify_phone", _student("a@example.com"))
    _, st = _flow(client, "verify_phone", _student("b@example.com"))
    assert st["status"] == "failed" and "another" in st["detail"]


@pytest.mark.parametrize("raw,out", [("9876543210", "+919876543210"), ("+91 98765-43210", "+919876543210"), ("12", None), ("", None)])
def test_normalize_phone(raw, out):
    assert truecaller_auth.normalize_phone(raw) == out
