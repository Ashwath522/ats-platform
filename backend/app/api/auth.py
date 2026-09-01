import hashlib
import os
import secrets
import string
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from sqlmodel import Session, select

from ..auth import create_access_token, get_current_admin, hash_password, verify_password
from ..db import EmailToken, RecruiterRequest, RecruiterUser, CandidateUser, User, engine, utc_now
from ..rate_limit import limiter
from ..services.email_delivery import EmailDeliveryError, send_email

router = APIRouter(tags=["auth"])


def _serialize_user(user: User) -> dict:
    return {"id": user.id, "name": user.name, "email": user.email, "phone": user.phone, "role": user.role}


def _dev_mode_enabled() -> bool:
    return os.environ.get("DEV_MODE", "").lower() in {"1", "true", "yes"}


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


def _send_email_or_dev(to: str, subject: str, body: str, dev_payload: Optional[dict] = None) -> dict:
    try:
        send_email(to, subject, body)
        return {"email_sent": True}
    except EmailDeliveryError:
        if _dev_mode_enabled():
            return {"email_sent": False, "dev_only": dev_payload or {}}
        raise HTTPException(status_code=502, detail="Email delivery is not configured")


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
    delivery = _send_email_or_dev(
        user_email,
        "Verify your ATS Platform account",
        f"Your ATS Platform verification OTP is {otp}. It expires in 10 minutes.",
        {"otp": otp, "purpose": "signup_otp"},
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
        if user.role == "candidate" and not user.email_verified:
            raise HTTPException(status_code=403, detail="Email verification required")
        return _token_response(user)


@router.post("/api/auth/password-reset/request")
@limiter.limit("10/minute")
async def request_password_reset(request: Request, email: str = Form(...)):
    normalized_email = email.strip().lower()
    token = None
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == normalized_email)).first()
        if user:
            _invalidate_email_tokens(session, normalized_email, "password_reset")
            token = _create_email_token(session, normalized_email, "password_reset", ttl_minutes=15)
    if not token:
        return {"ok": True}
    delivery = _send_email_or_dev(
        normalized_email,
        "Reset your ATS Platform password",
        f"Use this reset token within 15 minutes: {token}",
        {"reset_token": token, "purpose": "password_reset"},
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


@router.post("/api/recruiter-requests")
@limiter.limit("20/minute")
async def create_recruiter_request(request: Request, name: str = Form(...), email: str = Form(...), phone: str = Form(...)):
    with Session(engine) as session:
        normalized_email = email.strip().lower()
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
        recruiter_request = RecruiterRequest(name=name.strip(), email=normalized_email, phone=phone.strip())
        session.add(recruiter_request)
        session.commit()
        session.refresh(recruiter_request)
        return {
            "id": recruiter_request.id,
            "status": recruiter_request.status,
            "submitted_at": recruiter_request.submitted_at,
        }


@router.get("/api/admin/recruiter-requests")
async def list_recruiter_requests(admin: User = Depends(get_current_admin)):
    with Session(engine) as session:
        requests = session.exec(
            select(RecruiterRequest)
            .where(RecruiterRequest.status == "pending")
            .order_by(RecruiterRequest.submitted_at.asc())
        ).all()
        return [
            {
                "id": item.id,
                "name": item.name,
                "email": item.email,
                "phone": item.phone,
                "status": item.status,
                "submitted_at": item.submitted_at,
            }
            for item in requests
        ]


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
    try:
        delivery = _send_email_or_dev(
            user_email,
            "Your ATS Platform recruiter account is approved",
            f"Your recruiter account is ready.\n\nEmail: {user_email}\nTemporary password: {generated_password}",
            {"temporary_password": generated_password, "purpose": "recruiter_credentials"},
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
async def reject_recruiter_request(request_id: int, admin: User = Depends(get_current_admin)):
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
    return {"rejected": True, "id": request_id}
