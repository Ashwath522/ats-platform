import os
import sys
import time
from datetime import datetime, timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api import auth as auth_api
from app.auth import create_access_token, decode_token_payload, hash_password
from app.db import EmailToken, User, engine, init_db
from app.main import app


client = TestClient(app)


def _email(prefix):
    return f"{prefix}-{time.time_ns()}@example.com"


def _create_user(email, role, password="password123", verified=True):
    init_db()
    with Session(engine) as session:
        user = User(
            name=email,
            email=email,
            role=role,
            password_hash=hash_password(password),
            email_verified=verified,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return user


def test_jwt_payload_includes_role_claim():
    token = create_access_token("role-check@example.com", "admin")
    payload = decode_token_payload(token)
    assert payload["sub"] == "role-check@example.com"
    assert payload["role"] == "admin"


def test_role_separation_rejects_wrong_role_on_admin_and_recruiter_routes():
    admin = _create_user(_email("admin"), "admin")
    recruiter = _create_user(_email("recruiter"), "recruiter")

    admin_token = create_access_token(admin.email, "admin")
    recruiter_token = create_access_token(recruiter.email, "recruiter")

    admin_response = client.get(
        "/api/admin/recruiter-requests",
        headers={"Authorization": f"Bearer {recruiter_token}"},
    )
    recruiter_response = client.get(
        "/api/recruiter/companies",
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert admin_response.status_code == 403
    assert recruiter_response.status_code == 403


def test_recruiter_request_approve_creates_user_and_triggers_email(monkeypatch):
    sent = []

    def fake_send_email(to, subject, body):
        sent.append({"to": to, "subject": subject, "body": body})

    monkeypatch.setattr(auth_api, "send_email", fake_send_email)
    admin = _create_user(_email("admin"), "admin")
    admin_token = create_access_token(admin.email, "admin")
    recruiter_email = _email("approved")

    request_response = client.post(
        "/api/recruiter-requests",
        data={"name": "Approved Recruiter", "email": recruiter_email, "phone": "555-0100"},
    )
    assert request_response.status_code == 200

    approve_response = client.post(
        f"/api/admin/recruiter-requests/{request_response.json()['id']}/approve",
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert approve_response.status_code == 200
    assert approve_response.json()["email_sent"] is True
    assert sent and sent[0]["to"] == recruiter_email
    assert "Temporary password" in sent[0]["body"]
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == recruiter_email)).first()
        assert user is not None
        assert user.role == "recruiter"


def test_signup_otp_validation_and_expiry(monkeypatch):
    monkeypatch.setenv("DEV_MODE", "true")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    email = _email("otp")

    register_response = client.post(
        "/api/auth/register",
        data={"name": "OTP User", "email": email, "password": "password123"},
    )
    assert register_response.status_code == 200
    otp = register_response.json()["dev_only"]["otp"]

    verify_response = client.post("/api/auth/verify-otp", data={"email": email, "otp": otp})
    assert verify_response.status_code == 200
    assert verify_response.json()["role"] == "candidate"

    expired_email = _email("expired")
    _create_user(expired_email, "candidate", verified=False)
    with Session(engine) as session:
        session.add(EmailToken(
            email=expired_email,
            purpose="signup_otp",
            token_hash=auth_api._hash_token("123456"),
            expires_at=datetime.utcnow() - timedelta(minutes=1),
        ))
        session.commit()

    expired_response = client.post("/api/auth/verify-otp", data={"email": expired_email, "otp": "123456"})
    assert expired_response.status_code == 400


def test_password_reset_dev_fallback_token_is_single_use(monkeypatch):
    monkeypatch.setenv("DEV_MODE", "true")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    email = _email("reset")
    _create_user(email, "candidate")

    request_response = client.post("/api/auth/password-reset/request", data={"email": email})
    assert request_response.status_code == 200
    reset_token = request_response.json()["dev_only"]["reset_token"]

    confirm_response = client.post(
        "/api/auth/password-reset/confirm",
        data={"email": email, "token": reset_token, "new_password": "newpassword123"},
    )
    replay_response = client.post(
        "/api/auth/password-reset/confirm",
        data={"email": email, "token": reset_token, "new_password": "anotherpass123"},
    )

    assert confirm_response.status_code == 200
    assert replay_response.status_code == 400


def test_recruiter_request_approve_db_commits_even_if_email_fails(monkeypatch):
    monkeypatch.delenv("DEV_MODE", raising=False)
    
    def fake_send_email(to, subject, body):
        raise auth_api.EmailDeliveryError("Simulated failure")

    monkeypatch.setattr(auth_api, "send_email", fake_send_email)
    admin = _create_user(_email("admin3"), "admin")
    admin_token = create_access_token(admin.email, "admin")
    recruiter_email = _email("atomicity-fail")

    request_response = client.post(
        "/api/recruiter-requests",
        data={"name": "Atomicity Recruiter", "email": recruiter_email, "phone": "555-0200"},
    )
    assert request_response.status_code == 200
    request_id = request_response.json()["id"]

    approve_response = client.post(
        f"/api/admin/recruiter-requests/{request_id}/approve",
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert approve_response.status_code == 200
    resp_json = approve_response.json()
    assert resp_json["approved"] is True
    assert resp_json["email_sent"] is False
    assert "warning" in resp_json
    assert "temporary_password" not in resp_json

    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == recruiter_email)).first()
        assert user is not None
        assert user.role == "recruiter"

    retry_response = client.post(
        f"/api/admin/recruiter-requests/{request_id}/approve",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert retry_response.status_code == 400
    assert retry_response.json()["detail"] == "Recruiter request already decided"
