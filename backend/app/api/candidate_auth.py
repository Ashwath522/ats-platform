from fastapi import APIRouter, Form, HTTPException, Request
from sqlmodel import Session, select
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..db import engine, CandidateUser
from ..auth import hash_password, verify_password, create_access_token

import os
import sys

limiter = Limiter(key_func=get_remote_address, enabled=not ("pytest" in sys.modules or os.getenv("TESTING") == "1"))
router = APIRouter(prefix="/api/candidate/auth", tags=["candidate-auth"])


@router.post("/register")
@limiter.limit("20/minute")
async def register(request: Request, username: str = Form(...), password: str = Form(...)):
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    with Session(engine) as session:
        existing = session.exec(select(CandidateUser).where(CandidateUser.username == username)).first()
        if existing:
            raise HTTPException(status_code=409, detail="Username already taken")
        user = CandidateUser(username=username, password_hash=hash_password(password))
        session.add(user)
        session.commit()
        session.refresh(user)
    token = create_access_token(username, role="candidate")
    return {"access_token": token, "token_type": "bearer", "username": username}


@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, username: str = Form(...), password: str = Form(...)):
    with Session(engine) as session:
        user = session.exec(select(CandidateUser).where(CandidateUser.username == username)).first()
        if not user or not verify_password(password, user.password_hash):
            raise HTTPException(status_code=401, detail="Incorrect username or password")
    token = create_access_token(username, role="candidate")
    return {"access_token": token, "token_type": "bearer", "username": username}
