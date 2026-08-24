"""
Authentication: username/password login issuing a role-aware JWT.

Supports two account types: 'candidate' and 'recruiter'. JWTs carry a 'role'
claim so endpoint dependencies can enforce role separation — a candidate token
cannot access recruiter-only endpoints and vice versa.

Deliberately minimal — this protects endpoints from being open to the public
internet. It is NOT a full identity system: no email verification, no password
reset flow, no refresh tokens. Add those before a real multi-tenant deployment.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import bcrypt
from jose import JWTError, jwt

# In production, set JWT_SECRET_KEY via environment variable. This fallback
# is fine for local dev only — every restart with no env var set invalidates
# existing tokens, which is intentional (better than a hardcoded prod secret).
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-only-insecure-secret-change-me")
if (
    os.environ.get("DEBUG", "0") != "1"
    and os.environ.get("ENV", "development").lower() not in {"development", "local", "test"}
    and SECRET_KEY in {"dev-only-insecure-secret-change-me", "change-me-to-a-long-random-string"}
):
    raise RuntimeError("JWT_SECRET_KEY must be set to a strong non-placeholder value outside local development")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24h

bearer_scheme = HTTPBearer(auto_error=False)


# bcrypt has a hard 72-byte limit on the input. Older bcrypt versions silently
# truncated; bcrypt>=4.1 raises ValueError instead. Truncate explicitly here so
# hashing/verifying never crashes regardless of which bcrypt version is installed.
def _bcrypt_safe(password: str) -> str:
    return password.encode("utf-8")[:72].decode("utf-8", errors="ignore")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_bcrypt_safe(password).encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(_bcrypt_safe(plain_password).encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(
    username: str,
    role: str = "recruiter",
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Create a JWT with username and role in the payload."""
    # Timezone-aware, not naive: jwt.encode converts this to a Unix timestamp
    # via .timestamp(), which for a naive datetime assumes the server's LOCAL
    # timezone rather than UTC - a real bug if this ever runs on a non-UTC
    # host. Aware datetimes convert unambiguously regardless of server tz.
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    payload = {"sub": username, "role": role, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Tuple[str, str]:
    """Returns (username, role) from a valid token, or raises HTTPException."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        # Default to "recruiter" for backwards compatibility with pre-role tokens
        role = payload.get("role", "recruiter")
        if not username:
            raise credentials_exception
        return username, role
    except JWTError:
        raise credentials_exception


credentials_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or expired token",
    headers={"WWW-Authenticate": "Bearer"},
)


def _get_current_user_with_role(
    required_role: str,
    credentials: Optional[HTTPAuthorizationCredentials],
) -> str:
    """Shared logic: validate token AND check role. Returns the username."""
    if credentials is None:
        raise credentials_exception
    username, role = decode_access_token(credentials.credentials)
    if role != required_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This endpoint requires a {required_role} account",
        )
    return username


def get_current_recruiter(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> str:
    """FastAPI dependency — protects an endpoint, returns the recruiter's username.
    Rejects candidate tokens with 403."""
    return _get_current_user_with_role("recruiter", credentials)


def get_current_candidate(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> str:
    """FastAPI dependency — protects an endpoint, returns the candidate's username.
    Rejects recruiter tokens with 403."""
    return _get_current_user_with_role("candidate", credentials)
