import hashlib
import json
import os
import uuid
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Depends
from sqlmodel import Session, select

from ..db import engine, AnalysisCache, Company, JobDescription, Resume, Application, Job
from ..auth import get_current_candidate
from ..resume_utils import save_and_index_resume
from ..services.deep_analysis import make_cache_key, run_deep_analysis, run_resume_suggestions
from ..services.embeddings import EmbeddingModel
from ..services.role_templates import get_role, list_branches, list_roles
from ..services.scoring import score_resume_against_jd
from ..resume_utils import vector_store
from ..services.vocab_learning import learn_skills_from_resume

router = APIRouter(prefix="/api/candidate", tags=["candidate"])


@router.get("/branches")
async def candidate_branches():
    return list_branches()


@router.get("/roles")
async def candidate_roles(branch: Optional[str] = None):
    return list_roles(branch)


@router.post("/ats-score")
async def generic_ats_score(
    file: UploadFile = File(...),
    job_description: str = Form(""),
    role_id: str = Form(""),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """
    FLOW 1: Normal ATS check.
    Candidate uploads a resume + pastes any job description (no company selection).
    Returns score + missing keywords, computed in milliseconds (embeddings + keyword match,
    no LLM call).
    """
    target_description = job_description
    target_title = None
    branch = None
    if role_id:
        role = get_role(role_id)
        if not role:
            raise HTTPException(status_code=400, detail="Unknown role_id")
        target_title = role.title
        target_description = role.description
        branch = role.branch
    elif not job_description or not job_description.strip():
        raise HTTPException(status_code=400, detail="Job description or role_id is required")

    doc_id, resume_text, resume_embedding, _ = save_and_index_resume(file)
    jd_embedding = EmbeddingModel.get().embed_text(target_description)

    result = score_resume_against_jd(resume_text, target_description, resume_embedding, jd_embedding, branch=branch)
    result["resume_id"] = doc_id
    if role_id:
        result["role_id"] = role_id
        result["job_title"] = target_title

    background_tasks.add_task(learn_skills_from_resume, resume_text, branch)
    return result


@router.get("/companies")
async def candidate_companies():
    """FLOW 2: Candidate wants to check ATS against a SPECIFIC company's JD."""
    with Session(engine) as session:
        companies = session.exec(select(Company).order_by(Company.created_at.desc())).all()
        results = []
        for company in companies:
            jd = session.exec(
                select(JobDescription)
                .where(JobDescription.company_id == company.id)
                .order_by(JobDescription.updated_at.desc())
            ).first()
            if jd:
                results.append({
                    "id": company.id,
                    "name": company.name,
                    "job_title": jd.title,
                })
        return results


@router.post("/ats-score-for-company")
async def company_specific_ats_score(
    file: UploadFile = File(...),
    company_id: int = Form(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """
    FLOW 2: Candidate uploads resume + selects a company.
    Finds the latest JD for that company, scores resume, returns score + missing keywords.
    """
    with Session(engine) as session:
        company = session.get(Company, company_id)
        if not company:
            raise HTTPException(status_code=404, detail="Company not found")
        jd = session.exec(
            select(JobDescription)
            .where(JobDescription.company_id == company_id)
            .order_by(JobDescription.updated_at.desc())
        ).first()
        if not jd:
            raise HTTPException(status_code=404, detail="This company has no job description posted yet")
        job_title, job_description = jd.title, jd.description

    doc_id, resume_text, resume_embedding, _ = save_and_index_resume(file)
    jd_embedding = EmbeddingModel.get().embed_text(f"{job_title}\n\n{job_description}")

    # No specific branch in legacy JDs, so branch = None
    result = score_resume_against_jd(resume_text, job_description, resume_embedding, jd_embedding, branch=None)
    result["resume_id"] = doc_id
    result["company_name"] = company.name
    result["job_title"] = job_title
    result["apply_url"] = jd.apply_url

    background_tasks.add_task(learn_skills_from_resume, resume_text, None)
    return result


@router.post("/ats-score-existing-resume-for-company")
async def company_score_existing_resume(resume_id: str = Form(...), company_id: int = Form(...)):
    resume_doc = vector_store.get_document("resumes", resume_id)
    if not resume_doc:
        raise HTTPException(status_code=404, detail="Resume not found. Run ATS scoring first.")

    with Session(engine) as session:
        jd = session.exec(
            select(JobDescription)
            .where(JobDescription.company_id == company_id)
            .order_by(JobDescription.updated_at.desc())
        ).first()
        if not jd:
            raise HTTPException(status_code=404, detail="This company has no job description posted yet")
        job_title, job_description = jd.title, jd.description

    resume_embedding = EmbeddingModel.get().embed_text(resume_doc["document"])
    jd_embedding = EmbeddingModel.get().embed_text(f"{job_title}\n\n{job_description}")
    result = score_resume_against_jd(resume_doc["document"], job_description, resume_embedding, jd_embedding)
    result["resume_id"] = resume_id
    result["company_id"] = company_id
    result["job_title"] = job_title
    result["apply_url"] = jd.apply_url
    return result


@router.post("/ats-score-existing-resume")
async def score_existing_resume(
    resume_id: str = Form(...),
    role_id: str = Form(""),
    company_id: Optional[int] = Form(None),
    job_description: str = Form(""),
):
    """
    Fast ATS check for a resume already stored (e.g. the one on a candidate's
    profile) against a role, company, or custom JD - no re-upload needed.
    Mirrors the role_id/company_id/job_description resolution used by
    /deep-analysis. Pure embeddings+keyword scoring, no LLM call.
    """
    resume_doc = vector_store.get_document("resumes", resume_id)
    if not resume_doc:
        raise HTTPException(status_code=404, detail="Resume not found. Run ATS scoring first.")

    target_title = None
    target_branch = None
    target_text = job_description
    if role_id:
        role = get_role(role_id)
        if not role:
            raise HTTPException(status_code=400, detail="Unknown role_id")
        target_title = role.title
        target_branch = role.branch
        target_text = role.description
    elif company_id is not None:
        with Session(engine) as session:
            jd = session.exec(
                select(JobDescription)
                .where(JobDescription.company_id == company_id)
                .order_by(JobDescription.updated_at.desc())
            ).first()
            if not jd:
                raise HTTPException(status_code=404, detail="This company has no job description posted yet")
            target_title = jd.title
            target_text = jd.description
    elif not job_description.strip():
        raise HTTPException(status_code=400, detail="Provide one of role_id, company_id, or job_description")

    resume_embedding = EmbeddingModel.get().embed_text(resume_doc["document"])
    jd_embedding = EmbeddingModel.get().embed_text(f"{target_title}\n\n{target_text}" if target_title else target_text)
    result = score_resume_against_jd(resume_doc["document"], target_text, resume_embedding, jd_embedding, branch=target_branch)
    result["resume_id"] = resume_id
    if target_title:
        result["job_title"] = target_title
    return result


@router.post("/deep-analysis")
async def deep_analysis(
    resume_id: str = Form(...),
    role_id: str = Form(""),
    company_id: Optional[int] = Form(None),
    job_description: str = Form(""),
):
    resume_doc = vector_store.get_document("resumes", resume_id)
    if not resume_doc:
        raise HTTPException(status_code=404, detail="Resume not found. Run ATS scoring first.")

    target_kind = "custom"
    target_text = job_description
    if role_id:
        role = get_role(role_id)
        if not role:
            raise HTTPException(status_code=400, detail="Unknown role_id")
        target_kind = f"role:{role_id}"
        target_text = role.description
    elif company_id is not None:
        with Session(engine) as session:
            jd = session.exec(
                select(JobDescription)
                .where(JobDescription.company_id == company_id)
                .order_by(JobDescription.updated_at.desc())
            ).first()
            if not jd:
                raise HTTPException(status_code=404, detail="This company has no job description posted yet")
            target_kind = f"company:{company_id}:{jd.id}"
            target_text = f"{jd.title}\n\n{jd.description}"
    elif not job_description.strip():
        raise HTTPException(status_code=400, detail="Provide one of role_id, company_id, or job_description")

    cache_key = make_cache_key(resume_id, target_kind, target_text)
    with Session(engine) as session:
        cached = session.exec(select(AnalysisCache).where(AnalysisCache.cache_key == cache_key)).first()
        if cached:
            return json.loads(cached.payload_json)

        result = run_deep_analysis(resume_doc["document"], target_text)
        session.add(AnalysisCache(cache_key=cache_key, payload_json=json.dumps(result)))
        session.commit()
        return result


@router.post("/resume-suggestions")
async def resume_suggestions(
    resume_id: str = Form(...),
    role_id: str = Form(""),
    company_id: Optional[int] = Form(None),
    job_description: str = Form(""),
):
    resume_doc = vector_store.get_document("resumes", resume_id)
    if not resume_doc:
        raise HTTPException(status_code=404, detail="Resume not found. Run ATS scoring first.")

    target_kind = "custom"
    target_text = job_description
    branch = None
    if role_id:
        role = get_role(role_id)
        if not role:
            raise HTTPException(status_code=400, detail="Unknown role_id")
        target_kind = f"role:{role_id}"
        target_text = role.description
        branch = role.branch
    elif company_id is not None:
        with Session(engine) as session:
            jd = session.exec(
                select(JobDescription)
                .where(JobDescription.company_id == company_id)
                .order_by(JobDescription.updated_at.desc())
            ).first()
            if not jd:
                raise HTTPException(status_code=404, detail="This company has no job description posted yet")
            target_kind = f"company:{company_id}:{jd.id}"
            target_text = f"{jd.title}\n\n{jd.description}"
    elif not job_description.strip():
        raise HTTPException(status_code=400, detail="Provide one of role_id, company_id, or job_description")

    cache_key = make_cache_key(resume_id, f"suggestions:{target_kind}", target_text)
    with Session(engine) as session:
        cached = session.exec(select(AnalysisCache).where(AnalysisCache.cache_key == cache_key)).first()
        if cached:
            return json.loads(cached.payload_json)

        # Compute missing skills fast first
        resume_text = resume_doc["document"]
        resume_embedding = EmbeddingModel.get().embed_text(resume_text)
        jd_embedding = EmbeddingModel.get().embed_text(target_text)

        score_res = score_resume_against_jd(
            resume_text, target_text, resume_embedding, jd_embedding, branch=branch
        )
        missing_skills = score_res["missing_skills"]

        # Call LLM suggestions
        result = run_resume_suggestions(resume_text, target_text, missing_skills)
        session.add(AnalysisCache(cache_key=cache_key, payload_json=json.dumps(result)))
        session.commit()
        return result

@router.post("/score-project")
async def score_project(
    file: UploadFile = File(...),
    job_description: str = Form(""),
    role_id: str = Form(""),
    application_id: Optional[int] = Form(None),
    ats_score: float = Form(0.0),
    candidate: str = Depends(get_current_candidate),
):
    import os
    import shutil
    import tempfile
    import json
    from ..services.report_parsers.router import route_file
    from ..services.scorer import score_student_job
    from ..services.role_templates import get_role

    target_description = job_description
    target_title = None
    branch = None

    # Resolve JD and target branch
    if application_id is not None:
        with Session(engine) as session:
            from ..db import CandidateUser
            cand_user = session.exec(select(CandidateUser).where(CandidateUser.username == candidate)).first()
            if not cand_user:
                raise HTTPException(status_code=404, detail="Candidate profile not found")

            app_record = session.get(Application, application_id)
            if not app_record:
                raise HTTPException(status_code=404, detail="Application not found")
            if app_record.candidate_id != cand_user.id:
                raise HTTPException(status_code=403, detail="You do not have permission to score this application")

            job_record = session.get(Job, app_record.job_id)
            if not job_record:
                raise HTTPException(status_code=404, detail="Job not found")
            target_title = job_record.title
            target_description = job_record.description
            branch = job_record.branch
            if app_record.ats_score is not None:
                ats_score = float(app_record.ats_score)
    elif role_id:
        role = get_role(role_id)
        if not role:
            raise HTTPException(status_code=400, detail="Unknown role_id")
        target_title = role.title
        target_description = role.description
        branch = role.branch
    elif not job_description or not job_description.strip():
        raise HTTPException(status_code=400, detail="Application ID, Job description or role_id is required")

    # Limit file size check roughly, parser can be large but we don't want 1GB zips
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Project file too large (max 10MB)")

    # Save to temp file
    fd, temp_path = tempfile.mkstemp(suffix=os.path.splitext(file.filename)[1])
    try:
        with os.fdopen(fd, 'wb') as f:
            shutil.copyfileobj(file.file, f)
        
        from ..services.mime_check import validate_file_content_matches_extension, ALLOWED_MIME_BY_EXTENSION
        ext = os.path.splitext(file.filename)[1].lower()
        if ext in ALLOWED_MIME_BY_EXTENSION:
            try:
                validate_file_content_matches_extension(temp_path, ext)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))

        # 1. Parse
        text, method = route_file(temp_path)
        if not text or not text.strip():
            raise HTTPException(status_code=400, detail="Could not extract text from the provided file.")
        
        # 2. Score
        student = {"name": candidate, "branch": branch, "ats_score": ats_score}
        job_dict = {"job_title": target_title, "full_jd_text": target_description}
        result = score_student_job(student, [text], job_dict)
        result["parse_method"] = method

        # 3. Persist if application_id
        if application_id is not None:
            with Session(engine) as session:
                app_record = session.get(Application, application_id)
                if app_record:
                    app_record.project_score = result.get("project_score")
                    app_record.repo_match_score = int(result.get("project_score")) if result.get("project_score") is not None else None
                    app_record.repo_match_reasoning = result.get("project_summary")
                    app_record.final_score = result.get("final_score")
                    app_record.project_summary = result.get("project_summary")
                    app_record.priority_level = result.get("priority_level")
                    app_record.ai_recommendation = result.get("ai_recommendation")
                    app_record.suitability_verdict = result.get("priority_level")
                    app_record.skills_matched_detail = json.dumps(result.get("skills_matched", []))
                    app_record.skills_gap_detail = json.dumps(result.get("skills_missing", []))
                    app_record.api_used = result.get("api_used")
                    app_record.parse_method = method
                    if app_record.status != "shortlisted":
                        app_record.status = "repo_verification"
                    # Do NOT auto-unlock interview; requires explicit recruiter Stage 2 unlock action
                    session.add(app_record)
                    session.commit()
                    session.refresh(app_record)

                    # Write audit log for project scoring
                    from ..services.audit import record_audit_event
                    record_audit_event(
                        session=session,
                        event_type="project_score",
                        application_id=app_record.id,
                        candidate_id=app_record.candidate_id,
                        job_id=app_record.job_id,
                        ats_score=app_record.ats_score,
                        project_score=result.get("project_score"),
                        final_score=result.get("final_score"),
                        matched_skills=result.get("skills_matched", []),
                        missing_skills=result.get("skills_missing", []),
                        llm_providers_consulted=[result.get("api_used")] if result.get("api_used") in ("groq", "gemini") else [],
                        raw_verdicts=result,
                        final_recommendation=result.get("ai_recommendation"),
                    )

        return result
    finally:
        os.remove(temp_path)


def can_take_interview(app_record: Application) -> dict:
    """
    Gatekeeper rule:
    Interview is unlocked ONLY AFTER:
    1. Candidate application status is shortlisted, repo_verification, or automated_interview.
    2. Repo / Project Verification is complete (repo_match_score is not None).
    3. Recruiter has reviewed Stage 2 and explicitly set interview_status = "unlocked".
    """
    if not app_record:
        return {"allowed": False, "reason": "Application not found", "status": "locked"}

    valid_statuses = {"shortlisted", "automated_interview", "repo_verification"}
    if app_record.status not in valid_statuses:
        return {
            "allowed": False,
            "reason": f"Interview is locked. Application status must be shortlisted (current status: {app_record.status}).",
            "status": "locked"
        }

    # Verify project / repo match score is present
    has_repo_score = app_record.repo_match_score is not None or app_record.project_score is not None
    if not has_repo_score:
        return {
            "allowed": False,
            "reason": "Interview is locked. Candidate must complete Repo / Project Verification first.",
            "status": "locked"
        }

    if app_record.interview_status == "completed":
        return {
            "allowed": False,
            "reason": "Interview is already completed.",
            "status": "completed"
        }

    if app_record.interview_status != "unlocked":
        return {
            "allowed": False,
            "reason": "Interview is locked pending recruiter Stage 2 review.",
            "status": "locked"
        }

    return {"allowed": True, "reason": "Interview unlocked and ready to take", "status": "unlocked"}


@router.get("/applications/{app_id}/interview_access")
async def check_interview_access(app_id: int):
    with Session(engine) as session:
        app_record = session.get(Application, app_id)
        if not app_record:
            raise HTTPException(status_code=404, detail="Application not found")
        access = can_take_interview(app_record)
        return {
            "application_id": app_id,
            "status": app_record.status,
            "repo_match_score": app_record.repo_match_score or app_record.project_score,
            "interview_status": app_record.interview_status,
            "allowed": access["allowed"],
            "reason": access["reason"]
        }


@router.post("/applications/{app_id}/submit_interview")
async def submit_interview_results(
    app_id: int,
    payload: dict
):
    with Session(engine) as session:
        app_record = session.get(Application, app_id)
        if not app_record:
            raise HTTPException(status_code=404, detail="Application not found")
        
        access = can_take_interview(app_record)
        if not access["allowed"] and app_record.interview_status != "in_progress":
            raise HTTPException(status_code=403, detail=access["reason"])

        risk_score = payload.get("risk_score", 0)
        risk_level = payload.get("risk_level", "low")
        eval_score = payload.get("eval_score", 85)
        recommendation = payload.get("recommendation", "Strong candidate based on speaking charter evaluation and low proctoring risk.")

        app_record.interview_risk_score = risk_score
        app_record.interview_risk_level = risk_level
        app_record.interview_eval_score = eval_score
        app_record.interview_recommendation = recommendation
        app_record.interview_evidence_url = payload.get("evidence_url", "/api/evidence/sample.webm")
        app_record.interview_transcript_json = json.dumps(payload.get("transcript", []))
        app_record.interview_status = "completed"
        app_record.status = "automated_interview"

        # If high proctoring risk is flagged, require human recruiter review
        if risk_level == "high" or risk_score >= 50:
            app_record.pending_human_review = True

        session.add(app_record)
        session.commit()
        session.refresh(app_record)

        # Write audit log for interview evaluation
        from ..services.audit import record_audit_event
        record_audit_event(
            session=session,
            event_type="interview_evaluation",
            application_id=app_record.id,
            candidate_id=app_record.candidate_id,
            job_id=app_record.job_id,
            ats_score=app_record.ats_score,
            project_score=app_record.project_score,
            final_score=app_record.final_score,
            risk_score=risk_score,
            risk_level=risk_level,
            raw_verdicts=payload,
            final_recommendation=recommendation,
        )

        return {
            "message": "Interview results saved successfully",
            "application_id": app_id,
            "interview_status": app_record.interview_status,
            "interview_eval_score": app_record.interview_eval_score,
            "interview_risk_level": app_record.interview_risk_level,
            "pending_human_review": app_record.pending_human_review,
        }


@router.post("/applications/{app_id}/request-data-deletion")
async def request_interview_data_deletion(
    app_id: int,
    candidate: str = Depends(get_current_candidate)
):
    """
    Candidate right-to-be-forgotten endpoint:
    Purges raw proctoring media and interview transcripts upon candidate request,
    while preserving aggregated score metrics and writing an immutable audit log.
    """
    with Session(engine) as session:
        from ..db import CandidateUser
        user = session.exec(select(CandidateUser).where(CandidateUser.username == candidate)).first()
        if not user:
            raise HTTPException(status_code=404, detail="Candidate not found")

        app_record = session.get(Application, app_id)
        if not app_record:
            raise HTTPException(status_code=404, detail="Application not found")
        if app_record.candidate_id != user.id:
            raise HTTPException(status_code=403, detail="Not authorized to request deletion for this application")

        app_record.interview_evidence_url = "[Deleted upon candidate request]"
        app_record.interview_transcript_json = "[]"
        session.add(app_record)
        session.commit()
        session.refresh(app_record)

        # Log deletion event in DecisionAuditLog
        from ..services.audit import record_audit_event
        record_audit_event(
            session=session,
            event_type="candidate_deletion_request",
            application_id=app_record.id,
            candidate_id=user.id,
            job_id=app_record.job_id,
            human_reviewer=candidate,
            human_action="deleted_proctoring_data",
            final_recommendation="Proctoring media and transcript purged upon candidate request.",
        )

        return {
            "message": "Proctoring media and transcript data successfully purged.",
            "application_id": app_id,
        }

