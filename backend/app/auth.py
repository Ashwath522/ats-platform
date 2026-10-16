import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlmodel import Session, select

from .db import User, engine

SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-only-insecure-secret-change-me")
if (
    os.environ.get("DEBUG", "0") != "1"
    and os.environ.get("ENV", "development").lower() not in {"development", "local", "test"}
    and SECRET_KEY in {"dev-only-insecure-secret-change-me", "change-me-to-a-long-random-string"}
):
    raise RuntimeError("JWT_SECRET_KEY must be set to a strong non-placeholder value outside local development")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

bearer_scheme = HTTPBearer(auto_error=False)


def _bcrypt_safe(password: str) -> str:
    return password.encode("utf-8")[:72].decode("utf-8", errors="ignore")


# bcrypt work factor for new hashes. 12 (the library default) costs ~0.25 s on
# a fast core and well over 1 s on Render's shared free CPU - on every login.
# 10 is the OWASP minimum and keeps login snappy; existing hashes are
# transparently re-hashed at this cost on the next successful login.
BCRYPT_ROUNDS = max(4, min(15, int(os.environ.get("BCRYPT_ROUNDS", "10"))))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_bcrypt_safe(password).encode("utf-8"), bcrypt.gensalt(BCRYPT_ROUNDS)).decode("utf-8")


def password_needs_rehash(password_hash: Optional[str]) -> bool:
    try:
        return int((password_hash or "").split("$")[2]) != BCRYPT_ROUNDS
    except (IndexError, ValueError):
        return False


def record_login(model, row_id: int, plain_password: Optional[str] = None, current_hash: Optional[str] = None) -> None:
    """Stamp last_login_at (and upgrade the password hash cost if needed) in a
    single UPDATE. Called as a BackgroundTask so login responds after one query."""
    from sqlalchemy import update as _update
    from .db import utc_now

    values = {"last_login_at": utc_now()}
    if plain_password and password_needs_rehash(current_hash):
        values["password_hash"] = hash_password(plain_password)
    try:
        with Session(engine) as session:
            session.exec(_update(model).where(model.id == row_id).values(**values))
            session.commit()
    except Exception:  # never fail a login over bookkeeping
        import logging
        logging.getLogger("ats-platform").exception("[AUTH] could not record login")


def verify_password(plain_password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(_bcrypt_safe(plain_password).encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(username: str, role: str = "recruiter", expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    payload = {"sub": username, "role": role, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> str:
    payload = decode_token_payload(token)
    return payload["sub"], payload["role"]


def decode_token_payload(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise credentials_exception
        return {"sub": username, "role": payload.get("role", "recruiter")}
    except JWTError:
        raise credentials_exception


# ── Principal cache ──────────────────────────────────────────────────────────
# Every authenticated request used to open its own DB session just to check
# the account's role/status (ping + BEGIN + SELECT + ROLLBACK = 3-4 round
# trips, ~2 s from India to the production DB). The answer is cached in
# process for a short TTL and dropped as soon as *any* write touches a user
# table (suspension, role change, deletion - see services/cache.py), so
# locking an account out still takes effect immediately.
from types import SimpleNamespace as _NS

from .services import cache as _cache

_cache.install(engine)
PRINCIPAL_TTL_SECONDS = float(os.environ.get("AUTH_CACHE_TTL_SECONDS", "30"))
_principals = _cache.TTLCache("principals", ttl=PRINCIPAL_TTL_SECONDS,
                              tables={"user", "candidateuser", "recruiteruser"}, max_entries=5000)


def invalidate_principals() -> None:
    _principals.invalidate()


def _principal(kind: str, key: str):
    """'user' -> NS(id, email, role, status, name); 'candidate' / 'recruiter' -> NS(id, username, status)."""
    hit = _principals.get((kind, key))
    if hit is not None:
        return hit
    from .db import CandidateUser, RecruiterUser

    gen = _principals._gen
    with Session(engine) as session:
        if kind == "user":
            row = session.exec(select(User.id, User.email, User.role, User.status, User.name).where(User.email == key)).first()
            value = _NS(id=row[0], email=row[1], role=row[2], status=row[3], name=row[4]) if row else None
        elif kind == "recruiter":
            row = session.exec(select(RecruiterUser.id, RecruiterUser.username).where(RecruiterUser.username == key)).first()
            value = _NS(id=row[0], username=row[1], status=None) if row else None
        else:
            row = session.exec(select(CandidateUser.id, CandidateUser.username, CandidateUser.status).where(CandidateUser.username == key)).first()
            value = _NS(id=row[0], username=row[1], status=row[2]) if row else None
    if value is not None:
        _principals.set((kind, key), value, gen)
    return value


def cached_candidate(username: str):
    """NS(id, username, status) for a token subject, or 404. Ids never change."""
    found = _principal("candidate", username)
    if not found:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return found


def cached_recruiter(username: str):
    """NS(id, username) of the legacy RecruiterUser row that owns jobs, or 404."""
    found = _principal("recruiter", username)
    if not found:
        raise HTTPException(status_code=404, detail="Recruiter user not found")
    return found


credentials_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or expired token",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> User:
    if credentials is None:
        raise credentials_exception
    payload = decode_token_payload(credentials.credentials)
    user = _principal("user", payload["sub"])
    if not user or user.role != payload["role"]:
        raise credentials_exception
    if (user.status or "active") == "suspended":
        raise HTTPException(status_code=403, detail="This account is suspended")
    return user


def require_role(*roles: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return user

    return dependency


def get_current_recruiter(user: User = Depends(require_role("recruiter"))) -> str:
    return user.email


def get_current_candidate(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> str:
    if credentials is None:
        raise credentials_exception
    payload = decode_token_payload(credentials.credentials)
    if payload.get("role") != "candidate":
        raise HTTPException(status_code=403, detail="Insufficient role")
    _reject_suspended_candidate(payload["sub"])
    return payload["sub"]


def _reject_suspended_candidate(username: str) -> None:
    """Suspended students are locked out immediately (not only at next login).
    Single-column lookup on the unique, indexed CandidateUser.username."""
    found = _principal("candidate", username)
    status_value = found.status if found else None
    if status_value == "suspended":
        raise HTTPException(status_code=403, detail="This account is suspended")

def get_current_admin(user: User = Depends(require_role("admin"))) -> str:
    return user.email
