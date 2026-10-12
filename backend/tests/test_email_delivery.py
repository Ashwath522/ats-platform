from unittest.mock import MagicMock, patch

import httpx
import pytest
from sqlmodel import Session, select

from app.api.auth import _send_email_or_dev
from app.db import EmailLog, engine
from app.services import email_delivery, email_templates
from app.services.email_delivery import EmailDeliveryError, send_email

EMAIL_ENV = [
    "EMAIL_PROVIDER", "EMAIL_FROM", "EMAIL_FROM_NAME", "BREVO_API_KEY", "RESEND_API_KEY",
    "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_APP_PASSWORD", "SMTP_FROM",
]


@pytest.fixture(autouse=True)
def clean_email_env(monkeypatch):
    for name in EMAIL_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(email_delivery, "BACKOFF_SECONDS", 0)
    yield


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def post(self, url, json=None, headers=None):
        self.calls.append({"url": url, "json": json, "headers": headers})
        item = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        if isinstance(item, Exception):
            raise item
        return httpx.Response(item[0], text=item[1] if len(item) > 1 else "{}", request=httpx.Request("POST", url))


def _logs():
    with Session(engine) as session:
        return session.exec(select(EmailLog).order_by(EmailLog.id)).all()


def test_provider_selection_by_env(monkeypatch):
    assert email_delivery.provider_name() == "none"
    assert email_delivery.email_configured() is False

    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    assert email_delivery.provider_name() == "smtp"
    assert email_delivery.email_configured() is False  # missing user/password/from

    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    assert email_delivery.provider_name() == "resend"
    assert email_delivery.email_configured() is True

    monkeypatch.setenv("BREVO_API_KEY", "xkeysib-test")
    assert email_delivery.provider_name() == "brevo"
    assert email_delivery.email_configured() is False  # brevo needs a verified sender
    monkeypatch.setenv("EMAIL_FROM", "hiring@corelink.example")
    assert email_delivery.email_configured() is True

    monkeypatch.setenv("EMAIL_PROVIDER", "console")
    assert email_delivery.provider_name() == "console"
    assert email_delivery.email_configured() is True


def test_send_email_raises_when_unconfigured_and_logs_failure():
    with pytest.raises(EmailDeliveryError, match="not configured"):
        send_email("recipient@example.com", "Test Subject", "Test Body")
    rows = _logs()
    assert len(rows) == 1
    assert rows[0].status == "failed"
    assert rows[0].provider == "none"


def test_brevo_payload_shape(monkeypatch):
    monkeypatch.setenv("BREVO_API_KEY", "xkeysib-secret")
    monkeypatch.setenv("EMAIL_FROM", "hiring@corelink.example")
    fake = FakeClient([(201, '{"messageId": "abc"}')])
    monkeypatch.setattr(email_delivery, "_get_http_client", lambda: fake)

    send_email("candidate@example.com", "Hello", "plain body", html="<p>html</p>", category="welcome")

    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call["url"] == "https://api.brevo.com/v3/smtp/email"
    assert call["headers"]["api-key"] == "xkeysib-secret"
    assert call["json"] == {
        "sender": {"name": "CoreLink Hiring", "email": "hiring@corelink.example"},
        "to": [{"email": "candidate@example.com"}],
        "subject": "Hello",
        "textContent": "plain body",
        "htmlContent": "<p>html</p>",
    }
    rows = _logs()
    assert rows[-1].status == "sent"
    assert rows[-1].provider == "brevo"
    assert rows[-1].attempts == 1
    assert rows[-1].category == "welcome"
    assert rows[-1].sent_at is not None


def test_resend_payload_uses_configured_sender(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_secret")
    monkeypatch.setenv("EMAIL_FROM", "hiring@corelink.example")
    monkeypatch.setenv("EMAIL_FROM_NAME", "CoreLink Team")
    fake = FakeClient([(200, '{"id": "1"}')])
    monkeypatch.setattr(email_delivery, "_get_http_client", lambda: fake)

    send_email("a@example.com", "S", "B")

    call = fake.calls[0]
    assert call["url"] == "https://api.resend.com/emails"
    assert call["json"]["from"] == "CoreLink Team <hiring@corelink.example>"
    assert call["json"]["to"] == ["a@example.com"]
    assert call["headers"]["Authorization"] == "Bearer re_secret"


def test_retries_on_5xx_then_raises(monkeypatch):
    monkeypatch.setenv("BREVO_API_KEY", "xkeysib-secret")
    monkeypatch.setenv("EMAIL_FROM", "hiring@corelink.example")
    fake = FakeClient([(503, "unavailable")])
    monkeypatch.setattr(email_delivery, "_get_http_client", lambda: fake)

    with pytest.raises(EmailDeliveryError, match="HTTP 503"):
        send_email("candidate@example.com", "Hello", "body")

    assert len(fake.calls) == 3
    row = _logs()[-1]
    assert row.status == "failed"
    assert row.attempts == 3
    assert "503" in row.error
    assert "xkeysib-secret" not in row.error


def test_retry_recovers_after_network_error(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_secret")
    fake = FakeClient([httpx.ConnectError("boom"), (429, "slow down"), (200, "{}")])
    monkeypatch.setattr(email_delivery, "_get_http_client", lambda: fake)

    send_email("candidate@example.com", "Hello", "body")

    assert len(fake.calls) == 3
    row = _logs()[-1]
    assert row.status == "sent"
    assert row.attempts == 3


def test_4xx_is_not_retried(monkeypatch):
    monkeypatch.setenv("BREVO_API_KEY", "bad")
    monkeypatch.setenv("EMAIL_FROM", "hiring@corelink.example")
    fake = FakeClient([(401, '{"message":"Key not found"}')])
    monkeypatch.setattr(email_delivery, "_get_http_client", lambda: fake)

    with pytest.raises(EmailDeliveryError, match="HTTP 401"):
        send_email("candidate@example.com", "Hello", "body")
    assert len(fake.calls) == 1
    assert _logs()[-1].attempts == 1


def test_smtp_starttls_with_html(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.setenv("SMTP_USER", "sender@example.com")
    monkeypatch.setenv("SMTP_APP_PASSWORD", "secret123")

    with patch("smtplib.SMTP") as mock_smtp_cls:
        mock_instance = MagicMock()
        mock_smtp_cls.return_value.__enter__.return_value = mock_instance

        send_email("recipient@example.com", "Interview Confirmation", "Plain", html="<b>Rich</b>")

        mock_smtp_cls.assert_called_once_with("smtp.example.com", 587, timeout=15)
        mock_instance.starttls.assert_called_once()
        mock_instance.login.assert_called_once_with("sender@example.com", "secret123")
        msg = mock_instance.send_message.call_args[0][0]
        assert msg["To"] == "recipient@example.com"
        assert msg["Subject"] == "Interview Confirmation"
        assert msg.is_multipart()


def test_smtp_port_465_uses_ssl(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_PORT", "465")
    monkeypatch.setenv("SMTP_USER", "sender@example.com")
    monkeypatch.setenv("SMTP_APP_PASSWORD", "secret123")

    with patch("smtplib.SMTP_SSL") as mock_ssl, patch("smtplib.SMTP") as mock_plain:
        instance = MagicMock()
        mock_ssl.return_value.__enter__.return_value = instance
        send_email("recipient@example.com", "S", "B")
        assert mock_ssl.call_args[0][:2] == ("smtp.example.com", 465)
        instance.login.assert_called_once()
        mock_plain.assert_not_called()


def test_console_provider_logs_and_records(monkeypatch, caplog):
    monkeypatch.setenv("EMAIL_PROVIDER", "console")
    with caplog.at_level("INFO", logger="ats-platform.email"):
        send_email("dev@example.com", "Console subject", "Console body")
    assert "Console subject" in caplog.text
    row = _logs()[-1]
    assert row.status == "logged"
    assert row.provider == "console"


def test_queue_email_sends_in_background(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_secret")
    fake = FakeClient([(200, "{}")])
    monkeypatch.setattr(email_delivery, "_get_http_client", lambda: fake)

    log_id = email_delivery.queue_email("q@example.com", "Queued", "body", category="test")
    assert isinstance(log_id, int)
    email_delivery.wait_for_queue(5)

    with Session(engine) as session:
        row = session.get(EmailLog, log_id)
        assert row.status == "sent"
        assert row.category == "test"
    assert fake.calls[0]["json"]["to"] == ["q@example.com"]


def test_queue_email_unconfigured_marks_failed():
    log_id = email_delivery.queue_email("q@example.com", "Queued", "body")
    with Session(engine) as session:
        row = session.get(EmailLog, log_id)
        assert row.status == "failed"
        assert "not configured" in row.error


def test_send_email_or_dev_falls_back_in_dev_mode(monkeypatch):
    monkeypatch.setenv("DEBUG", "1")
    res = _send_email_or_dev("test@example.com", "Subject", "Body", dev_payload={"otp": "123456"})
    assert res["email_sent"] is False
    assert res["dev_only"] == {"otp": "123456"}


def test_send_email_or_dev_502_outside_dev(monkeypatch):
    from fastapi import HTTPException

    for name in ("DEBUG", "DEV_MODE", "ENV"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(HTTPException) as exc:
        _send_email_or_dev("test@example.com", "Subject", "Body")
    assert exc.value.status_code == 502


def test_templates_render_links(monkeypatch):
    monkeypatch.setenv("APP_PUBLIC_URL", "https://app.corelink.example/")
    subject, text, html = email_templates.interview_invitation("Asha", "Backend Engineer", 42, batch_index=1)
    assert "https://app.corelink.example/candidate/repo?interview=42" in text
    assert 'href="https://app.corelink.example/candidate/repo?interview=42"' in html
    assert "Backend Engineer" in subject

    subject, text, html = email_templates.recruiter_approved("Ravi", "ravi@acme.example", "Tmp<Pass>")
    assert "Temporary password: Tmp<Pass>" in text
    assert "Tmp&lt;Pass&gt;" in html  # escaped in HTML

    _, text, html = email_templates.interview_completed("Asha", "Backend Engineer")
    assert "score" not in text.lower()

    for builder in (
        lambda: email_templates.signup_otp("A", "123456"),
        lambda: email_templates.password_reset("A", "a@x.com", "tok"),
        lambda: email_templates.recruiter_request_received("A", "Acme"),
        lambda: email_templates.admin_new_recruiter_request(
            request_id=1, name="A", email="a@acme.com", phone="1", score=80, verdict="verified"),
        lambda: email_templates.recruiter_rejected("A", "Could not verify"),
        lambda: email_templates.welcome("A"),
    ):
        s, t, h = builder()
        assert s and t and h.startswith("<!doctype html>") and "CoreLink" in h
