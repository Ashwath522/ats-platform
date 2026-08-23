"""Candidate job browsing, applying, and application history."""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlmodel import Session, select

from ..db import engine, Job, Application, CandidateUser, CandidateProfile, Resume
from ..auth import get_current_candidate
from ..services.distance import distance_or_none
from ..services.embeddings import EmbeddingModel
from ..services.scoring import score_resume_against_jd
from ..resume_utils import vector_store
from ..services.vocab_learning import learn_skills_from_resume

router = APIRouter(prefix="/api/candidate/jobs", tags=["candidate-jobs"])


@router.get("")
async def browse_jobs(
    title: Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    salary_min: Optional[float] = Query(None),
    salary_max: Optional[float] = Query(None),
    remote_type: Optional[str] = Query(None),
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius_km: Optional[float] = Query(None),
    sort_by: str = Query("recent"),  # "recent" | "salary" | "distance"
    candidate: str = Depends(get_current_candidate),
):
    """Browse open job postings with optional filters."""
    with Session(engine) as session:
        query = select(Job).where(Job.status == "open")

        jobs = session.exec(query.order_by(Job.created_at.desc())).all()

        results = []
        for job in jobs:
            # Title filter (case-insensitive substring)
            if title and title.lower() not in job.title.lower():
                continue

            # Location filter (case-insensitive substring)
            if location and location.lower() not in job.location_text.lower():
                continue

            # Salary filter
            if salary_min is not None and job.salary_max is not None and job.salary_max < salary_min:
                continue
            if salary_max is not None and job.salary_min is not None and job.salary_min > salary_max:
                continue

            # Remote type filter
            if remote_type and job.remote_type != remote_type:
                continue

            # Distance filter
            dist = distance_or_none(lat, lng, job.latitude, job.longitude)
            if radius_km is not None and lat is not None and lng is not None:
                if dist is None or dist > radius_km:
                    continue

            results.append({
                "id": job.id,
                "title": job.title,
                "description": job.description[:300] + ("..." if len(job.description) > 300 else ""),
                "salary_min": job.salary_min,
                "salary_max": job.salary_max,
                "currency": job.currency,
                "location_text": job.location_text,
                "remote_type": job.remote_type,
                "requirements": job.requirements,
                "distance_km": round(dist, 1) if dist is not None else None,
                "created_at": job.created_at.isoformat(),
            })

        # Sort
        if sort_by == "distance" and lat is not None and lng is not None:
            results.sort(key=lambda r: r["distance_km"] if r["distance_km"] is not None else float("inf"))
        elif sort_by == "salary":
            results.sort(key=lambda r: r["salary_max"] or 0, reverse=True)
        # default: already sorted by created_at desc

        return {"jobs": results, "count": len(results)}


@router.get("/{job_id}")
async def get_job_detail(job_id: int, candidate: str = Depends(get_current_candidate)):
    """Full job details for a single posting."""
    with Session(engine) as session:
        job = session.get(Job, job_id)
        if not job or job.status != "open":
            raise HTTPException(status_code=404, detail="Job not found or closed")
        return {
            "id": job.id,
            "title": job.title,
            "description": job.description,
            "salary_min": job.salary_min,
            "salary_max": job.salary_max,
            "currency": job.currency,
            "location_text": job.location_text,
            "latitude": job.latitude,
            "longitude": job.longitude,
            "requirements": job.requirements,
            "remote_type": job.remote_type,
            "created_at": job.created_at.isoformat(),
        }


@router.post("/{job_id}/apply")
async def apply_to_job(
    job_id: int,
    candidate: str = Depends(get_current_candidate),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """Apply to a job. Auto-scores the candidate's stored resume against the job description.
    No re-upload needed — uses the resume already linked to the candidate's profile."""
    with Session(engine) as session:
        # Get candidate user
        user = session.exec(select(CandidateUser).where(CandidateUser.username == candidate)).first()
        if not user:
            raise HTTPException(status_code=404, detail="Candidate not found")

        # Check job exists and is open
        job = session.get(Job, job_id)
        if not job or job.status != "open":
            raise HTTPException(status_code=404, detail="Job not found or closed")

        # Check not already applied
        existing = session.exec(
            select(Application)
            .where(Application.candidate_id == user.id, Application.job_id == job_id)
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="You have already applied to this job")

        # Get candidate's profile + resume
        profile = session.exec(
            select(CandidateProfile).where(CandidateProfile.candidate_id == user.id)
        ).first()
        if not profile or not profile.resume_id:
            raise HTTPException(
                status_code=400,
                detail="Upload a resume to your profile before applying",
            )

        resume = session.get(Resume, profile.resume_id)
        if not resume:
            raise HTTPException(status_code=400, detail="Resume not found — please re-upload")

        # Get resume text from vector store
        resume_doc = vector_store.get_document("resumes", resume.vector_doc_id)
        if not resume_doc:
            raise HTTPException(status_code=500, detail="Resume data not found in vector store")

        resume_text = resume_doc["document"]

        # Score resume against job description
        resume_embedding = EmbeddingModel.get().embed_text(resume_text)
        jd_embedding = EmbeddingModel.get().embed_text(f"{job.title}\n\n{job.description}")

        branch_to_match = job.branch or profile.branch
        score_result = score_resume_against_jd(
            resume_text, job.description, resume_embedding, jd_embedding, branch=branch_to_match
        )

        # Create application with score
        application = Application(
            candidate_id=user.id,
            job_id=job_id,
            resume_id=profile.resume_id,
            ats_score=score_result["ats_score"],
            matched_skills_json=json.dumps(score_result["matched_skills"]),
            missing_skills_json=json.dumps(score_result["missing_skills"]),
        )
        session.add(application)
        session.commit()
        session.refresh(application)

        background_tasks.add_task(learn_skills_from_resume, resume_text, branch_to_match)

        return {
            "message": "Application submitted successfully",
            "application_id": application.id,
            "job_title": job.title,
            "ats_score": score_result["ats_score"],
            "matched_skills": score_result["matched_skills"],
            "missing_skills": score_result["missing_skills"],
        }


@router.get("/applications/mine")
async def my_applications(candidate: str = Depends(get_current_candidate)):
    """List all applications by this candidate with scores."""
    with Session(engine) as session:
        user = session.exec(select(CandidateUser).where(CandidateUser.username == candidate)).first()
        if not user:
            raise HTTPException(status_code=404, detail="Candidate not found")

        apps = session.exec(
            select(Application)
            .where(Application.candidate_id == user.id)
            .order_by(Application.applied_at.desc())
        ).all()

        results = []
        for app in apps:
            job = session.get(Job, app.job_id)
            results.append({
                "application_id": app.id,
                "job_id": app.job_id,
                "job_title": job.title if job else "Unknown",
                "job_location": job.location_text if job else "",
                "ats_score": app.ats_score,
                "matched_skills": json.loads(app.matched_skills_json),
                "missing_skills": json.loads(app.missing_skills_json),
                "status": app.status,
                "applied_at": app.applied_at.isoformat(),
            })

        return {"applications": results, "count": len(results)}
