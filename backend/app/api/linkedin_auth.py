"""Sign in with LinkedIn (OpenID Connect, authorization-code flow). Free tier.

Flow: the page sends the browser to LinkedIn's authorize URL; LinkedIn redirects
back to <site>/auth/linkedin/callback?code=…&state=…; the page posts the code
here; we make ONE call to LinkedIn's token endpoint and read name + email from
the returned id_token. No profile scraping, no photo, no /userinfo call.

The id_token comes straight from LinkedIn over TLS in our own back-channel
request, so per OpenID Connect Core §3.1.3.7 we validate its claims
(issuer, audience, expiry, verified email) without fetching signing keys.

Env: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET (secret never leaves the server).
"""
import base64
import json
import logging
import os
import time
from typing import Callable

import requests
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, func, select

from ..db import CandidateProfile, CandidateUser, engine, utc_now
from ..rate_limit import limiter
from .google_auth import _candidate_login, _staff_login

logger = logging.getLogger("ats-platform")
router = APIRouter(tags=["linkedin-auth"])

TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
ISSUER = "https://www.linkedin.com/oauth"
CALLBACK_PATH = "/auth/linkedin/callback"


def client_id() -> str:
    return (os.environ.get("LINKEDIN_CLIENT_ID") or "").strip().strip('"').strip("'")


def client_secret() -> str:
    return (os.environ.get("LINKEDIN_CLIENT_SECRET") or "").strip().strip('"').strip("'")


def _configured() -> bool:
    return bool(client_id() and client_secret())


def allowed_redirect_uris() -> set:
    """<origin>/auth/linkedin/callback for the public site and every CORS origin."""
    origins = [os.environ.get("APP_PUBLIC_URL") or "http://localhost:5173"]
    raw = os.environ.get("CORS_ORIGINS") or ""
    if raw.strip() != "*":
        origins += raw.split(",")
    out = set()
    for o in origins:
        o = o.strip().strip('"').rstrip("/")
        if o.startswith("https://") or o.startswith("http://localhost") or o.startswith("http://127.0.0.1"):
            out.add(o + CALLBACK_PATH)
    return out


class LinkedInError(Exception):
    def __init__(self, code: str, description: str = ""):
        super().__init__(code)
        self.code = code
        self.description = description


def _exchange_with_linkedin(code: str, redirect_uri: str) -> dict:
    try:
        r = requests.post(TOKEN_URL, data={
            "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri,
            "client_id": client_id(), "client_secret": client_secret(),
        }, headers={"Accept": "application/json"}, timeout=12)
    except requests.RequestException as e:
        raise LinkedInError("network", str(e)[:200])
    try:
        body = r.json()
    except ValueError:
        body = {}
    if not r.ok:
        raise LinkedInError(str(body.get("error") or r.status_code), str(body.get("error_description") or "")[:300])
    return body


# Swappable in tests (like google_auth.verify_token).
exchange_code: Callable[[str, str], dict] = _exchange_with_linkedin


def _decode_id_token(token: str) -> dict:
    try:
        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        claims = json.loads(base64.urlsafe_b64decode(part))
        if not isinstance(claims, dict):
            raise ValueError
        return claims
    except Exception:
        raise LinkedInError("bad_id_token")


def _truthy(v) -> bool:
    return v is True or str(v).strip().lower() == "true"


def _friendly(err: LinkedInError) -> str:
    c, d = err.code, (err.description or "").lower()
    if c == "invalid_client" or "client" in d and "secret" in d:
        return "LinkedIn sign-in is misconfigured on the server (client ID / secret don't match the LinkedIn app)."
    if "redirect" in d:
        return "LinkedIn sign-in is misconfigured (this site's callback URL isn't registered in the LinkedIn app)."
    if c == "invalid_grant" or "expired" in d or "authorization code" in d:
        return "That LinkedIn sign-in expired. Please click “Continue with LinkedIn” again."
    if c == "network":
        return "Couldn't reach LinkedIn. Please try again in a moment."
    return "LinkedIn sign-in could not be verified. Please try again."


class LinkedInLogin(BaseModel):
    code: str
    redirect_uri: str
    role: str = "candidate"


@router.get("/api/auth/linkedin/config")
def linkedin_config():
    ok = _configured()
    return {"enabled": ok, "client_id": client_id() if ok else None}


def _mark_verified(username: str, email: str) -> None:
    with Session(engine) as s:
        u = s.exec(select(CandidateUser).where(func.lower(CandidateUser.username) == username.lower())).first()
        if not u:
            return
        p = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == u.id)).first()
        if not p:
            p = CandidateProfile(candidate_id=u.id, contact_email=email)
        try:
            prefs = json.loads(p.preferences_json or "{}")
        except ValueError:
            prefs = {}
        if not isinstance(prefs, dict):
            prefs = {}
        prefs["linkedin_verified"] = {"at": utc_now().isoformat(), "email": email}
        p.preferences_json = json.dumps(prefs)
        s.add(p)
        s.commit()


@router.post("/api/auth/linkedin")
@limiter.limit("20/minute")
def linkedin_login(request: Request, body: LinkedInLogin):
    if not _configured():
        raise HTTPException(503, "LinkedIn sign-in is not configured on the server")
    if not body.code or len(body.code) > 4096:
        raise HTTPException(400, "Missing LinkedIn authorization code")
    redirect_uri = (body.redirect_uri or "").strip()
    if redirect_uri not in allowed_redirect_uris():
        logger.warning("LinkedIn login: redirect_uri %s not in allowed list", redirect_uri[:200])
        raise HTTPException(400, "This website address isn't allowed for LinkedIn sign-in (check APP_PUBLIC_URL / CORS_ORIGINS on the server).")
    role = (body.role or "candidate").strip().lower()
    if role not in ("candidate", "recruiter", "admin"):
        raise HTTPException(400, "Unknown role")

    try:
        tokens = exchange_code(body.code, redirect_uri)
        if not tokens.get("id_token"):
            raise LinkedInError("no_id_token", "openid scope missing")
        claims = _decode_id_token(tokens["id_token"])
    except LinkedInError as e:
        logger.warning("LinkedIn token exchange failed: %s %s", e.code, e.description)
        if e.code == "no_id_token":
            raise HTTPException(401, "LinkedIn didn't share your email. Make sure the LinkedIn app has the “Sign In with LinkedIn using OpenID Connect” product.")
        raise HTTPException(401, _friendly(e))

    try:
        exp = float(claims.get("exp") or 0)
    except (TypeError, ValueError):
        exp = 0
    aud = claims.get("aud")
    aud_ok = aud == client_id() or (isinstance(aud, list) and client_id() in aud)
    if claims.get("iss") != ISSUER or not aud_ok or exp < time.time() - 10:
        logger.warning("LinkedIn id_token rejected: iss=%s aud_ok=%s exp=%s", claims.get("iss"), aud_ok, exp)
        raise HTTPException(401, "LinkedIn sign-in could not be verified. Please try again.")
    email = str(claims.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(403, "Your LinkedIn account didn't share an email address")
    if not _truthy(claims.get("email_verified")):
        raise HTTPException(403, "Please verify your email address on LinkedIn first, then try again")

    name = claims.get("name") or " ".join(x for x in (claims.get("given_name"), claims.get("family_name")) if x) or None
    if role == "candidate":
        result = _candidate_login(email, name, None)
        _mark_verified(result["username"], email)
        return result
    return _staff_login(email, role)
