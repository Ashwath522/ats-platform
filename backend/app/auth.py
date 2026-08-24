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


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_bcrypt_safe(password).encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(_bcrypt_safe(plain_password).encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(username: str, role: str = "recruiter", expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    payload = {"sub": username, "role": role, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> str:
    return decode_token_payload(token)["sub"]


def decode_token_payload(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise credentials_exception
        return {"sub": username, "role": payload.get("role", "recruiter")}
    except JWTError:
        raise credentials_exception


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
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == payload["sub"])).first()
        if not user or user.role != payload["role"]:
            raise credentials_exception
        return user


def require_role(*roles: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return user

    return dependency


def get_current_recruiter(user: User = Depends(require_role("recruiter"))) -> str:
    return user.email


def get_current_candidate(user: User = Depends(require_role("candidate"))) -> User:
    return user


def get_current_admin(user: User = Depends(require_role("admin"))) -> User:
    return user
