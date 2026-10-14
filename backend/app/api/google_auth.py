"""Sign in with Google (Google Identity Services ID tokens).

Flow: the web page shows Google's button, Google returns a signed ID token
(JWT) for the chosen account, the page posts it here, we verify the signature,
audience (our GOOGLE_CLIENT_ID), issuer, expiry and that the email is verified,
then sign the person in with the same token shape as the password logins.

  * candidate - existing student account with that email, or a new one.
  * recruiter - only an existing, approved recruiter account (company checks
                stay with the admin approval flow); admins may also use it.
  * admin     - only an existing admin account.

Only the client ID is needed (public, not a secret). GET /api/auth/google/config
tells the frontend whether the button should be shown.
"""
import os
import secrets
from typing import Callable, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, func, select

from ..auth import create_access_token, hash_password
from ..db import CandidateProfile, CandidateUser, RecruiterUser, User, engine, utc_now
from ..rate_limit import limiter

router = APIRouter(tags=["google-auth"])

GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")


def client_id() -> str:
    return (os.environ.get("GOOGLE_CLIENT_ID") or "").strip()


def _verify_with_google(credential: str, audience: str) -> dict:
    from google.auth.transport import requests as g_requests
    from google.oauth2 import id_token
    return id_token.verify_oauth2_token(credential, g_requests.Request(), audience, clock_skew_in_seconds=10)


# Swappable in tests.
verify_token: Callable[[str, str], dict] = _verify_with_google


class GoogleLogin(BaseModel):
    credential: str
    role: str = "candidate"


@router.get("/api/auth/google/config")
async def google_config():
    cid = client_id()
    return {"enabled": bool(cid), "client_id": cid or None}


def _claims(credential: str) -> dict:
    cid = client_id()
    if not cid:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured on the server")
    if not credential or len(credential) > 4096:
        raise HTTPException(status_code=400, detail="Missing Google credential")
    try:
        claims = verify_token(credential, cid)
    except Exception:
        raise HTTPException(status_code=401, detail="Google sign-in could not be verified. Please try again.")
    if claims.get("aud") != cid or claims.get("iss") not in GOOGLE_ISSUERS:
        raise HTTPException(status_code=401, detail="Google sign-in could not be verified. Please try again.")
    email = (claims.get("email") or "").strip().lower()
    if not email or not claims.get("email_verified"):
        raise HTTPException(status_code=403, detail="Your Google account email is not verified")
    claims["email"] = email
    return claims


def _candidate_login(email: str, name: Optional[str], picture: Optional[str]) -> dict:
    with Session(engine) as s:
        user = s.exec(select(CandidateUser).where(func.lower(CandidateUser.username) == email)).first()
        created = False
        if user is None:
            # Random password: the account is reachable via Google (or "Forgot password").
            user = CandidateUser(username=email, password_hash=hash_password(secrets.token_urlsafe(24)), last_login_at=utc_now())
            s.add(user)
            s.commit()
            s.refresh(user)
            s.add(CandidateProfile(candidate_id=user.id, contact_email=email, full_name=(name or None)))
            s.commit()
            created = True
        if (user.status or "active") == "suspended":
            raise HTTPException(status_code=403, detail="This account is suspended. Contact support.")
        if not created:
            user.last_login_at = utc_now()
            s.add(user)
            prof = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == user.id)).first()
            if prof and not prof.full_name and name:
                prof.full_name = name
                s.add(prof)
            s.commit()
        username = user.username
    token = create_access_token(username, role="candidate")
    return {"access_token": token, "token_type": "bearer", "username": username, "role": "candidate", "created": created}


def _staff_login(email: str, want: str) -> dict:
    with Session(engine) as s:
        user = s.exec(select(User).where(User.email == email)).first()
        if user is None and want == "recruiter":
            legacy = s.exec(select(RecruiterUser).where(func.lower(RecruiterUser.username) == email)).first()
            if legacy:   # approved recruiter from the older table - mirror it like the password login does
                user = User(name=email, email=email, role="recruiter", password_hash=legacy.password_hash, email_verified=True)
                s.add(user)
                s.commit()
                s.refresh(user)
        allowed = ("recruiter", "admin") if want == "recruiter" else ("admin",)
        if user is None or user.role not in allowed:
            if want == "admin":
                raise HTTPException(status_code=403, detail="This Google account is not a CoreLink admin")
            raise HTTPException(status_code=403, detail="No approved recruiter account uses this Google email. Use “Contact Us” to request access.")
        if (user.status or "active") == "suspended":
            raise HTTPException(status_code=403, detail="This account is suspended")
        user.last_login_at = utc_now()
        if not user.email_verified:
            user.email_verified = True   # Google has verified the address
        s.add(user)
        s.commit()
        s.refresh(user)
        return {
            "access_token": create_access_token(user.email, user.role),
            "token_type": "bearer", "username": user.email, "email": user.email, "name": user.name, "role": user.role,
        }


@router.post("/api/auth/google")
@limiter.limit("20/minute")
async def google_login(request: Request, body: GoogleLogin):
    role = (body.role or "candidate").strip().lower()
    if role not in ("candidate", "recruiter", "admin"):
        raise HTTPException(status_code=400, detail="Unknown role")
    claims = _claims(body.credential)
    if role == "candidate":
        return _candidate_login(claims["email"], claims.get("name"), claims.get("picture"))
    return _staff_login(claims["email"], role)
