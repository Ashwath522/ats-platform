from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, Request
from sqlmodel import Session, select

from ..db import engine, CandidateUser, CandidateProfile, EmailToken, utc_now
from ..auth import hash_password, verify_password, create_access_token, record_login
from ..rate_limit import limiter
from ..services import email_templates

router = APIRouter(prefix="/api/candidate/auth", tags=["candidate-auth"])


@router.post("/register")
@limiter.limit("20/minute")
def register(request: Request, username: str = Form(...), password: str = Form(...)):
    username = username.strip()
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    with Session(engine) as session:
        existing = session.exec(select(CandidateUser).where(CandidateUser.username == username)).first()
        if existing:
            raise HTTPException(status_code=409, detail="Username already taken")
        user = CandidateUser(username=username, password_hash=hash_password(password), last_login_at=utc_now())
        session.add(user)
        session.commit()
        session.refresh(user)
        if "@" in username:
            # Pre-fill the contact email so notifications reach the student.
            session.add(CandidateProfile(candidate_id=user.id, contact_email=username))
            session.commit()
    token = create_access_token(username, role="candidate")
    return {"access_token": token, "token_type": "bearer", "username": username}


@router.post("/login")
@limiter.limit("10/minute")
def login(request: Request, background: BackgroundTasks, username: str = Form(...), password: str = Form(...)):
    username = username.strip()
    # One query (id, hash, status); last_login_at is written after the response.
    with Session(engine) as session:
        row = session.exec(select(CandidateUser.id, CandidateUser.password_hash, CandidateUser.status)
                           .where(CandidateUser.username == username)).first()
    if not row or not verify_password(password, row[1]):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    if (row[2] or "active") == "suspended":
        raise HTTPException(status_code=403, detail="This account is suspended. Contact support.")
    background.add_task(record_login, CandidateUser, row[0], password, row[1])
    token = create_access_token(username, role="candidate")
    return {"access_token": token, "token_type": "bearer", "username": username}


# ── Forgot password (student accounts live in CandidateUser, not User) ──────

def _recipient(session: Session, user: CandidateUser) -> str | None:
    if "@" in user.username:
        return user.username
    profile = session.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == user.id)).first()
    return profile.contact_email if profile and profile.contact_email else None


@router.post("/password-reset/request")
@limiter.limit("10/minute")
def candidate_reset_request(request: Request, username: str = Form(...)):
    """Always answers ok (no account enumeration)."""
    from .auth import _create_email_token, _invalidate_email_tokens, _send_email_or_dev

    key = username.strip()
    with Session(engine) as session:
        user = session.exec(select(CandidateUser).where(CandidateUser.username == key)).first()
        to = _recipient(session, user) if user else None
        if not user or not to:
            return {"ok": True}
        _invalidate_email_tokens(session, key, "candidate_reset")
        token = _create_email_token(session, key, "candidate_reset", ttl_minutes=15)
    subject, text, html = email_templates.password_reset(None, to, token, minutes=15)
    delivery = _send_email_or_dev(to, subject, text, {"reset_token": token, "purpose": "candidate_reset"}, html=html, category="password_reset")
    return {"ok": True, **delivery}


@router.post("/password-reset/confirm")
@limiter.limit("10/minute")
def candidate_reset_confirm(request: Request, username: str = Form(...), token: str = Form(...), new_password: str = Form(...)):
    from .auth import _hash_token

    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    key = username.strip()
    with Session(engine) as session:
        stored = session.exec(
            select(EmailToken).where(
                EmailToken.email == key,
                EmailToken.purpose == "candidate_reset",
                EmailToken.used_at == None,  # noqa: E711
                EmailToken.expires_at > utc_now(),
            ).order_by(EmailToken.created_at.desc())
        ).first()
        if not stored or stored.token_hash != _hash_token(token.strip()):
            raise HTTPException(status_code=400, detail="Invalid or expired reset code")
        user = session.exec(select(CandidateUser).where(CandidateUser.username == key)).first()
        if not user:
            raise HTTPException(status_code=404, detail="Account not found")
        user.password_hash = hash_password(new_password)
        stored.used_at = utc_now()
        session.add(user)
        session.add(stored)
        session.commit()
    return {"reset": True}


@router.post("/change-password")
@limiter.limit("10/minute")
def candidate_change_password(request: Request, current_password: str = Form(...), new_password: str = Form(...)):
    from fastapi.security.utils import get_authorization_scheme_param
    from ..auth import decode_token_payload

    scheme, tok = get_authorization_scheme_param(request.headers.get("Authorization", ""))
    if scheme.lower() != "bearer" or not tok:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token_payload(tok)
    if payload.get("role") != "candidate":
        raise HTTPException(status_code=403, detail="Insufficient role")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    with Session(engine) as session:
        user = session.exec(select(CandidateUser).where(CandidateUser.username == payload["sub"])).first()
        if not user or not verify_password(current_password, user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        user.password_hash = hash_password(new_password)
        session.add(user)
        session.commit()
    return {"changed": True}
