from typing import Optional
from fastapi import APIRouter, Depends, Form, HTTPException
from sqlmodel import Session, select
from sqlalchemy import func

from ..auth import get_current_admin
from ..db import engine, Suggestion, CandidateUser, RecruiterUser, User

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
    admin: User = Depends(get_current_admin),
):
    """Admin-gated endpoint to see stats and all user suggestions."""
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

@router.get("/api/admin/ai-key-status")
async def admin_ai_key_status(
    admin: User = Depends(get_current_admin),
):
    """Admin-gated endpoint to check AI key health."""
    import os
    from ..services.groq_client import GroqClient
    from ..services.gemini_client import GeminiClient

    groq_key = os.environ.get("GROQ_API_KEY", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "")

    groq_status = {"success": False, "error": "Not configured"}
    if groq_key:
        try:
            groq_client = GroqClient(groq_key)
            groq_status = groq_client.test_connection()
            if isinstance(groq_status, bool):
                groq_status = {"success": groq_status}
        except Exception as e:
            groq_status = {"success": False, "error": str(e)}

    gemini_status = {"success": False, "error": "Not configured"}
    if gemini_key:
        try:
            gemini_client = GeminiClient(gemini_key)
            gemini_status = gemini_client.test_connection()
            if isinstance(gemini_status, bool):
                gemini_status = {"success": gemini_status}
        except Exception as e:
            gemini_status = {"success": False, "error": str(e)}

    return {
        "groq": groq_status,
        "gemini": gemini_status,
    }


@router.post("/api/admin/retention/purge")
async def admin_retention_purge(
    days: int = 30,
    admin: User = Depends(get_current_admin),
):
    """Admin-gated endpoint to trigger proctoring data retention purge."""
    from ..services.retention import purge_expired_proctoring_data
    with Session(engine) as session:
        result = purge_expired_proctoring_data(session, retention_days=days)
        return {"success": True, **result}


