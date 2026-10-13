import hashlib
import json
import logging
import os
import secrets
import string
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from sqlmodel import Session, select
from starlette.concurrency import run_in_threadpool

from ..auth import create_access_token, get_current_admin, hash_password, verify_password
from ..db import EmailToken, RecruiterRequest, RecruiterUser, CandidateUser, User, engine, utc_now
from ..rate_limit import limiter
from ..services import email_templates
from ..services.email_delivery import EmailDeliveryError, queue_email, send_email
from ..services.recruiter_verification import verify_recruiter

router = APIRouter(tags=["auth"])
log = logging.getLogger("ats-platform.auth")


def _serialize_user(user: User) -> dict:
    return {"id": user.id, "name": user.name, "email": user.email, "phone": user.phone, "role": user.role}


def _dev_mode_enabled() -> bool:
    return (
        os.environ.get("DEV_MODE", "").lower() in {"1", "true", "yes"}
        or os.environ.get("DEBUG", "").lower() in {"1", "true", "yes"}
        or os.environ.get("ENV", "").lower() in {"development", "local", "test"}
    )



def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _create_email_token(session: Session, email: str, purpose: str, ttl_minutes: int = 10, digits: bool = False) -> str:
    token = f"{secrets.randbelow(1000000):06d}" if digits else secrets.token_urlsafe(24)
    session.add(EmailToken(
        email=email,
        purpose=purpose,
        token_hash=_hash_token(token),
        expires_at=utc_now() + timedelta(minutes=ttl_minutes),
    ))
    session.commit()
    return token


def _invalidate_email_tokens(session: Session, email: str, purpose: str) -> None:
    active_tokens = session.exec(
        select(EmailToken).where(
            EmailToken.email == email,
            EmailToken.purpose == purpose,
            EmailToken.used_at == None,  # noqa: E711
        )
    ).all()
    now = utc_now()
    for item in active_tokens:
        item.used_at = now
        session.add(item)
    session.commit()


def _send_email_or_dev(
    to: str,
    subject: str,
    body: str,
    dev_payload: Optional[dict] = None,
    html: Optional[str] = None,
    category: str = "general",
) -> dict:
    try:
        send_email(to, subject, body, html=html, category=category)
        return {"email_sent": True}
    except EmailDeliveryError as exc:
        log.warning("Email (%s) to %s not delivered: %s", category, to, exc)
        if _dev_mode_enabled():
            return {"email_sent": False, "dev_only": dev_payload or {}}
        raise HTTPException(status_code=502, detail="Email delivery is not configured")


def _queue_quietly(to: Optional[str], message: tuple, category: str) -> Optional[int]:
    """Fire-and-forget templated email; never raises."""
    if not to:
        return None
    subject, text, html = message
    try:
        return queue_email(to, subject, text, html=html, category=category)
    except Exception as exc:  # pragma: no cover - queue_email already swallows delivery errors
        log.warning("Could not queue %s email to %s: %s", category, to, exc)
        return None


def _create_user(
    session: Session,
    name: str,
    email: str,
    password: str,
    role: str,
    phone: Optional[str] = None,
    email_verified: bool = False,
) -> User:
    normalized_email = email.strip().lower()
    existing = session.exec(select(User).where(User.email == normalized_email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        name=name.strip(),
        email=normalized_email,
        phone=phone.strip() if phone else None,
        role=role,
        password_hash=hash_password(password),
        email_verified=email_verified,
    )
    session.add(user)
    if role == "recruiter":
        legacy = session.exec(select(RecruiterUser).where(RecruiterUser.username == normalized_email)).first()
        if not legacy:
            session.add(RecruiterUser(username=normalized_email, password_hash=user.password_hash))
    elif role == "candidate":
        legacy = session.exec(select(CandidateUser).where(CandidateUser.username == normalized_email)).first()
        if not legacy:
            session.add(CandidateUser(username=normalized_email, password_hash=user.password_hash))
    session.commit()
    session.refresh(user)
    return user


def ensure_admin_user() -> None:
    email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD", "")
    if not email or not password:
        return
    if len(password) < 8:
        raise RuntimeError("ADMIN_PASSWORD must be at least 8 characters")
    with Session(engine) as session:
        existing = session.exec(select(User).where(User.email == email)).first()
        if existing:
            if existing.role != "admin" or not existing.email_verified:
                existing.role = "admin"
                existing.email_verified = True
                session.add(existing)
                session.commit()
            return
        _create_user(session, name="Admin", email=email, password=password, role="admin", email_verified=True)


def _token_response(user: User) -> dict:
    email = user.email
    name = user.name
    role = user.role
    return {
        "access_token": create_access_token(email, role),
        "token_type": "bearer",
        "username": email,
        "email": email,
        "name": name,
        "role": role,
    }


@router.post("/api/auth/register")
@limiter.limit("20/minute")
async def register_candidate(request: Request, name: str = Form(""), email: str = Form(...), password: str = Form(...)):
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    with Session(engine) as session:
        user = _create_user(session, name=name or email, email=email, password=password, role="candidate")
        user_email = user.email
        otp = _create_email_token(session, user_email, "signup_otp", ttl_minutes=10, digits=True)
    subject, text, html = email_templates.signup_otp(name.strip() if name else None, otp, minutes=10)
    delivery = _send_email_or_dev(
        user_email,
        subject,
        text,
        {"otp": otp, "purpose": "signup_otp"},
        html=html,
        category="signup_otp",
    )
    return {"registered": True, "email": user_email, "verification_required": True, **delivery}


@router.post("/api/auth/verify-otp")
@limiter.limit("20/minute")
async def verify_signup_otp(request: Request, email: str = Form(...), otp: str = Form(...)):
    normalized_email = email.strip().lower()
    with Session(engine) as session:
        token = session.exec(
            select(EmailToken)
            .where(
                EmailToken.email == normalized_email,
                EmailToken.purpose == "signup_otp",
                EmailToken.used_at == None,  # noqa: E711
                EmailToken.expires_at > utc_now(),
            )
            .order_by(EmailToken.created_at.desc())
        ).first()
        if not token or token.token_hash != _hash_token(otp.strip()):
            raise HTTPException(status_code=400, detail="Invalid or expired OTP")
        user = session.exec(select(User).where(User.email == normalized_email)).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        token.used_at = utc_now()
        user.email_verified = True
        session.add(token)
        session.add(user)
        session.commit()
        session.refresh(user)
        return _token_response(user)


@router.post("/api/auth/login")
@limiter.limit("10/minute")
async def login(request: Request, email: str = Form(...), password: str = Form(...)):
    normalized_email = email.strip().lower()
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == normalized_email)).first()
        if not user:
            legacy = session.exec(select(RecruiterUser).where(RecruiterUser.username == normalized_email)).first()
            if legacy and verify_password(password, legacy.password_hash):
                user = User(
                    name=normalized_email,
                    email=normalized_email,
                    role="recruiter",
                    password_hash=legacy.password_hash,
                    email_verified=True,
                )
                session.add(user)
                session.commit()
                session.refresh(user)
        if not user or not verify_password(password, user.password_hash):
            raise HTTPException(status_code=401, detail="Incorrect email or password")
        if (user.status or "active") == "suspended":
            raise HTTPException(status_code=403, detail="This account is suspended")
        if user.role == "candidate" and not user.email_verified:
            raise HTTPException(status_code=403, detail="Email verification required")
        user.last_login_at = utc_now()
        session.add(user)
        session.commit()
        session.refresh(user)
        return _token_response(user)


@router.post("/api/auth/password-reset/request")
@limiter.limit("10/minute")
async def request_password_reset(request: Request, email: str = Form(...)):
    normalized_email = email.strip().lower()
    token = None
    user_name = None
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == normalized_email)).first()
        if user:
            user_name = user.name if user.name and user.name != user.email else None
            _invalidate_email_tokens(session, normalized_email, "password_reset")
            token = _create_email_token(session, normalized_email, "password_reset", ttl_minutes=15)
    if not token:
        return {"ok": True}
    subject, text, html = email_templates.password_reset(user_name, normalized_email, token, minutes=15)
    delivery = _send_email_or_dev(
        normalized_email,
        subject,
        text,
        {"reset_token": token, "purpose": "password_reset"},
        html=html,
        category="password_reset",
    )
    return {"ok": True, **delivery}


@router.post("/api/auth/password-reset/confirm")
@limiter.limit("10/minute")
async def confirm_password_reset(
    request: Request,
    email: str = Form(...),
    token: str = Form(...),
    new_password: str = Form(...),
):
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    normalized_email = email.strip().lower()
    with Session(engine) as session:
        stored = session.exec(
            select(EmailToken)
            .where(
                EmailToken.email == normalized_email,
                EmailToken.purpose == "password_reset",
                EmailToken.used_at == None,  # noqa: E711
                EmailToken.expires_at > utc_now(),
            )
            .order_by(EmailToken.created_at.desc())
        ).first()
        if not stored or stored.token_hash != _hash_token(token.strip()):
            raise HTTPException(status_code=400, detail="Invalid or expired reset token")
        user = session.exec(select(User).where(User.email == normalized_email)).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user.password_hash = hash_password(new_password)
        stored.used_at = utc_now()
        session.add(user)
        session.add(stored)
        if user.role == "recruiter":
            legacy = session.exec(select(RecruiterUser).where(RecruiterUser.username == normalized_email)).first()
            if legacy:
                legacy.password_hash = user.password_hash
                session.add(legacy)
        session.commit()
    return {"reset": True}


@router.post("/api/recruiter/auth/login")
@limiter.limit("10/minute")
async def recruiter_login(request: Request, username: str = Form(...), password: str = Form(...)):
    return await login(request=request, email=username, password=password)


@router.post("/api/recruiter/auth/register")
async def recruiter_register_disabled():
    raise HTTPException(status_code=403, detail="Recruiter accounts require admin approval")


def _verification_network_enabled() -> bool:
    """DNS/HTTP verification checks. Off under tests unless explicitly enabled."""
    flag = os.environ.get("RECRUITER_VERIFY_NETWORK", "").strip().lower()
    if flag:
        return flag in {"1", "true", "yes", "on"}
    return os.environ.get("TESTING") != "1"


def _clean(value: Optional[str], limit: int = 300) -> Optional[str]:
    value = (value or "").strip()
    return value[:limit] or None


async def _run_verification(name, email, phone, company_name, company_website, designation, gstin, cin, linkedin_url) -> dict:
    return await run_in_threadpool(
        verify_recruiter,
        name,
        email,
        phone,
        company_name,
        company_website,
        designation,
        gstin,
        cin,
        linkedin_url,
        network=_verification_network_enabled(),
    )


@router.post("/api/recruiter-requests/validate")
@limiter.limit("30/minute")
async def validate_recruiter_request(
    request: Request,
    name: str = Form(""),
    email: str = Form(""),
    phone: str = Form(""),
    company_name: Optional[str] = Form(None),
    company_website: Optional[str] = Form(None),
    designation: Optional[str] = Form(None),
    gstin: Optional[str] = Form(None),
    cin: Optional[str] = Form(None),
    linkedin_url: Optional[str] = Form(None),
):
    """Live verification feedback for the access-request form. Nothing is stored."""
    return await _run_verification(
        _clean(name, 120) or "", (email or "").strip().lower()[:254], _clean(phone, 40) or "",
        _clean(company_name, 200), _clean(company_website, 300), _clean(designation, 120),
        _clean(gstin, 20), _clean(cin, 30), _clean(linkedin_url, 300),
    )


@router.post("/api/recruiter-requests")
@limiter.limit("20/minute")
async def create_recruiter_request(
    request: Request,
    name: str = Form(...),
    email: str = Form(...),
    phone: str = Form(...),
    company_name: Optional[str] = Form(None),
    company_website: Optional[str] = Form(None),
    designation: Optional[str] = Form(None),
    gstin: Optional[str] = Form(None),
    cin: Optional[str] = Form(None),
    linkedin_url: Optional[str] = Form(None),
):
    normalized_email = email.strip().lower()
    company_name = _clean(company_name, 200)
    company_website = _clean(company_website, 300)
    designation = _clean(designation, 120)
    gstin = (_clean(gstin, 20) or "").upper() or None
    cin = (_clean(cin, 30) or "").upper() or None
    linkedin_url = _clean(linkedin_url, 300)

    with Session(engine) as session:
        existing_user = session.exec(select(User).where(User.email == normalized_email)).first()
        if existing_user:
            raise HTTPException(status_code=409, detail="Email already registered")
        existing_pending = session.exec(
            select(RecruiterRequest).where(
                RecruiterRequest.email == normalized_email,
                RecruiterRequest.status == "pending",
            )
        ).first()
        if existing_pending:
            raise HTTPException(status_code=409, detail="Recruiter request already pending")

    verification = await _run_verification(
        name.strip(), normalized_email, phone.strip(), company_name, company_website, designation, gstin, cin, linkedin_url
    )
    if verification["blocked"]:
        raise HTTPException(status_code=422, detail=verification["block_reason"] or "Request could not be accepted")

    with Session(engine) as session:
        recruiter_request = RecruiterRequest(
            name=name.strip(),
            email=normalized_email,
            phone=phone.strip(),
            company_name=company_name,
            company_website=company_website,
            designation=designation,
            gstin=gstin,
            cin=cin,
            linkedin_url=linkedin_url,
            verification_score=verification["score"],
            verification_verdict=verification["verdict"],
            verification_json=json.dumps(verification),
        )
        session.add(recruiter_request)
        session.commit()
        session.refresh(recruiter_request)
        result = {
            "id": recruiter_request.id,
            "status": recruiter_request.status,
            "submitted_at": recruiter_request.submitted_at,
            "verification": {"score": verification["score"], "verdict": verification["verdict"]},
        }
        request_id = recruiter_request.id

    _queue_quietly(
        normalized_email,
        email_templates.recruiter_request_received(name.strip(), company_name),
        "recruiter_request_received",
    )
    admin_email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    if admin_email:
        _queue_quietly(
            admin_email,
            email_templates.admin_new_recruiter_request(
                request_id=request_id,
                name=name.strip(),
                email=normalized_email,
                phone=phone.strip(),
                company_name=company_name,
                company_website=company_website,
                designation=designation,
                score=verification["score"],
                verdict=verification["verdict"],
            ),
            "admin_new_recruiter_request",
        )
    return result


def _parse_verification(raw: Optional[str]) -> Optional[dict]:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def _serialize_recruiter_request(item: RecruiterRequest) -> dict:
    return {
        "id": item.id,
        "name": item.name,
        "email": item.email,
        "phone": item.phone,
        "status": item.status,
        "submitted_at": item.submitted_at,
        "company_name": item.company_name,
        "company_website": item.company_website,
        "designation": item.designation,
        "gstin": item.gstin,
        "cin": item.cin,
        "linkedin_url": item.linkedin_url,
        "verification_score": item.verification_score,
        "verification_verdict": item.verification_verdict,
        "verification": _parse_verification(item.verification_json),
    }


@router.get("/api/admin/recruiter-requests")
async def list_recruiter_requests(admin: User = Depends(get_current_admin)):
    with Session(engine) as session:
        requests = session.exec(
            select(RecruiterRequest)
            .where(RecruiterRequest.status == "pending")
            .order_by(RecruiterRequest.submitted_at.asc())
        ).all()
        return [_serialize_recruiter_request(item) for item in requests]


@router.post("/api/admin/recruiter-requests/{request_id}/reverify")
async def reverify_recruiter_request(request_id: int, admin: User = Depends(get_current_admin)):
    with Session(engine) as session:
        item = session.get(RecruiterRequest, request_id)
        if not item:
            raise HTTPException(status_code=404, detail="Recruiter request not found")
        args = (item.name, item.email, item.phone, item.company_name, item.company_website,
                item.designation, item.gstin, item.cin, item.linkedin_url)
    verification = await _run_verification(*args)
    with Session(engine) as session:
        item = session.get(RecruiterRequest, request_id)
        if not item:
            raise HTTPException(status_code=404, detail="Recruiter request not found")
        item.verification_score = verification["score"]
        item.verification_verdict = verification["verdict"]
        item.verification_json = json.dumps(verification)
        session.add(item)
        session.commit()
        session.refresh(item)
        return _serialize_recruiter_request(item)


@router.post("/api/admin/recruiter-requests/{request_id}/approve")
async def approve_recruiter_request(request_id: int, admin: User = Depends(get_current_admin)):
    alphabet = string.ascii_letters + string.digits
    generated_password = "".join(secrets.choice(alphabet) for _ in range(14))
    with Session(engine) as session:
        recruiter_request = session.get(RecruiterRequest, request_id)
        if not recruiter_request:
            raise HTTPException(status_code=404, detail="Recruiter request not found")
        if recruiter_request.status != "pending":
            raise HTTPException(status_code=400, detail="Recruiter request already decided")
        user = _create_user(
            session,
            name=recruiter_request.name,
            email=recruiter_request.email,
            phone=recruiter_request.phone,
            password=generated_password,
            role="recruiter",
            email_verified=True,
        )
        user_data = _serialize_user(user)
        user_email = user.email
        recruiter_request.status = "approved"
        recruiter_request.decided_at = utc_now()
        session.add(recruiter_request)
        session.commit()
    subject, text, html = email_templates.recruiter_approved(user_data.get("name"), user_email, generated_password)
    try:
        delivery = _send_email_or_dev(
            user_email,
            subject,
            text,
            {"temporary_password": generated_password, "purpose": "recruiter_credentials"},
            html=html,
            category="recruiter_approved",
        )
        response = {"approved": True, "user": user_data, **delivery}
    except HTTPException as e:
        if e.status_code == 502:
            response = {
                "approved": True,
                "user": user_data,
                "email_sent": False,
                "warning": "Recruiter account created but email delivery failed.",
            }
        else:
            raise
    
    if _dev_mode_enabled():
        response["temporary_password"] = generated_password
    return response


@router.post("/api/admin/recruiter-requests/{request_id}/reject")
async def reject_recruiter_request(
    request_id: int,
    reason: Optional[str] = Form(None),
    admin: User = Depends(get_current_admin),
):
    with Session(engine) as session:
        recruiter_request = session.get(RecruiterRequest, request_id)
        if not recruiter_request:
            raise HTTPException(status_code=404, detail="Recruiter request not found")
        if recruiter_request.status != "pending":
            raise HTTPException(status_code=400, detail="Recruiter request already decided")
        recruiter_request.status = "rejected"
        recruiter_request.decided_at = utc_now()
        session.add(recruiter_request)
        session.commit()
        rejected_email = recruiter_request.email
        rejected_name = recruiter_request.name
    _queue_quietly(
        rejected_email,
        email_templates.recruiter_rejected(rejected_name, _clean(reason, 500)),
        "recruiter_rejected",
    )
    return {"rejected": True, "id": request_id}
