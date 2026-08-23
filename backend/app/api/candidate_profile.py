"""Candidate profile CRUD + resume upload linked to profile."""
import json
from datetime import datetime

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from sqlmodel import Session, select

from ..db import engine, CandidateUser, CandidateProfile, Resume
from ..auth import get_current_candidate
from ..resume_utils import save_and_index_resume

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

        profile.updated_at = datetime.utcnow()
        session.add(profile)
        session.commit()
        session.refresh(profile)

        resume = session.get(Resume, profile.resume_id) if profile.resume_id else None
        return _profile_to_dict(profile, resume)


@router.post("/resume")
async def upload_resume(
    file: UploadFile = File(...),
    candidate: str = Depends(get_current_candidate),
):
    """Upload/replace the candidate's resume. Reuses existing extraction + dedup pipeline."""
    doc_id, text, embedding, resume_db_id = save_and_index_resume(file)

    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)
        profile.resume_id = resume_db_id
        profile.updated_at = datetime.utcnow()
        session.add(profile)
        session.commit()

        resume = session.get(Resume, resume_db_id)
        return {
            "message": "Resume uploaded successfully",
            "resume_id": doc_id,
            "filename": resume.filename if resume else file.filename,
        }
