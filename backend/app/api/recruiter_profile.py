"""Recruiter profile CRUD + avatar and cover photo management."""
from typing import Optional
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import engine, RecruiterUser, RecruiterProfile, utc_now
from ..auth import get_current_recruiter
from ..services.media_utils import validate_and_save_image, delete_media_file

router = APIRouter(prefix="/api/recruiter/profile", tags=["recruiter-profile"])


class RecruiterProfileUpdate(BaseModel):
    headline: Optional[str] = None
    bio: Optional[str] = None
    company_name: Optional[str] = None


def _get_recruiter_user(session: Session, username: str) -> RecruiterUser:
    user = session.exec(select(RecruiterUser).where(RecruiterUser.username == username)).first()
    if not user:
        raise HTTPException(status_code=404, detail="Recruiter user not found")
    return user


def _get_or_create_profile(session: Session, recruiter_id: int) -> RecruiterProfile:
    profile = session.exec(
        select(RecruiterProfile).where(RecruiterProfile.recruiter_id == recruiter_id)
    ).first()
    if not profile:
        profile = RecruiterProfile(recruiter_id=recruiter_id)
        session.add(profile)
        session.commit()
        session.refresh(profile)
    return profile


def _recruiter_profile_to_dict(user: RecruiterUser, profile: RecruiterProfile) -> dict:
    return {
        "username": user.username,
        "headline": profile.headline or "",
        "bio": profile.bio or "",
        "company_name": profile.company_name or "",
        "avatar_url": f"/media/{profile.avatar_path}" if profile.avatar_path else None,
        "cover_photo_url": f"/media/{profile.cover_photo_path}" if profile.cover_photo_path else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }


@router.get("")
async def get_recruiter_profile(recruiter: str = Depends(get_current_recruiter)):
    """Fetch current recruiter's profile, headline, bio, and avatar/cover urls."""
    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        profile = _get_or_create_profile(session, user.id)
        return _recruiter_profile_to_dict(user, profile)


@router.put("")
async def update_recruiter_profile(
    update: RecruiterProfileUpdate,
    recruiter: str = Depends(get_current_recruiter),
):
    """Update recruiter headline, bio, or company name."""
    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        profile = _get_or_create_profile(session, user.id)

        if update.headline is not None:
            profile.headline = update.headline.strip()
        if update.bio is not None:
            profile.bio = update.bio.strip()
        if update.company_name is not None:
            profile.company_name = update.company_name.strip()

        profile.updated_at = utc_now()
        session.add(profile)
        session.commit()
        session.refresh(profile)
        return _recruiter_profile_to_dict(user, profile)


@router.post("/avatar")
async def upload_recruiter_avatar(
    file: UploadFile = File(...),
    recruiter: str = Depends(get_current_recruiter),
):
    """Upload or replace recruiter profile avatar photo."""
    rel_path = validate_and_save_image(file, "avatars")

    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        profile = _get_or_create_profile(session, user.id)

        if profile.avatar_path and profile.avatar_path != rel_path:
            delete_media_file(profile.avatar_path)

        profile.avatar_path = rel_path
        profile.updated_at = utc_now()
        session.add(profile)
        session.commit()
        session.refresh(profile)
        return _recruiter_profile_to_dict(user, profile)


@router.post("/cover-photo")
async def upload_recruiter_cover_photo(
    file: UploadFile = File(...),
    recruiter: str = Depends(get_current_recruiter),
):
    """Upload or replace recruiter profile cover banner photo."""
    rel_path = validate_and_save_image(file, "covers")

    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        profile = _get_or_create_profile(session, user.id)

        if profile.cover_photo_path and profile.cover_photo_path != rel_path:
            delete_media_file(profile.cover_photo_path)

        profile.cover_photo_path = rel_path
        profile.updated_at = utc_now()
        session.add(profile)
        session.commit()
        session.refresh(profile)
        return _recruiter_profile_to_dict(user, profile)
