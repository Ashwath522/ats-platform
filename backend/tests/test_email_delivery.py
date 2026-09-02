from unittest.mock import patch, MagicMock
import pytest
from app.services.email_delivery import send_email, EmailDeliveryError
from app.api.auth import _send_email_or_dev


def test_send_email_raises_when_unconfigured(monkeypatch):
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.delenv("SMTP_USER", raising=False)
    monkeypatch.delenv("SMTP_APP_PASSWORD", raising=False)

    with pytest.raises(EmailDeliveryError, match="not fully configured"):
        send_email("recipient@example.com", "Test Subject", "Test Body")


def test_send_email_success_with_mocked_smtp(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.setenv("SMTP_USER", "sender@example.com")
    monkeypatch.setenv("SMTP_APP_PASSWORD", "secret123")
    monkeypatch.setenv("SMTP_FROM", "sender@example.com")

    with patch("smtplib.SMTP") as mock_smtp_cls:
        mock_instance = MagicMock()
        mock_smtp_cls.return_value.__enter__.return_value = mock_instance

        send_email("recipient@example.com", "Interview Confirmation", "Your interview is scheduled.")

        mock_smtp_cls.assert_called_once_with("smtp.example.com", 587, timeout=15)
        mock_instance.starttls.assert_called_once()
        mock_instance.login.assert_called_once_with("sender@example.com", "secret123")
        mock_instance.send_message.assert_called_once()
        msg = mock_instance.send_message.call_args[0][0]
        assert msg["To"] == "recipient@example.com"
        assert msg["Subject"] == "Interview Confirmation"


def test_send_email_or_dev_falls_back_in_dev_mode(monkeypatch):
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.setenv("DEBUG", "1")

    res = _send_email_or_dev("test@example.com", "Subject", "Body", dev_payload={"otp": "123456"})
    assert res["email_sent"] is False
    assert res["dev_only"] == {"otp": "123456"}
