import os
import smtplib
from email.message import EmailMessage


class EmailDeliveryError(RuntimeError):
    pass


def send_email(to: str, subject: str, body: str) -> None:
    host = os.environ.get("SMTP_HOST", "").strip()
    port = int(os.environ.get("SMTP_PORT", "587"))
    username = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_APP_PASSWORD", "")
    sender = os.environ.get("SMTP_FROM", username).strip()
    if not host or not username or not password or not sender:
        raise EmailDeliveryError("SMTP is not fully configured")

    message = EmailMessage()
    message["From"] = sender
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    try:
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.starttls()
            smtp.login(username, password)
            smtp.send_message(message)
    except Exception as exc:
        raise EmailDeliveryError("SMTP delivery failed") from exc
