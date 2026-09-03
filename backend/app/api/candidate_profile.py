"""Candidate profile CRUD + resume upload linked to profile."""
import json
from datetime import datetime

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Form
from pydantic import BaseModel
from typing import Optional, List
from sqlmodel import Session, select

from ..db import engine, CandidateUser, CandidateProfile, Application, Resume, utc_now
from ..auth import get_current_candidate
from ..resume_utils import save_and_index_resume
from ..utils.email_utils import send_welcome_email
import tempfile
import os
import shutil
from ..services.report_parsers.router import route_file
from ..services.scorer import evaluate_profile_project

router = APIRouter(prefix="/api/candidate/profile", tags=["candidate-profile"])


class ProfileUpdate(BaseModel):
    headline: Optional[str] = None
    bio: Optional[str] = None
    branch: Optional[str] = None
    skills: Optional[List[str]] = None
    experience: Optional[List[dict]] = None
    education: Optional[List[dict]] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    gender: Optional[str] = None  # EEO self-ID, candidate-controlled


def _get_candidate_user(session: Session, username: str) -> CandidateUser:
    user = session.exec(select(CandidateUser).where(CandidateUser.username == username)).first()
    if not user:
        raise HTTPException(status_code=404, detail="Candidate user not found")
    return user


def _get_or_create_profile(session: Session, candidate_id: int) -> CandidateProfile:
    profile = session.exec(
        select(CandidateProfile).where(CandidateProfile.candidate_id == candidate_id)
    ).first()
    if not profile:
        profile = CandidateProfile(candidate_id=candidate_id)
        session.add(profile)
        session.commit()
        session.refresh(profile)
    return profile


def _profile_to_dict(profile: CandidateProfile, resume: Resume = None) -> dict:
    return {
        "headline": profile.headline,
        "bio": profile.bio,
        "branch": profile.branch,
        "skills": json.loads(profile.skills_json),
        "experience": json.loads(profile.experience_json),
        "education": json.loads(profile.education_json),
        "contact_email": profile.contact_email,
        "contact_phone": profile.contact_phone,
        "latitude": profile.latitude,
        "longitude": profile.longitude,
        "gender": profile.gender,
        "resume": {
            "id": resume.id,
            "resume_id": resume.vector_doc_id,
            "filename": resume.filename,
            "uploaded_at": resume.uploaded_at.isoformat(),
        } if resume else None,
        "updated_at": profile.updated_at.isoformat(),
    }


@router.get("")
async def get_profile(candidate: str = Depends(get_current_candidate)):
    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)
        resume = session.get(Resume, profile.resume_id) if profile.resume_id else None
        return _profile_to_dict(profile, resume)


@router.post("/resume")
async def upload_profile_resume(file: UploadFile = File(...), candidate: str = Depends(get_current_candidate)):
    """
    Upload/replace the resume on the candidate's profile. The frontend has
    called this endpoint since the Profile page was built, but it never
    actually existed - reuses the same extraction/dedup/vector-indexing
    pipeline as every other resume upload path in this app.
    """
    _, _, _, resume_db_id = save_and_index_resume(file)

    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)
        profile.resume_id = resume_db_id
        profile.updated_at = utc_now()
        session.add(profile)
        session.commit()

        resume = session.get(Resume, resume_db_id)
        return _profile_to_dict(profile, resume)

@router.post("/project")
async def upload_profile_project(
    description: str = Form(...),
    file: Optional[UploadFile] = File(None),
    candidate: str = Depends(get_current_candidate)
):
    project_texts = []
    
    if file:
        ext = os.path.splitext(file.filename)[1].lower()
        fd, temp_path = tempfile.mkstemp(suffix=ext)
        try:
            with os.fdopen(fd, 'wb') as f:
                shutil.copyfileobj(file.file, f)
            text, _ = route_file(temp_path)
            if text:
                project_texts.append(text)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
                
    result = evaluate_profile_project(description, project_texts)
    
    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)
        profile.project_description = description
        profile.project_summary = result.get("project_summary", "Evaluation failed.")
        profile.project_general_score = result.get("project_general_score", 0)
        profile.updated_at = utc_now()
        session.add(profile)
        session.commit()
        
        resume = session.get(Resume, profile.resume_id) if profile.resume_id else None
        return _profile_to_dict(profile, resume)


@router.put("")
async def update_profile(update: ProfileUpdate, candidate: str = Depends(get_current_candidate)):
    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)

        if update.headline is not None:
            profile.headline = update.headline
        if update.bio is not None:
            profile.bio = update.bio
        if update.branch is not None:
            profile.branch = update.branch
        if update.skills is not None:
            profile.skills_json = json.dumps(update.skills)
        if update.experience is not None:
            profile.experience_json = json.dumps(update.experience)
        if update.education is not None:
            profile.education_json = json.dumps(update.education)
        if update.contact_email is not None:
            profile.contact_email = update.contact_email
        if update.contact_phone is not None:
            profile.contact_phone = update.contact_phone
        if update.latitude is not None:
            profile.latitude = update.latitude
        if update.longitude is not None:
            profile.longitude = update.longitude
        if update.gender is not None:
            profile.gender = update.gender

        profile.updated_at = utc_now()
        session.add(profile)
        session.commit()
        session.refresh(profile)
        # Send welcome email if contact email is set
        if profile.contact_email:
            try:
                send_welcome_email(profile.contact_email, candidate)
            except Exception as e:
                import logging
                logging.error(f"Failed to send welcome email: {e}")

        resume = session.get(Resume, profile.resume_id) if profile.resume_id else None
        return _profile_to_dict(profile, resume)


@router.post("/project-upload")
async def upload_candidate_project(
    file: UploadFile = File(...),
    description: str = Form(""),
    candidate: str = Depends(get_current_candidate),
):
    """
    Candidate project upload endpoint.
    Accepts multipart: file (PDF, DOCX, ZIP, code, text) + description.
    Parses file, generates technical summary with Gemini, updates CandidateProfile,
    and ensures candidate_status is set to 'applied'.
    """
    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)

        # 1. Save uploaded file to temp
        suffix = os.path.splitext(file.filename or "")[1] or ".bin"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name

        try:
            # 2. Parse file using project_parsers
            from ..services.project_parsers import parse_project_file
            content = parse_project_file(tmp_path)

            # 3. Generate summary using GeminiClient
            from ..services.gemini_client import GeminiClient
            gemini_key = os.environ.get("GEMINI_API_KEY", "")
            g_client = GeminiClient(gemini_key)
            summary = g_client.generate_project_summary(content, description)

            # 4. Store on candidate profile
            profile.project_description = description
            profile.project_summary = summary
            profile.candidate_status = "applied"
            profile.updated_at = utc_now()
            session.add(profile)

            # 5. Set candidate_status = applied on active applications
            apps = session.exec(select(Application).where(Application.candidate_id == user.id)).all()
            for app in apps:
                if not app.candidate_status or app.candidate_status == "applied":
                    app.candidate_status = "applied"
                if not app.project_summary:
                    app.project_summary = summary
                session.add(app)

            session.commit()
            session.refresh(profile)

            # 6. Audit event
            from ..services.audit import record_audit_event
            record_audit_event(
                session=session,
                event_type="candidate_project_upload",
                candidate_id=user.id,
                final_recommendation=f"Candidate uploaded project portfolio file {file.filename}: {description[:100]}",
            )

            return {
                "message": "Project uploaded successfully",
                "filename": file.filename,
                "project_summary": summary,
                "candidate_status": "applied",
            }
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass


@router.get("/status")
async def get_candidate_status(
    candidate: str = Depends(get_current_candidate),
):
    """
    Candidate simplified status endpoint.
    Returns ONLY the simplified enum (applied, shortlisted, not_selected, interview, final_result).
    Never returns numbers, scores, logs, analysis text, or 'ATS' / 'verification' terminology.
    """
    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        app = session.exec(
            select(Application)
            .where(Application.candidate_id == user.id)
            .order_by(Application.applied_at.desc())
        ).first()

        status = "applied"
        if app and app.candidate_status:
            status = app.candidate_status
        else:
            profile = session.exec(
                select(CandidateProfile).where(CandidateProfile.candidate_id == user.id)
            ).first()
            if profile and profile.candidate_status:
                status = profile.candidate_status

        allowed = {"applied", "shortlisted", "not_selected", "interview", "final_result"}
        if status not in allowed:
            status = "applied"

        return {"status": status}

