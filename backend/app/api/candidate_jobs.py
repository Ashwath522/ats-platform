"""Candidate job browsing, applying, and application history."""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlmodel import Session, select

from ..db import engine, Job, Application, CandidateUser, CandidateProfile, Resume, AnalysisCache
from ..auth import get_current_candidate
from ..services.distance import distance_or_none
from ..services.embeddings import EmbeddingModel
from ..services.scoring import score_resume_against_jd
from ..resume_utils import vector_store
from ..services.vocab_learning import learn_skills_from_resume
from ..services.deep_analysis import make_cache_key, run_resume_suggestions, run_hybrid_llm_scoring

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

        # Stage 1: Deterministic scoring
        branch_to_match = job.branch or profile.branch
        score_result = score_resume_against_jd(
            resume_text, job.description, resume_embedding, jd_embedding, branch=branch_to_match
        )
        
        baseline_ats = score_result["ats_score"]
        
        # Stage 2: LLM scoring
        llm_result = run_hybrid_llm_scoring(
            resume_text, job.description, score_result["missing_skills"], score_result["matched_skills"]
        )
        
        llm_used = llm_result.get("llm_configured", False)
        if llm_used and "llm_score" in llm_result:
            final_ats_score = round((0.70 * baseline_ats) + (0.30 * llm_result["llm_score"]))
            final_ats_score = max(0, min(100, final_ats_score))
        else:
            final_ats_score = baseline_ats

        # Compute suitability_verdict
        if final_ats_score >= 75:
            verdict = "Strong Fit"
            pending_human_review = False
        elif final_ats_score >= 50:
            verdict = "Potential Fit"
            pending_human_review = False
        else:
            verdict = "Not a Fit"
            pending_human_review = True

        # Create application with score
        application = Application(
            candidate_id=user.id,
            job_id=job_id,
            resume_id=profile.resume_id,
            baseline_ats_score=baseline_ats,
            final_score=final_ats_score,
            ats_score=final_ats_score,
            llm_used=llm_used,
            ai_recommendation=llm_result.get("reasoning", None),
            suitability_verdict=verdict,
            matched_skills_json=json.dumps(score_result["matched_skills"]),
            missing_skills_json=json.dumps(score_result["missing_skills"]),
            pending_human_review=pending_human_review,
        )
        session.add(application)
        session.commit()
        session.refresh(application)

        # Record immutable audit log
        from ..services.audit import record_audit_event
        record_audit_event(
            session=session,
            event_type="ats_score",
            application_id=application.id,
            candidate_id=user.id,
            job_id=job_id,
            ats_score=final_ats_score,
            baseline_ats_score=baseline_ats,
            semantic_similarity=score_result.get("semantic_similarity"),
            keyword_coverage=score_result.get("keyword_coverage"),
            matched_skills=score_result.get("matched_skills", []),
            missing_skills=score_result.get("missing_skills", []),
            final_score=final_ats_score,
            llm_providers_consulted=["gemini"] if llm_used else [],
            raw_verdicts=llm_result if llm_used else None,
            final_recommendation=verdict,
        )

        background_tasks.add_task(learn_skills_from_resume, resume_text, branch_to_match)

        return {
            "message": "Application submitted successfully",
            "application_id": application.id,
            "job_title": job.title,
            "ats_score": final_ats_score,
            "matched_skills": score_result["matched_skills"],
            "missing_skills": score_result["missing_skills"],
            "pending_human_review": pending_human_review,
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
                "baseline_ats_score": app.baseline_ats_score,
                "llm_used": app.llm_used,
                "matched_skills": json.loads(app.matched_skills_json),
                "missing_skills": json.loads(app.missing_skills_json),
                "status": app.status,
                "applied_at": app.applied_at.isoformat(),
                "project_score": app.project_score,
                "final_score": app.final_score,
                "priority_level": app.priority_level,
                "api_used": app.api_used,
                "parse_method": app.parse_method,
                "suitability_verdict": app.suitability_verdict,
                "ai_recommendation": app.ai_recommendation,
                "interview_status": app.interview_status,
                "repo_match_score": app.repo_match_score,
                "pending_human_review": app.pending_human_review,
                "human_reviewer": app.human_reviewer,
                "human_decision_notes": app.human_decision_notes,
            })

        return {"applications": results, "count": len(results)}


@router.get("/applications/{app_id}/explainability")
async def get_application_explainability(app_id: int, candidate: str = Depends(get_current_candidate)):
    """Candidate-facing explainability view: plain-language breakdown of scoring signals."""
    from ..services.audit import generate_score_explanation
    with Session(engine) as session:
        user = session.exec(select(CandidateUser).where(CandidateUser.username == candidate)).first()
        if not user:
            raise HTTPException(status_code=404, detail="Candidate not found")

        app = session.get(Application, app_id)
        if not app:
            raise HTTPException(status_code=404, detail="Application not found")
        if app.candidate_id != user.id:
            raise HTTPException(status_code=403, detail="Not authorized to view this application")

        job = session.get(Job, app.job_id)
        return generate_score_explanation(app, job)


@router.post("/{job_id}/suggestions")
async def get_job_suggestions(job_id: int, candidate: str = Depends(get_current_candidate)):
    """Get personalized AI resume suggestions for a specific job posting."""
    with Session(engine) as session:
        user = session.exec(select(CandidateUser).where(CandidateUser.username == candidate)).first()
        if not user:
            raise HTTPException(status_code=404, detail="Candidate not found")
        job = session.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        profile = session.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == user.id)).first()
        if not profile or not profile.resume_id:
            raise HTTPException(status_code=400, detail="No resume uploaded to profile")
        resume = session.get(Resume, profile.resume_id)
        if not resume:
            raise HTTPException(status_code=400, detail="Resume not found")

        resume_doc = vector_store.get_document("resumes", resume.vector_doc_id)
        if not resume_doc:
            raise HTTPException(status_code=500, detail="Resume text not found in store")

    cache_key = make_cache_key(str(resume.id), f"job_suggestions:{job_id}", job.description)
    with Session(engine) as session:
        cached = session.exec(select(AnalysisCache).where(AnalysisCache.cache_key == cache_key)).first()
        if cached:
            return json.loads(cached.payload_json)

        resume_text = resume_doc["document"]
        resume_embedding = EmbeddingModel.get().embed_text(resume_text)
        jd_embedding = EmbeddingModel.get().embed_text(f"{job.title}\n\n{job.description}")

        score_res = score_resume_against_jd(
            resume_text, job.description, resume_embedding, jd_embedding, branch=(job.branch or profile.branch)
        )
        missing_skills = score_res["missing_skills"]

        result = run_resume_suggestions(resume_text, job.description, missing_skills)
        session.add(AnalysisCache(cache_key=cache_key, payload_json=json.dumps(result)))
        session.commit()
        return result
