import os
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Form, HTTPException, Query, Header
from sqlmodel import Session, select
from sqlalchemy import func

from ..db import engine, Suggestion, CandidateUser, RecruiterUser

router = APIRouter(tags=["admin"])


@router.post("/api/suggestions")
async def create_suggestion(
    text: str = Form(...),
    submitter: Optional[str] = Form(None),
):
    """Public unauthenticated endpoint to submit feedback/suggestions."""
    if not text.strip():
        raise HTTPException(status_code=400, detail="Suggestion text cannot be empty")

    with Session(engine) as session:
        sug = Suggestion(text=text.strip(), submitter=submitter)
        session.add(sug)
        session.commit()
        return {"success": True, "message": "Feedback submitted successfully"}


@router.get("/api/admin/suggestions")
async def admin_suggestions(
    password: Optional[str] = Query(None),
    x_admin_password: Optional[str] = Header(None, alias="X-Admin-Password"),
):
    """Admin-gated endpoint to see stats and all user suggestions."""
    expected = os.environ.get("ADMIN_PASSWORD", "admin123")
    provided = password or x_admin_password
    if provided != expected:
        raise HTTPException(status_code=401, detail="Unauthorized: invalid admin password")

    with Session(engine) as session:
        candidate_count = session.exec(select(func.count()).select_from(CandidateUser)).one()
        recruiter_count = session.exec(select(func.count()).select_from(RecruiterUser)).one()

        sugs = session.exec(select(Suggestion).order_by(Suggestion.submitted_at.desc())).all()

        return {
            "candidate_count": candidate_count,
            "recruiter_count": recruiter_count,
            "suggestions": [
                {
                    "id": s.id,
                    "text": s.text,
                    "submitted_at": s.submitted_at.isoformat(),
                    "submitter": s.submitter
                } for s in sugs
            ]
        }
