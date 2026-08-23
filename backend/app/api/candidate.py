import hashlib
import json
import os
import uuid
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from sqlmodel import Session, select

from ..db import engine, AnalysisCache, Company, JobDescription, Resume
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
