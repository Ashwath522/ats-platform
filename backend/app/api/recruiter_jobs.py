"""Recruiter job posting CRUD + applicant ranking."""
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Query
from sqlmodel import Session, select

from ..db import engine, Job, Application, RecruiterUser, Resume, CandidateProfile, utc_now
from ..auth import get_current_recruiter
from ..services.geocoding import geocode
from ..services.embeddings import EmbeddingModel
from ..services.scoring import score_resume_against_jd
from ..resume_utils import vector_store

router = APIRouter(prefix="/api/recruiter/jobs", tags=["recruiter-jobs"])


def _get_recruiter_user(session: Session, username: str) -> RecruiterUser:
    user = session.exec(select(RecruiterUser).where(RecruiterUser.username == username)).first()
    if not user:
        raise HTTPException(status_code=404, detail="Recruiter user not found")
    return user


def _get_owned_job_or_403(session: Session, job_id: int, recruiter_id: int) -> Job:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.recruiter_id != recruiter_id:
        raise HTTPException(status_code=403, detail="You don't have permission to modify this job")
    return job


def _job_to_dict(job: Job) -> dict:
    return {
        "id": job.id,
        "title": job.title,
        "description": job.description,
        "branch": job.branch,
        "salary_min": job.salary_min,
        "salary_max": job.salary_max,
        "currency": job.currency,
        "location_text": job.location_text,
        "latitude": job.latitude,
        "longitude": job.longitude,
        "requirements": job.requirements,
        "remote_type": job.remote_type,
        "status": job.status,
        "company_id": job.company_id,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
    }


@router.post("")
async def create_job(
    title: str = Form(...),
    description: str = Form(...),
    branch: Optional[str] = Form(None),
    salary_min: Optional[float] = Form(None),
    salary_max: Optional[float] = Form(None),
    currency: str = Form("INR"),
    location_text: str = Form(""),
    requirements: str = Form(""),
    remote_type: str = Form("onsite"),
    company_id: Optional[int] = Form(None),
    recruiter: str = Depends(get_current_recruiter),
):
    if remote_type not in ("remote", "onsite", "hybrid"):
        raise HTTPException(status_code=400, detail="remote_type must be 'remote', 'onsite', or 'hybrid'")

    # Geocode location
    lat, lng = None, None
    if location_text.strip():
        coords = geocode(location_text)
        if coords:
            lat, lng = coords

    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        job = Job(
            recruiter_id=user.id,
            company_id=company_id,
            title=title,
            description=description,
            branch=branch,
            salary_min=salary_min,
            salary_max=salary_max,
            currency=currency,
            location_text=location_text,
            latitude=lat,
            longitude=lng,
            requirements=requirements,
            remote_type=remote_type,
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        return _job_to_dict(job)


@router.get("")
async def list_my_jobs(recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        jobs = session.exec(
            select(Job).where(Job.recruiter_id == user.id).order_by(Job.created_at.desc())
        ).all()
        return [_job_to_dict(j) for j in jobs]


@router.put("/{job_id}")
async def update_job(
    job_id: int,
    title: str = Form(None),
    description: str = Form(None),
    branch: Optional[str] = Form(None),
    salary_min: Optional[float] = Form(None),
    salary_max: Optional[float] = Form(None),
    currency: str = Form(None),
    location_text: str = Form(None),
    requirements: str = Form(None),
    remote_type: str = Form(None),
    status: str = Form(None),
    recruiter: str = Depends(get_current_recruiter),
):
    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        job = _get_owned_job_or_403(session, job_id, user.id)

        if title is not None:
            job.title = title
        if description is not None:
            job.description = description
        if branch is not None:
            job.branch = branch
        if salary_min is not None:
            job.salary_min = salary_min
        if salary_max is not None:
            job.salary_max = salary_max
        if currency is not None:
            job.currency = currency
        if location_text is not None:
            job.location_text = location_text
            coords = geocode(location_text)
            if coords:
                job.latitude, job.longitude = coords
        if requirements is not None:
            job.requirements = requirements
        if remote_type is not None:
            if remote_type not in ("remote", "onsite", "hybrid"):
                raise HTTPException(status_code=400, detail="remote_type must be 'remote', 'onsite', or 'hybrid'")
            job.remote_type = remote_type
        if status is not None:
            if status not in ("open", "closed"):
                raise HTTPException(status_code=400, detail="status must be 'open' or 'closed'")
            job.status = status

        job.updated_at = utc_now()
        session.add(job)
        session.commit()
        session.refresh(job)
        return _job_to_dict(job)


@router.delete("/{job_id}")
async def delete_job(job_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        job = _get_owned_job_or_403(session, job_id, user.id)
        # Delete associated applications
        apps = session.exec(select(Application).where(Application.job_id == job_id)).all()
        for app in apps:
            session.delete(app)
        session.delete(job)
        session.commit()
        return {"deleted": True, "job_id": job_id}


@router.get("/{job_id}/applicants")
async def list_applicants(
    job_id: int,
    recruiter: str = Depends(get_current_recruiter),
):
    """Ranked applicants for a job, ordered by ATS score descending.
    Reuses the same scoring pipeline as the existing matching-resumes endpoint."""
    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        job = _get_owned_job_or_403(session, job_id, user.id)

        apps = session.exec(
            select(Application)
            .where(Application.job_id == job_id)
            .order_by(Application.ats_score.desc())
        ).all()

        results = []
        for app in apps:
            # Get candidate profile info (without EEO fields — never exposed to recruiters)
            profile = session.exec(
                select(CandidateProfile).where(CandidateProfile.candidate_id == app.candidate_id)
            ).first()

            resume = session.get(Resume, app.resume_id) if app.resume_id else None

            results.append({
                "application_id": app.id,
                "candidate_name": profile.headline if profile else "Unknown",
                "resume_filename": resume.filename if resume else None,
                "ats_score": app.ats_score,
                "matched_skills": json.loads(app.matched_skills_json),
                "missing_skills": json.loads(app.missing_skills_json),
                "status": app.status,
                "applied_at": app.applied_at.isoformat(),
            })

        return {
            "job_id": job_id,
            "job_title": job.title,
            "applicant_count": len(results),
            "applicants": results,
        }

@router.put("/{job_id}/applicants/{application_id}/status")
async def update_applicant_status(
    job_id: int,
    application_id: int,
    status: str = Form(...),
    recruiter: str = Depends(get_current_recruiter),
):
    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        job = _get_owned_job_or_403(session, job_id, user.id)

        app = session.get(Application, application_id)
        if not app or app.job_id != job_id:
            raise HTTPException(status_code=404, detail="Application not found for this job")

        valid_statuses = ("ats_check", "repo_verification", "automated_interview", "shortlisted", "rejected")
        if status not in valid_statuses:
            raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}")
        
        app.status = status
        session.add(app)
        session.commit()
        return {"status": "success", "new_status": app.status}
