"""Free LinkedIn OpenID Connect sign-in. No profile scraping or photo access."""
import base64, json, os, time
from typing import Callable
import requests
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session
from ..rate_limit import limiter
from .google_auth import _candidate_login, _staff_login

router = APIRouter(tags=["linkedin-auth"])

def _configured():
    return bool(os.environ.get("LINKEDIN_CLIENT_ID", "").strip() and os.environ.get("LINKEDIN_CLIENT_SECRET", "").strip())

def _origins():
    vals = [os.environ.get("APP_PUBLIC_URL", "http://localhost:5173").rstrip("/")]
    raw = os.environ.get("CORS_ORIGINS", "")
    if raw.strip() != "*": vals += [x.strip().rstrip("/") for x in raw.split(",") if x.strip()]
    return {f"{x}/auth/linkedin/callback" for x in vals}

def exchange_code(code: str, redirect_uri: str) -> dict:
    r = requests.post("https://www.linkedin.com/oauth/v2/accessToken", data={
        "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri,
        "client_id": os.environ["LINKEDIN_CLIENT_ID"], "client_secret": os.environ["LINKEDIN_CLIENT_SECRET"]
    }, timeout=10)
    if not r.ok: raise ValueError("token exchange failed")
    return r.json()

def _decode(token: str):
    try:
        part = token.split(".")[1]; part += "=" * (-len(part) % 4)
        return json.loads(base64.urlsafe_b64decode(part))
    except Exception as e: raise ValueError("invalid id token") from e

class LinkedInLogin(BaseModel):
    code: str
    redirect_uri: str
    role: str = "candidate"

@router.get("/api/auth/linkedin/config")
def linkedin_config():
    return {"enabled": _configured(), "client_id": os.environ.get("LINKEDIN_CLIENT_ID") if _configured() else None}

@router.post("/api/auth/linkedin")
@limiter.limit("20/minute")
def linkedin_login(request: Request, body: LinkedInLogin):
    if not _configured(): raise HTTPException(503, "LinkedIn sign-in is not configured on the server")
    if not body.code or len(body.code) > 4096: raise HTTPException(400, "Missing LinkedIn authorization code")
    if body.redirect_uri not in _origins(): raise HTTPException(400, "Invalid LinkedIn redirect URI")
    role = body.role.strip().lower()
    if role not in ("candidate", "recruiter", "admin"): raise HTTPException(400, "Unknown role")
    try: claims = _decode(exchange_code(body.code, body.redirect_uri)["id_token"])
    except Exception: raise HTTPException(401, "LinkedIn sign-in could not be verified. Please try again.")
    if claims.get("iss") != "https://www.linkedin.com/oauth" or claims.get("aud") != os.environ["LINKEDIN_CLIENT_ID"] or float(claims.get("exp", 0)) < time.time() - 10:
        raise HTTPException(401, "LinkedIn sign-in could not be verified. Please try again.")
    email = str(claims.get("email") or "").strip().lower()
    if not email or not claims.get("email_verified"): raise HTTPException(403, "Your LinkedIn email is not verified")
    result = _candidate_login(email, claims.get("name"), None) if role == "candidate" else _staff_login(email, role)
    if role == "candidate":
        from ..db import CandidateUser, CandidateProfile, engine, utc_now
        from sqlmodel import select
        with Session(engine) as s:
            u = s.exec(select(CandidateUser).where(CandidateUser.username == email)).first()
            p = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == u.id)).first()
            prefs = json.loads(p.preferences_json or "{}")
            prefs["linkedin_verified"] = {"at": utc_now().isoformat(), "email": email}
            p.preferences_json = json.dumps(prefs); s.add(p); s.commit()
    return result
