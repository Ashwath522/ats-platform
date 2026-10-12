"""Transactional email templates for CoreLink.

Every builder returns ``(subject, text_body, html_body)``. HTML is
table-based with inline CSS so it renders in Gmail/Outlook/mobile clients.
"""
from __future__ import annotations

import os
from html import escape
from typing import Optional, Tuple
from urllib.parse import quote

Email = Tuple[str, str, str]

BRAND = "CoreLink"
PRIMARY = "#4f46e5"
TEXT = "#1f2937"
MUTED = "#6b7280"


def app_url(path: str = "") -> str:
    base = (os.environ.get("APP_PUBLIC_URL") or "http://localhost:5173").strip().rstrip("/")
    if path and not path.startswith("/"):
        path = "/" + path
    return f"{base}{path}"


def _e(value) -> str:
    return escape(str(value if value is not None else ""))


def _button(label: str, url: str) -> str:
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">'
        f'<tr><td align="center" bgcolor="{PRIMARY}" style="border-radius:10px;">'
        f'<a href="{_e(url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:16px;'
        f'font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;font-family:Arial,Helvetica,sans-serif;">'
        f"{_e(label)}</a></td></tr></table>"
        f'<p style="margin:0 0 16px;font-size:13px;color:{MUTED};word-break:break-all;">'
        f'If the button does not work, copy this link into your browser:<br>'
        f'<a href="{_e(url)}" style="color:{PRIMARY};">{_e(url)}</a></p>'
    )


def _code_box(value: str) -> str:
    return (
        f'<div style="margin:20px 0;padding:16px;background:#f3f4f6;border-radius:10px;text-align:center;'
        f'font-family:\'Courier New\',monospace;font-size:28px;letter-spacing:6px;font-weight:700;color:{TEXT};'
        f'word-break:break-all;">{_e(value)}</div>'
    )


def _p(text_html: str) -> str:
    return f'<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:{TEXT};">{text_html}</p>'


def _kv_table(rows) -> str:
    cells = "".join(
        f'<tr><td style="padding:8px 12px;font-size:14px;color:{MUTED};border-bottom:1px solid #e5e7eb;'
        f'white-space:nowrap;vertical-align:top;">{_e(k)}</td>'
        f'<td style="padding:8px 12px;font-size:14px;color:{TEXT};border-bottom:1px solid #e5e7eb;'
        f'word-break:break-word;">{v}</td></tr>'
        for k, v in rows
    )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin:16px 0;border:1px solid #e5e7eb;border-radius:10px;border-collapse:separate;">{cells}</table>'
    )


def _layout(title: str, preheader: str, content_html: str) -> str:
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{_e(title)}</title></head>
<body style="margin:0;padding:0;background:#f5f6fb;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{_e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f6fb;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="background:{PRIMARY};padding:18px 24px;">
<span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">{BRAND}</span>
</td></tr>
<tr><td style="padding:28px 24px 8px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:{TEXT};">{_e(title)}</h1>
{content_html}
</td></tr>
<tr><td style="padding:16px 24px 24px;border-top:1px solid #f0f0f5;">
<p style="margin:0;font-size:12px;line-height:1.5;color:{MUTED};">This is an automated message from {BRAND}. If you did not expect it, you can safely ignore it.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>"""


def _greeting(name: Optional[str]) -> str:
    name = (name or "").strip()
    return f"Hi {name}," if name else "Hi there,"


# --------------------------------------------------------------------------- builders

def signup_otp(name: Optional[str], otp: str, minutes: int = 10) -> Email:
    subject = f"Your {BRAND} verification code: {otp}"
    text = (
        f"{_greeting(name)}\n\nYour {BRAND} verification code is {otp}.\n"
        f"It expires in {minutes} minutes. Do not share it with anyone.\n\n- The {BRAND} team"
    )
    html = _layout(
        "Verify your email",
        f"Your verification code is {otp}",
        _p(_e(_greeting(name)))
        + _p(f"Use this code to finish creating your {BRAND} account:")
        + _code_box(otp)
        + _p(f"The code expires in <strong>{minutes} minutes</strong>. Never share it with anyone."),
    )
    return subject, text, html


def password_reset(name: Optional[str], email: str, token: str, minutes: int = 15) -> Email:
    subject = f"Reset your {BRAND} password"
    text = (
        f"{_greeting(name)}\n\nWe received a request to reset the password for {email}.\n"
        f"Use this reset token within {minutes} minutes:\n\n{token}\n\n"
        "If you did not request this, you can ignore this email; your password stays unchanged."
    )
    html = _layout(
        "Reset your password",
        "Use this token to reset your password",
        _p(_e(_greeting(name)))
        + _p(f"We received a request to reset the password for <strong>{_e(email)}</strong>. "
             f"Enter this reset token within <strong>{minutes} minutes</strong>:")
        + f'<div style="margin:20px 0;padding:14px;background:#f3f4f6;border-radius:10px;font-family:\'Courier New\',monospace;'
          f'font-size:16px;font-weight:700;color:{TEXT};word-break:break-all;text-align:center;">{_e(token)}</div>'
        + _p("If you did not request this, ignore this email. Your password stays unchanged."),
    )
    return subject, text, html


def recruiter_request_received(name: Optional[str], company_name: Optional[str] = None) -> Email:
    company = f" for {company_name}" if company_name else ""
    subject = f"We received your {BRAND} recruiter access request"
    text = (
        f"{_greeting(name)}\n\nThanks for requesting recruiter access{company} on {BRAND}.\n"
        "Our team verifies every company before granting access. You will get another email "
        "with your login details once your request is approved (usually within 1 business day).\n\n"
        f"- The {BRAND} team"
    )
    html = _layout(
        "Request received",
        "We are verifying your company details",
        _p(_e(_greeting(name)))
        + _p(f"Thanks for requesting recruiter access{_e(company)} on {BRAND}.")
        + _p("Our team verifies every company before granting access. You will receive another email "
             "with your login details once your request is approved, usually within 1 business day."),
    )
    return subject, text, html


def admin_new_recruiter_request(
    *,
    request_id: int,
    name: str,
    email: str,
    phone: str,
    company_name: Optional[str] = None,
    company_website: Optional[str] = None,
    designation: Optional[str] = None,
    score: Optional[int] = None,
    verdict: Optional[str] = None,
) -> Email:
    verdict_label = (verdict or "unknown").replace("_", " ").title()
    subject = f"New recruiter request: {company_name or name} - {verdict_label} ({score if score is not None else '?'}/100)"
    admin_link = app_url("/admin")
    rows = [
        ("Name", _e(name)),
        ("Email", _e(email)),
        ("Phone", _e(phone)),
        ("Designation", _e(designation or "-")),
        ("Company", _e(company_name or "-")),
        ("Website", _e(company_website or "-")),
        ("Verification", f"<strong>{_e(score if score is not None else '?')}/100</strong> - {_e(verdict_label)}"),
    ]
    text = (
        f"New recruiter access request #{request_id}\n\n"
        + "\n".join(f"{k}: {v}" for k, v in [
            ("Name", name), ("Email", email), ("Phone", phone), ("Designation", designation or "-"),
            ("Company", company_name or "-"), ("Website", company_website or "-"),
            ("Verification", f"{score if score is not None else '?'}/100 - {verdict_label}"),
        ])
        + f"\n\nReview it in the admin console: {admin_link}"
    )
    verdict_color = {"verified": "#16a34a", "review": "#d97706", "high_risk": "#dc2626"}.get(verdict or "", MUTED)
    html = _layout(
        "New recruiter access request",
        f"{name} from {company_name or 'unknown company'} - {verdict_label}",
        _p(f'Request <strong>#{_e(request_id)}</strong> is waiting for review. Automated verdict: '
           f'<strong style="color:{verdict_color};">{_e(verdict_label)}</strong>.')
        + _kv_table(rows)
        + _button("Open admin console", admin_link),
    )
    return subject, text, html


def recruiter_approved(name: Optional[str], email: str, temporary_password: str) -> Email:
    login_link = app_url("/recruiter")
    subject = f"Your {BRAND} recruiter account is approved"
    text = (
        f"{_greeting(name)}\n\nGood news: your recruiter account is ready.\n\n"
        f"Email: {email}\nTemporary password: {temporary_password}\n\n"
        f"Log in here: {login_link}\nPlease change your password after your first login.\n\n- The {BRAND} team"
    )
    html = _layout(
        "Your recruiter account is approved",
        "Your login details are inside",
        _p(_e(_greeting(name)))
        + _p("Good news: your company has been verified and your recruiter account is ready.")
        + _kv_table([
            ("Email", _e(email)),
            ("Temporary password", f'<span style="font-family:\'Courier New\',monospace;font-weight:700;">{_e(temporary_password)}</span>'),
        ])
        + _button("Log in to CoreLink", login_link)
        + _p("For your security, please change this password after your first login."),
    )
    return subject, text, html


def recruiter_rejected(name: Optional[str], reason: Optional[str] = None) -> Email:
    subject = f"Update on your {BRAND} recruiter access request"
    reason_line = f"\nReason: {reason}\n" if reason else ""
    text = (
        f"{_greeting(name)}\n\nThank you for your interest in {BRAND}. After reviewing your request, "
        "we were unable to verify your company details, so we can't grant recruiter access right now.\n"
        f"{reason_line}\nYou are welcome to submit a new request using your official work email and company website.\n\n"
        f"- The {BRAND} team"
    )
    html = _layout(
        "We couldn't approve your request",
        "Update on your recruiter access request",
        _p(_e(_greeting(name)))
        + _p(f"Thank you for your interest in {BRAND}. After reviewing your request, we were unable to verify "
             "your company details, so we can't grant recruiter access right now.")
        + (_p(f"<strong>Reason:</strong> {_e(reason)}") if reason else "")
        + _p("You are welcome to submit a new request using your official work email and company website."),
    )
    return subject, text, html


def interview_invitation(
    candidate_name: Optional[str],
    job_title: str,
    application_id: int,
    company_name: Optional[str] = None,
    batch_index: Optional[int] = None,
) -> Email:
    link = interview_link(application_id)
    at_company = f" at {company_name}" if company_name else ""
    subject = f"Interview invitation: {job_title}{at_company}"
    batch_line = f"You are scheduled in batch #{batch_index}.\n" if batch_index else ""
    text = (
        f"{_greeting(candidate_name)}\n\nCongratulations! You have been shortlisted for the AI video interview "
        f"for {job_title}{at_company}.\n{batch_line}\n"
        f"Start your interview here: {link}\n\n"
        "Tips: use a quiet room, a laptop or phone with a working camera and microphone, and a stable internet connection.\n\n"
        f"- The {BRAND} team"
    )
    html = _layout(
        "You're invited to interview",
        f"Your AI interview for {job_title} is ready",
        _p(_e(_greeting(candidate_name)))
        + _p(f"Congratulations! You have been shortlisted for the AI video interview for "
             f"<strong>{_e(job_title)}</strong>{_e(at_company)}.")
        + (_p(f"You are scheduled in <strong>batch #{_e(batch_index)}</strong>.") if batch_index else "")
        + _button("Start your interview", link)
        + _p("<strong>Before you start:</strong> find a quiet, well-lit room, allow camera and microphone access, "
             "and make sure your internet connection is stable."),
    )
    return subject, text, html


def interview_link(application_id: int) -> str:
    return app_url(f"/candidate/repo?interview={quote(str(application_id))}")


def interview_completed(candidate_name: Optional[str], job_title: str, company_name: Optional[str] = None) -> Email:
    at_company = f" at {company_name}" if company_name else ""
    subject = f"Interview completed: {job_title}"
    link = app_url("/candidate/repo")
    text = (
        f"{_greeting(candidate_name)}\n\nThanks for completing your interview for {job_title}{at_company}. "
        "Your responses have been submitted to the hiring team, who will review them and get back to you.\n\n"
        f"Track your application: {link}\n\n- The {BRAND} team"
    )
    html = _layout(
        "Interview submitted",
        f"Thanks for interviewing for {job_title}",
        _p(_e(_greeting(candidate_name)))
        + _p(f"Thanks for completing your interview for <strong>{_e(job_title)}</strong>{_e(at_company)}. "
             "Your responses have been submitted to the hiring team, who will review them and get back to you.")
        + _button("Track your application", link),
    )
    return subject, text, html


def welcome(name: Optional[str]) -> Email:
    link = app_url("/candidate/jobs")
    subject = f"Welcome to {BRAND}"
    text = (
        f"{_greeting(name)}\n\nWelcome to {BRAND}! Your candidate profile is set up. "
        "Upload your resume, explore open roles and use the ATS score to strengthen your applications.\n\n"
        f"Browse jobs: {link}\n\n- The {BRAND} team"
    )
    html = _layout(
        f"Welcome to {BRAND}",
        "Your candidate profile is ready",
        _p(_e(_greeting(name)))
        + _p(f"Welcome to {BRAND}! Your candidate profile is set up. Upload your resume, explore open roles "
             "and use the ATS score to strengthen your applications.")
        + _button("Browse jobs", link),
    )
    return subject, text, html


def delivery_test() -> Email:
    subject = f"{BRAND} email delivery test"
    text = f"This is a test email from {BRAND}. If you can read this, email delivery works."
    html = _layout("Email delivery works", "Test email", _p(_e(text)))
    return subject, text, html
