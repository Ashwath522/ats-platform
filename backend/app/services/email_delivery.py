"""Unified outbound email delivery.

Providers (first configured wins unless ``EMAIL_PROVIDER`` forces one):

* ``brevo``   - Brevo transactional HTTP API (``BREVO_API_KEY``). Works on hosts
                that block SMTP ports (e.g. Render free tier).
* ``resend``  - Resend HTTP API (``RESEND_API_KEY``).
* ``smtp``    - Classic SMTP (``SMTP_HOST``/``SMTP_PORT``/``SMTP_USER``/
                ``SMTP_APP_PASSWORD``); port 465 uses implicit SSL, anything
                else uses STARTTLS.
* ``console`` - Only when explicitly selected: logs the email instead of sending.

Sender address: ``EMAIL_FROM`` (fallback ``SMTP_FROM`` then ``SMTP_USER``),
display name ``EMAIL_FROM_NAME`` (default "CoreLink Hiring").

Every attempt is recorded in the ``EmailLog`` table. Secrets are never logged.
"""
from __future__ import annotations

import logging
import os
import smtplib
import ssl
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor, wait
from email.message import EmailMessage
from email.utils import formataddr
from typing import Optional

import httpx

log = logging.getLogger("ats-platform.email")

BREVO_URL = "https://api.brevo.com/v3/smtp/email"
RESEND_URL = "https://api.resend.com/emails"
RESEND_TEST_SENDER = "onboarding@resend.dev"
VALID_PROVIDERS = ("brevo", "resend", "smtp", "console")

MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 0.6  # attempt n waits BACKOFF_SECONDS * n before retrying
SMTP_TIMEOUT = 15


class EmailDeliveryError(RuntimeError):
    pass


class _PermanentEmailError(EmailDeliveryError):
    """Delivery failed in a way retrying will not fix (bad key, rejected sender...)."""


# --------------------------------------------------------------------------- config

def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def sender_address() -> str:
    return _env("EMAIL_FROM") or _env("SMTP_FROM") or _env("SMTP_USER")


def sender_name() -> str:
    return _env("EMAIL_FROM_NAME", "CoreLink Hiring") or "CoreLink Hiring"


def _provider_ready(provider: str) -> bool:
    if provider == "brevo":
        return bool(_env("BREVO_API_KEY") and sender_address())
    if provider == "resend":
        return bool(_env("RESEND_API_KEY"))
    if provider == "smtp":
        return bool(_env("SMTP_HOST") and _env("SMTP_USER") and os.environ.get("SMTP_APP_PASSWORD") and sender_address())
    if provider == "console":
        return True
    return False


def provider_name() -> str:
    """The provider that will be used, or ``"none"``."""
    forced = _env("EMAIL_PROVIDER").lower()
    if forced in VALID_PROVIDERS:
        return forced
    if _env("BREVO_API_KEY"):
        return "brevo"
    if _env("RESEND_API_KEY"):
        return "resend"
    if _env("SMTP_HOST"):
        return "smtp"
    return "none"


def email_configured() -> bool:
    provider = provider_name()
    return provider != "none" and _provider_ready(provider)


def _config_problem(provider: str) -> str:
    if provider == "none":
        return "Email delivery is not configured (set BREVO_API_KEY, RESEND_API_KEY or SMTP_* env vars)"
    if provider == "brevo":
        missing = [n for n, v in (("BREVO_API_KEY", _env("BREVO_API_KEY")), ("EMAIL_FROM", sender_address())) if not v]
    elif provider == "resend":
        missing = ["RESEND_API_KEY"]
    else:
        missing = [
            n for n, v in (
                ("SMTP_HOST", _env("SMTP_HOST")),
                ("SMTP_USER", _env("SMTP_USER")),
                ("SMTP_APP_PASSWORD", os.environ.get("SMTP_APP_PASSWORD")),
                ("EMAIL_FROM", sender_address()),
            ) if not v
        ]
    return f"Email provider '{provider}' is not fully configured (missing: {', '.join(missing)})"


# --------------------------------------------------------------------------- http client

_http_client: Optional[httpx.Client] = None
_http_lock = threading.Lock()


def _get_http_client() -> httpx.Client:
    global _http_client
    with _http_lock:
        if _http_client is None:
            _http_client = httpx.Client(timeout=httpx.Timeout(12.0, connect=5.0))
        return _http_client


def _short(text: str, limit: int = 300) -> str:
    text = (text or "").strip().replace("\n", " ")
    return text[:limit]


def _check_http_response(provider: str, response: httpx.Response) -> None:
    status = response.status_code
    if 200 <= status < 300:
        return
    detail = f"{provider} API returned HTTP {status}: {_short(response.text)}"
    if status == 429 or status >= 500:
        raise EmailDeliveryError(detail)
    raise _PermanentEmailError(detail)


# --------------------------------------------------------------------------- providers

def _send_brevo(to: str, subject: str, body: str, html: Optional[str]) -> None:
    payload = {
        "sender": {"name": sender_name(), "email": sender_address()},
        "to": [{"email": to}],
        "subject": subject,
        "textContent": body,
    }
    if html:
        payload["htmlContent"] = html
    headers = {"api-key": _env("BREVO_API_KEY"), "accept": "application/json", "content-type": "application/json"}
    try:
        response = _get_http_client().post(BREVO_URL, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise EmailDeliveryError(f"brevo request failed: {type(exc).__name__}: {_short(str(exc))}") from exc
    _check_http_response("brevo", response)


def _send_resend(to: str, subject: str, body: str, html: Optional[str]) -> None:
    sender = sender_address() or RESEND_TEST_SENDER
    payload = {
        "from": formataddr((sender_name(), sender)),
        "to": [to],
        "subject": subject,
        "text": body,
    }
    if html:
        payload["html"] = html
    headers = {"Authorization": f"Bearer {_env('RESEND_API_KEY')}", "Content-Type": "application/json"}
    try:
        response = _get_http_client().post(RESEND_URL, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise EmailDeliveryError(f"resend request failed: {type(exc).__name__}: {_short(str(exc))}") from exc
    _check_http_response("resend", response)


def _send_smtp(to: str, subject: str, body: str, html: Optional[str]) -> None:
    host = _env("SMTP_HOST")
    port = int(_env("SMTP_PORT", "587") or "587")
    username = _env("SMTP_USER")
    password = os.environ.get("SMTP_APP_PASSWORD", "")

    message = EmailMessage()
    message["From"] = formataddr((sender_name(), sender_address()))
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    if html:
        message.add_alternative(html, subtype="html")

    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=SMTP_TIMEOUT, context=ssl.create_default_context()) as smtp:
                smtp.login(username, password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=SMTP_TIMEOUT) as smtp:
                smtp.starttls(context=ssl.create_default_context())
                smtp.login(username, password)
                smtp.send_message(message)
    except (smtplib.SMTPAuthenticationError, smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused) as exc:
        raise _PermanentEmailError(f"smtp rejected: {type(exc).__name__}") from exc
    except Exception as exc:  # connection refused / timeout / blocked port
        raise EmailDeliveryError(f"smtp delivery failed: {type(exc).__name__}: {_short(str(exc), 200)}") from exc


def _send_console(to: str, subject: str, body: str, html: Optional[str]) -> None:
    # print() so it is always visible in the server output, regardless of logging config.
    print(f"\n===== [console email] To: {to} | Subject: {subject} =====\n{body}\n===== end email =====\n", flush=True)
    log.info("[console email] To: %s | Subject: %s", to, subject)


_PROVIDERS = {
    "brevo": _send_brevo,
    "resend": _send_resend,
    "smtp": _send_smtp,
    "console": _send_console,
}


# --------------------------------------------------------------------------- email log

def _create_log(to: str, subject: str, category: str, provider: str) -> Optional[int]:
    try:
        from sqlmodel import Session
        from ..db import EmailLog, engine

        with Session(engine) as session:
            row = EmailLog(
                to_email=to,
                subject=(subject or "")[:300],
                category=category or "general",
                provider=provider,
                status="queued",
            )
            session.add(row)
            session.commit()
            session.refresh(row)
            return row.id
    except Exception as exc:  # logging must never break delivery
        log.warning("Could not write EmailLog row: %s", exc)
        return None


def _update_log(log_id: Optional[int], **fields) -> None:
    if log_id is None:
        return
    try:
        from sqlmodel import Session
        from ..db import EmailLog, engine

        if "error" in fields and fields["error"]:
            fields["error"] = str(fields["error"])[:500]
        with Session(engine) as session:
            row = session.get(EmailLog, log_id)
            if not row:
                return
            for key, value in fields.items():
                setattr(row, key, value)
            session.add(row)
            session.commit()
    except Exception as exc:
        log.warning("Could not update EmailLog row %s: %s", log_id, exc)


# --------------------------------------------------------------------------- core

def _deliver(log_id: Optional[int], provider: str, to: str, subject: str, body: str, html: Optional[str]) -> None:
    """Send with retries, updating the log row. Raises EmailDeliveryError on failure."""
    from ..db import utc_now

    if provider == "none" or not _provider_ready(provider):
        problem = _config_problem(provider)
        _update_log(log_id, status="failed", error=problem, attempts=0)
        raise EmailDeliveryError(problem)

    sender = _PROVIDERS[provider]
    last_error: Optional[EmailDeliveryError] = None
    attempts = 0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        attempts = attempt
        try:
            sender(to, subject, body, html)
            _update_log(
                log_id,
                status="logged" if provider == "console" else "sent",
                attempts=attempts,
                error=None,
                sent_at=utc_now(),
            )
            return
        except _PermanentEmailError as exc:
            last_error = exc
            break
        except EmailDeliveryError as exc:
            last_error = exc
        except Exception as exc:  # defensive: unexpected provider bug
            last_error = EmailDeliveryError(f"{type(exc).__name__}: {_short(str(exc), 200)}")
        if attempt < MAX_ATTEMPTS:
            log.info("Email to %s via %s failed (attempt %d), retrying", to, provider, attempt)
            time.sleep(BACKOFF_SECONDS * attempt)

    message = str(last_error) if last_error else "unknown error"
    log.warning("Email to %s via %s failed after %d attempt(s): %s", to, provider, attempts, message)
    _update_log(log_id, status="failed", attempts=attempts, error=message)
    raise EmailDeliveryError(message)


def send_email(
    to: str,
    subject: str,
    body: str,
    html: Optional[str] = None,
    category: str = "general",
) -> None:
    """Send synchronously. Raises EmailDeliveryError if unconfigured or delivery fails."""
    to = (to or "").strip()
    if not to:
        raise EmailDeliveryError("Recipient address is empty")
    provider = provider_name()
    log_id = _create_log(to, subject, category, provider)
    _deliver(log_id, provider, to, subject, body, html)


# --------------------------------------------------------------------------- background queue

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="email")
_pending: "set[Future]" = set()
_pending_lock = threading.Lock()


def _background(log_id, provider, to, subject, body, html) -> None:
    try:
        _deliver(log_id, provider, to, subject, body, html)
    except EmailDeliveryError:
        pass  # already logged + recorded in EmailLog
    except Exception as exc:  # pragma: no cover - never let the worker die noisily
        log.exception("Unexpected error in email worker: %s", exc)


def queue_email(
    to: str,
    subject: str,
    body: str,
    html: Optional[str] = None,
    category: str = "general",
) -> Optional[int]:
    """Send in the background. Returns the EmailLog id (None if the log row could not be written).

    When no provider is configured the row is immediately marked ``failed``.
    """
    to = (to or "").strip()
    provider = provider_name()
    log_id = _create_log(to, subject, category, provider)
    if not to:
        _update_log(log_id, status="failed", error="Recipient address is empty")
        return log_id
    if provider == "none" or not _provider_ready(provider):
        _update_log(log_id, status="failed", error=_config_problem(provider))
        return log_id
    future = _executor.submit(_background, log_id, provider, to, subject, body, html)
    with _pending_lock:
        _pending.add(future)
    future.add_done_callback(lambda f: _discard_pending(f))
    return log_id


def _discard_pending(future: Future) -> None:
    with _pending_lock:
        _pending.discard(future)


def wait_for_queue(timeout: float = 10.0) -> None:
    """Block until queued emails finish (used by tests / graceful shutdown)."""
    with _pending_lock:
        futures = list(_pending)
    if futures:
        wait(futures, timeout=timeout)


def recent_logs(limit: int = 50) -> list:
    from sqlmodel import Session, select
    from ..db import EmailLog, engine

    with Session(engine) as session:
        rows = session.exec(select(EmailLog).order_by(EmailLog.id.desc()).limit(limit)).all()
        return [
            {
                "id": r.id,
                "to_email": r.to_email,
                "subject": r.subject,
                "category": r.category,
                "provider": r.provider,
                "status": r.status,
                "attempts": r.attempts,
                "error": r.error,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "sent_at": r.sent_at.isoformat() if r.sent_at else None,
            }
            for r in rows
        ]
