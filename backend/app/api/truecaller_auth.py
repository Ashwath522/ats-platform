"""Phone verification / sign-in with Truecaller (mobile-web flow). Free.

How the Truecaller web flow works
  1. The page asks us for a one-time `requestNonce`        POST /api/auth/truecaller/start
  2. The page opens   truecallersdk://truesdk/web_verify?requestNonce=…&partnerKey=…
     on an Android phone with the Truecaller app; the user taps "Continue".
  3. Truecaller's servers POST {requestId, accessToken, endpoint} to our
     callback URL (registered in the Truecaller developer portal)
                                                           POST /api/auth/truecaller/callback
  4. We fetch the verified profile from `endpoint` with that token (only
     *.truecaller.com hosts are accepted) and store the result on the nonce.
  5. The page polls                                         GET  /api/auth/truecaller/status?nonce=…
     → for "login" it receives the normal CoreLink token; for "verify_phone"
       the signed-in student's phone number is marked verified.

Env: TRUECALLER_PARTNER_KEY (public app key), TRUECALLER_PARTNER_NAME (optional).
Nothing secret is stored; the access token is used once and discarded.
"""
import json
import logging
import os
import re
import secrets
from datetime import timedelta
from typing import Callable, Optional
from urllib.parse import urlparse

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlmodel import Session, func, select

from ..auth import decode_token_payload
from ..db import AnalysisCache, CandidateProfile, CandidateUser, engine, utc_now
from ..rate_limit import limiter
from .google_auth import _candidate_login

logger = logging.getLogger("ats-platform")
router = APIRouter(tags=["truecaller-auth"])

PREFIX = "truecaller:"
TTL = timedelta(minutes=10)
PHONE_KEY = "phone_verified"
_optional_bearer = HTTPBearer(auto_error=False)


def partner_key() -> str:
    return (os.environ.get("TRUECALLER_PARTNER_KEY") or "").strip().strip('"').strip("'")


def partner_name() -> str:
    return (os.environ.get("TRUECALLER_PARTNER_NAME") or "CoreLink").strip()[:40]


def normalize_phone(raw) -> Optional[str]:
    """'+91 98765 43210' / '919876543210' / 9876543210 → '+919876543210'."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) == 10:
        digits = "91" + digits
    if not (11 <= len(digits) <= 15):
        return None
    return "+" + digits


# ── nonce store (re-uses the small key/value AnalysisCache table) ─────────

def _load(nonce: str) -> Optional[dict]:
    with Session(engine) as s:
        row = s.exec(select(AnalysisCache).where(AnalysisCache.cache_key == PREFIX + nonce)).first()
        if not row:
            return None
        try:
            data = json.loads(row.payload_json)
        except ValueError:
            return None
        created = row.created_at
        now = utc_now()
        if created.tzinfo is None:
            now = now.replace(tzinfo=None)
        if now - created > TTL:
            data["status"] = "expired"
        return data


def _save(nonce: str, data: dict, *, new: bool = False) -> None:
    with Session(engine) as s:
        row = s.exec(select(AnalysisCache).where(AnalysisCache.cache_key == PREFIX + nonce)).first()
        if row is None:
            row = AnalysisCache(cache_key=PREFIX + nonce, payload_json=json.dumps(data))
        else:
            row.payload_json = json.dumps(data)
            if new:
                row.created_at = utc_now()
        s.add(row)
        s.commit()


def _fetch_profile(endpoint: str, token: str) -> dict:
    u = urlparse(endpoint)
    host = (u.hostname or "").lower()
    if u.scheme != "https" or not (host == "truecaller.com" or host.endswith(".truecaller.com")):
        raise ValueError("endpoint not allowed")
    r = requests.get(endpoint, headers={"Authorization": f"Bearer {token}", "Cache-Control": "no-cache"}, timeout=10)
    if not r.ok:
        raise ValueError(f"profile fetch failed ({r.status_code})")
    return r.json()


# Swappable in tests.
fetch_profile: Callable[[str, str], dict] = _fetch_profile


def _parse_profile(p: dict) -> dict:
    phones = p.get("phoneNumbers") or []
    phone = normalize_phone(phones[0]) if phones else None
    name = p.get("name") or {}
    full = " ".join(x for x in (name.get("first"), name.get("last")) if x).strip() if isinstance(name, dict) else str(name or "")
    email = ""
    ids = p.get("onlineIdentities") or {}
    if isinstance(ids, dict):
        email = str(ids.get("email") or "").strip().lower()
    return {"phone": phone, "name": full[:120] or None, "email": email if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email) else ""}


# ── endpoints ─────────────────────────────────────────────────────────────

@router.get("/api/auth/truecaller/config")
def truecaller_config():
    key = partner_key()
    return {"enabled": bool(key), "partner_key": key or None, "partner_name": partner_name() if key else None}


class StartBody(BaseModel):
    purpose: str = "login"          # login | verify_phone


@router.post("/api/auth/truecaller/start")
@limiter.limit("15/minute")
def truecaller_start(request: Request, body: StartBody, creds: Optional[HTTPAuthorizationCredentials] = Depends(_optional_bearer)):
    if not partner_key():
        raise HTTPException(503, "Truecaller verification is not configured on the server")
    purpose = (body.purpose or "login").strip().lower()
    if purpose not in ("login", "verify_phone"):
        raise HTTPException(400, "Unknown purpose")
    candidate = None
    if purpose == "verify_phone":
        payload = decode_token_payload(creds.credentials) if creds else None
        if not payload or payload.get("role") != "candidate":
            raise HTTPException(401, "Sign in as a student to verify your phone")
        candidate = payload.get("sub")
    nonce = secrets.token_hex(16)
    _save(nonce, {"status": "pending", "purpose": purpose, "candidate": candidate}, new=True)
    return {"nonce": nonce, "partner_key": partner_key(), "partner_name": partner_name(), "ttl_ms": int(TTL.total_seconds() * 1000)}


@router.post("/api/auth/truecaller/callback")
async def truecaller_callback(request: Request):
    """Called by Truecaller's servers. Always answers 200 so Truecaller doesn't retry forever."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return {"ok": False}
    nonce = str(body.get("requestId") or "")[:64]
    if not re.fullmatch(r"[0-9a-f]{32}", nonce):
        return {"ok": False}
    data = _load(nonce)
    if not data or data.get("status") != "pending":
        return {"ok": False}
    if body.get("status") == "user_rejected" or not body.get("accessToken"):
        data["status"] = "rejected"
        _save(nonce, data)
        return {"ok": True}
    try:
        prof = _parse_profile(fetch_profile(str(body.get("endpoint") or ""), str(body["accessToken"])))
    except Exception as e:  # noqa: BLE001
        logger.warning("Truecaller profile fetch failed: %s", e)
        data["status"] = "failed"
        _save(nonce, data)
        return {"ok": False}
    if not prof["phone"]:
        data["status"] = "failed"
        _save(nonce, data)
        return {"ok": False}
    data.update({"status": "verified", "profile": prof})
    _save(nonce, data)
    return {"ok": True}


def _mark_phone(session: Session, profile: CandidateProfile, phone: str) -> None:
    try:
        prefs = json.loads(profile.preferences_json or "{}")
    except ValueError:
        prefs = {}
    if not isinstance(prefs, dict):
        prefs = {}
    prefs[PHONE_KEY] = {"at": utc_now().isoformat(), "phone": phone, "via": "truecaller"}
    profile.preferences_json = json.dumps(prefs)
    profile.contact_phone = phone
    profile.updated_at = utc_now()
    session.add(profile)


def _profile_for_phone(session: Session, phone: str):
    """Student whose *verified* phone is this number."""
    rows = session.exec(select(CandidateProfile).where(CandidateProfile.contact_phone == phone)).all()
    for p in rows:
        try:
            v = (json.loads(p.preferences_json or "{}") or {}).get(PHONE_KEY)
        except ValueError:
            v = None
        if isinstance(v, dict) and v.get("phone") == phone:
            return p
    return None


@router.get("/api/auth/truecaller/status")
@limiter.limit("90/minute")
def truecaller_status(request: Request, nonce: str):
    if not re.fullmatch(r"[0-9a-f]{32}", nonce or ""):
        raise HTTPException(400, "Bad request")
    data = _load(nonce)
    if not data:
        return {"status": "expired"}
    status = data.get("status")
    if status != "verified":
        return {"status": status}

    prof = data["profile"]
    phone = prof["phone"]
    data["status"] = "used"           # single use
    _save(nonce, data)

    with Session(engine) as s:
        if data.get("purpose") == "verify_phone":
            user = s.exec(select(CandidateUser).where(CandidateUser.username == data.get("candidate"))).first()
            if not user:
                return {"status": "failed", "detail": "Account not found"}
            owner = _profile_for_phone(s, phone)
            if owner and owner.candidate_id != user.id:
                return {"status": "failed", "detail": "This phone number is already verified on another CoreLink account."}
            p = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == user.id)).first()
            if not p:
                p = CandidateProfile(candidate_id=user.id)
            _mark_phone(s, p, phone)
            s.commit()
            return {"status": "verified", "purpose": "verify_phone", "phone": phone}

        # login: existing student with this verified phone → sign in
        owner = _profile_for_phone(s, phone)
        if owner:
            user = s.get(CandidateUser, owner.candidate_id)
            username = user.username if user else None
        else:
            username = None
    if username:
        result = _candidate_login(username.lower(), prof.get("name"), None)
    elif prof.get("email"):
        result = _candidate_login(prof["email"], prof.get("name"), None)
        with Session(engine) as s:
            u = s.exec(select(CandidateUser).where(func.lower(CandidateUser.username) == result["username"].lower())).first()
            p = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == u.id)).first() if u else None
            if p and not _profile_for_phone(s, phone):
                _mark_phone(s, p, phone)
                s.commit()
    else:
        return {"status": "no_account", "phone": phone,
                "detail": "No CoreLink account uses this number yet. Sign up with Google, LinkedIn or Email, then verify your phone in Settings."}
    result.update({"status": "verified", "purpose": "login", "phone": phone})
    return result
