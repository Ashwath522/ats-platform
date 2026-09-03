"""Recruiter job posting CRUD + applicant ranking."""
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import engine, Job, Application, RecruiterUser, Resume, CandidateProfile, utc_now
from ..auth import get_current_recruiter
from ..services.geocoding import geocode
from ..services.embeddings import EmbeddingModel
from ..services.scoring import score_resume_against_jd
from ..services.scorer import evaluate_repo_against_jd
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
                "id": app.id,
                "candidate_name": profile.headline if profile else "Unknown",
                "resume_filename": resume.filename if resume else None,
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
                "project_summary": app.project_summary,
                "has_repo": bool(profile and profile.project_summary and profile.project_summary != "Evaluation failed."),
                "repo_match_score": app.repo_match_score,
                "repo_match_reasoning": app.repo_match_reasoning,
                "suitability_verdict": app.suitability_verdict,
                "ai_recommendation": app.ai_recommendation,
                "interview_status": app.interview_status,
                "interview_risk_score": app.interview_risk_score,
                "interview_risk_level": app.interview_risk_level,
                "interview_eval_score": app.interview_eval_score,
                "interview_recommendation": app.interview_recommendation,
                "interview_evidence_url": app.interview_evidence_url,
                "interview_transcript_json": app.interview_transcript_json,
                "pending_human_review": app.pending_human_review,
                "human_reviewer": app.human_reviewer,
                "human_decision_notes": app.human_decision_notes,
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
    notes: Optional[str] = Form(None),
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
        app.pending_human_review = False
        app.human_reviewer = recruiter
        if notes:
            app.human_decision_notes = notes
        session.add(app)
        session.commit()
        session.refresh(app)

        # Log human status decision in DecisionAuditLog
        from ..services.audit import record_audit_event
        record_audit_event(
            session=session,
            event_type="recruiter_decision",
            application_id=app.id,
            candidate_id=app.candidate_id,
            job_id=job_id,
            ats_score=app.ats_score,
            project_score=app.project_score,
            final_score=app.final_score,
            human_reviewer=recruiter,
            human_action=f"status_change_{status}",
            final_recommendation=notes or f"Status changed to {status} by {recruiter}",
        )

        return {"status": "success", "new_status": app.status, "human_reviewer": recruiter}


@router.post("/{job_id}/applicants/{application_id}/confirm-decision")
async def confirm_recruiter_decision(
    job_id: int,
    application_id: int,
    decision: str = Form(...),  # "shortlisted" | "rejected" | "overridden"
    notes: str = Form(""),
    recruiter: str = Depends(get_current_recruiter),
):
    """
    Recruiter explicit human oversight gate:
    Confirms or overrides an automated rejection or high-risk interview flag.
    Logs who confirmed and when in the DecisionAuditLog.
    """
    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        job = _get_owned_job_or_403(session, job_id, user.id)

        app = session.get(Application, application_id)
        if not app or app.job_id != job_id:
            raise HTTPException(status_code=404, detail="Application not found for this job")

        if decision not in ("shortlisted", "rejected", "overridden", "ats_check", "repo_verification"):
            raise HTTPException(status_code=400, detail="Invalid decision action")

        app.pending_human_review = False
        app.human_reviewer = recruiter
        app.human_decision_notes = notes
        if decision in ("shortlisted", "rejected"):
            app.status = decision

        session.add(app)
        session.commit()
        session.refresh(app)

        from ..services.audit import record_audit_event
        record_audit_event(
            session=session,
            event_type="recruiter_confirmation",
            application_id=app.id,
            candidate_id=app.candidate_id,
            job_id=job_id,
            ats_score=app.ats_score,
            project_score=app.project_score,
            final_score=app.final_score,
            risk_score=app.interview_risk_score,
            risk_level=app.interview_risk_level,
            human_reviewer=recruiter,
            human_action=f"confirmed_{decision}",
            final_recommendation=notes or f"Human decision confirmed by {recruiter}: {decision}",
        )

        return {
            "message": "Recruiter human decision recorded successfully",
            "application_id": application_id,
            "new_status": app.status,
            "human_reviewer": recruiter,
            "pending_human_review": False,
        }

@router.post("/{job_id}/applicants/{application_id}/evaluate-repo")
async def evaluate_applicant_repo(
    job_id: int,
    application_id: int,
    recruiter: str = Depends(get_current_recruiter),
):
    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        job = _get_owned_job_or_403(session, job_id, user.id)

        app = session.get(Application, application_id)
        if not app or app.job_id != job_id:
            raise HTTPException(status_code=404, detail="Application not found for this job")

        # Task 1: Gate repo verification to Stage 1 shortlisted applicants only
        if app.status != "shortlisted":
            raise HTTPException(
                status_code=400,
                detail="Candidate must be in a recruiter-approved shortlisted state (Stage 1 approved) before repo verification can be performed.",
            )

        profile = session.exec(
            select(CandidateProfile).where(CandidateProfile.candidate_id == app.candidate_id)
        ).first()

        project_summary = app.project_summary or (profile.project_summary if profile else None)
        if not project_summary or project_summary == "Evaluation failed.":
            raise HTTPException(status_code=400, detail="Candidate has not uploaded a valid project portfolio.")

        # Evaluate candidate's project summary against the recruiter's Job Description
        result = evaluate_repo_against_jd(project_summary, job.description)

        app.repo_match_score = result.get("repo_match_score", 0)
        app.repo_match_reasoning = result.get("repo_match_reasoning", "Failed to evaluate.")
        app.project_score = float(app.repo_match_score)
        app.project_summary = project_summary

        # Task 2: Compute and persist app.final_score using configurable weights
        from ..services.scorer import calculate_final_score
        app.final_score = calculate_final_score(float(app.ats_score or 0), float(app.repo_match_score or 0))

        session.add(app)
        session.commit()
        session.refresh(app)

        return {
            "repo_match_score": app.repo_match_score,
            "repo_match_reasoning": app.repo_match_reasoning,
            "final_score": app.final_score,
        }


@router.post("/{job_id}/applicants/{application_id}/unlock-interview")
async def unlock_applicant_interview(
    job_id: int,
    application_id: int,
    notes: str = Form(""),
    recruiter: str = Depends(get_current_recruiter),
):
    """
    Recruiter explicit Stage 2 human oversight gate:
    Unlocks AI Interview ONLY after recruiter has reviewed the candidate's
    repo_match_score and Stage 2 verification results.
    Logs the unlock event in DecisionAuditLog with full reviewer attribution.
    """
    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        job = _get_owned_job_or_403(session, job_id, user.id)

        app = session.get(Application, application_id)
        if not app or app.job_id != job_id:
            raise HTTPException(status_code=404, detail="Application not found for this job")

        if app.status != "shortlisted":
            raise HTTPException(
                status_code=400,
                detail="Candidate must be in a recruiter-approved shortlisted state before unlocking interview.",
            )

        if app.repo_match_score is None and app.project_score is None:
            raise HTTPException(
                status_code=400,
                detail="Repo verification must be completed before unlocking interview.",
            )

        app.interview_status = "unlocked"
        app.human_reviewer = recruiter
        if notes:
            app.human_decision_notes = notes
        session.add(app)
        session.commit()
        session.refresh(app)

        from ..services.audit import record_audit_event
        record_audit_event(
            session=session,
            event_type="recruiter_interview_unlock",
            application_id=app.id,
            candidate_id=app.candidate_id,
            job_id=job_id,
            ats_score=app.ats_score,
            project_score=app.project_score or app.repo_match_score,
            final_score=app.final_score,
            human_reviewer=recruiter,
            human_action="unlocked_interview",
            final_recommendation=notes or f"Recruiter {recruiter} verified Stage 2 repo score ({app.repo_match_score}) and unlocked AI interview.",
        )

        return {
            "message": "Interview unlocked successfully",
            "application_id": application_id,
            "interview_status": app.interview_status,
            "human_reviewer": recruiter,
        }

@router.post("/{job_id}/applicants/{application_id}/finalize")
async def finalize_applicant(
    job_id: int,
    application_id: int,
    recruiter: str = Depends(get_current_recruiter),
):
    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        job = _get_owned_job_or_403(session, job_id, user.id)

        app = session.get(Application, application_id)
        if not app or app.job_id != job_id:
            raise HTTPException(status_code=404, detail="Application not found for this job")
            
        # Update status
        app.status = "shortlisted"
        session.add(app)
        
        # Get candidate profile/user to send email
        from ..db import CandidateUser
        from ..utils.email_utils import DEV_MODE
        import logging
        
        candidate = session.get(CandidateUser, app.candidate_id)
        profile = session.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == app.candidate_id)).first()
        
        candidate_email = (profile.contact_email if profile and profile.contact_email else candidate.username) if candidate else None
        
        if candidate_email:
            subject = f"Congratulations! You have been shortlisted for {job.title}"
            body = f"Hello,\n\nYou have been selected for the next round for the position of {job.title}.\nWe will be in touch with next steps."
            if DEV_MODE:
                logging.info(f"[DEV_MODE EMAIL] To: {candidate_email} | Subject: {subject} | Body: {body}")
            else:
                pass # Use real email delivery here
                
        session.commit()
        return {"status": "success", "new_status": app.status}


class ApplicationStatusUpdate(BaseModel):
    status: str
    notes: Optional[str] = None


@router.post("/applications/{application_id}/status")
async def update_application_status_direct(
    application_id: int,
    payload: ApplicationStatusUpdate,
    recruiter: str = Depends(get_current_recruiter),
):
    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        app = session.get(Application, application_id)
        if not app:
            raise HTTPException(status_code=404, detail="Application not found")

        job = _get_owned_job_or_403(session, app.job_id, user.id)

        valid_statuses = ("ats_check", "repo_verification", "automated_interview", "shortlisted", "rejected")
        if payload.status not in valid_statuses:
            raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}")

        app.status = payload.status
        app.pending_human_review = False
        app.human_reviewer = recruiter
        if payload.notes:
            app.human_decision_notes = payload.notes
        session.add(app)
        session.commit()
        session.refresh(app)

        from ..services.audit import record_audit_event
        record_audit_event(
            session=session,
            event_type="recruiter_decision",
            application_id=app.id,
            candidate_id=app.candidate_id,
            job_id=app.job_id,
            ats_score=app.ats_score,
            project_score=app.project_score,
            final_score=app.final_score,
            human_reviewer=recruiter,
            human_action=f"status_change_{payload.status}",
            final_recommendation=payload.notes or f"Status changed to {payload.status} by {recruiter}",
        )

        return {"status": "success", "new_status": app.status, "human_reviewer": recruiter}


@router.post("/{job_id}/repo-verify")
async def run_repo_verification_batch(
    job_id: int,
    slot_count: Optional[int] = None,
    recruiter: str = Depends(get_current_recruiter),
):
    """
    Stage 2 Repo Verification Batch Endpoint:
    Runs ONLY on the existing ATS shortlist (shortlist #1) for this job.
    Scores each shortlisted candidate's project portfolio, computes final_score,
    ranks them, caps at job slot count, persists candidate_status ('shortlisted' / 'not_selected'),
    and returns the ranked shortlist #2 for recruiter UI.
    """
    with Session(engine) as session:
        user = _get_recruiter_user(session, recruiter)
        job = _get_owned_job_or_403(session, job_id, user.id)

        # 1. Fetch shortlist #1: applicants with status == 'shortlisted'
        shortlist_1_apps = session.exec(
            select(Application)
            .where(Application.job_id == job_id)
            .where(Application.status == "shortlisted")
        ).all()

        if not shortlist_1_apps:
            raise HTTPException(
                status_code=400,
                detail="No Stage 1 shortlisted applicants found for this job. Please run ATS shortlist first.",
            )

        from ..services.project_scorer import score_project
        from ..services.audit import record_audit_event

        evaluated_apps = []
        for app in shortlist_1_apps:
            profile = session.exec(
                select(CandidateProfile).where(CandidateProfile.candidate_id == app.candidate_id)
            ).first()

            project_text = app.project_summary or (profile.project_summary if profile else "") or (profile.project_description if profile else "") or ""
            res = score_project(app, job, project_text)

            app.project_score = res["project_score"]
            app.final_score = res["final_score"]
            app.repo_match_score = int(round(res["project_score"]))
            app.repo_match_reasoning = res["reasoning"]
            if res.get("project_summary"):
                app.project_summary = res["project_summary"]

            evaluated_apps.append((app, res))

        # 2. Rank candidates by final_score descending
        evaluated_apps.sort(key=lambda x: (x[0].final_score or 0, x[0].project_score or 0), reverse=True)

        # 3. Cap at slot count
        cap = slot_count if (slot_count is not None and slot_count > 0) else len(evaluated_apps)

        ranked_results = []
        for idx, (app, res) in enumerate(evaluated_apps):
            if idx < cap:
                app.candidate_status = "shortlisted"
            else:
                app.candidate_status = "not_selected"

            session.add(app)
            record_audit_event(
                session=session,
                event_type="repo_verify_batch",
                application_id=app.id,
                candidate_id=app.candidate_id,
                job_id=job_id,
                ats_score=app.ats_score,
                project_score=app.project_score,
                final_score=app.final_score,
                human_reviewer=recruiter,
                human_action=f"stage2_{app.candidate_status}",
                final_recommendation=f"Rank #{idx+1} in Shortlist #2 (score: {app.final_score}). Status: {app.candidate_status}.",
            )

            ranked_results.append({
                "rank": idx + 1,
                "application_id": app.id,
                "candidate_id": app.candidate_id,
                "ats_score": app.ats_score,
                "project_score": app.project_score,
                "final_score": app.final_score,
                "candidate_status": app.candidate_status,
                "repo_match_score": app.repo_match_score,
                "repo_match_reasoning": app.repo_match_reasoning,
                "project_summary": app.project_summary,
            })

        session.commit()

        return {
            "job_id": job_id,
            "total_evaluated": len(evaluated_apps),
            "shortlist_count": min(cap, len(evaluated_apps)),
            "shortlist": ranked_results,
        }


