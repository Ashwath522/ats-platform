import hashlib
import json
import os
import uuid
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from sqlmodel import Session, select

from ..db import engine, AnalysisCache, Company, JobDescription, Resume
from ..services.deep_analysis import make_cache_key, run_deep_analysis
from ..services.extract import extract_text_from_file
from ..services.mime_check import validate_file_content_matches_extension
from ..services.embeddings import EmbeddingModel
from ..services.role_templates import get_role, list_branches, list_roles
from ..services.scoring import score_resume_against_jd
from ..vector_store import VectorStore

router = APIRouter(prefix="/api/candidate", tags=["candidate"])

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # -> backend/
DATA_DIR = os.path.join(BASE_DIR, "data")
RESUME_DIR = os.path.join(DATA_DIR, "resumes")
os.makedirs(RESUME_DIR, exist_ok=True)

vector_store = VectorStore(persist_directory=os.path.join(DATA_DIR, "chroma"))

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8 MB - generous for a text resume, blocks accidental huge uploads


def _validate_extension(filename: str) -> str:
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext or 'unknown'}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )
    return ext


def _write_with_size_limit(file: UploadFile, dest: str, max_bytes: int) -> None:
    """Stream the upload to disk in chunks, aborting if it exceeds max_bytes.
    Avoids loading the whole file into memory and avoids trusting a client-sent
    Content-Length header (which can be absent or wrong)."""
    written = 0
    chunk_size = 1024 * 1024
    with open(dest, "wb") as buffer:
        while True:
            chunk = file.file.read(chunk_size)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                buffer.close()
                os.remove(dest)
                raise HTTPException(
                    status_code=413,
                    detail=f"File too large. Max size is {max_bytes // (1024 * 1024)}MB.",
                )
            buffer.write(chunk)


def _save_and_index_resume(file: UploadFile) -> tuple[str, str, list]:
    """Save uploaded resume to disk, extract text, embed + store in vector DB.
    Deduplicates by content hash: if this exact resume text was already indexed,
    the newly-saved file is discarded and the existing entry is reused instead of
    creating a duplicate DB row + duplicate vector.
    Returns (doc_id, extracted_text, embedding)."""
    _validate_extension(file.filename)

    uid = str(uuid.uuid4())
    filename = f"{uid}_{file.filename}"
    dest = os.path.join(RESUME_DIR, filename)
    _write_with_size_limit(file, dest, MAX_UPLOAD_BYTES)

    ext = os.path.splitext(file.filename or "")[1].lower()
    try:
        validate_file_content_matches_extension(dest, ext)
    except ValueError as e:
        os.remove(dest)
        raise HTTPException(status_code=400, detail=str(e))

    text = extract_text_from_file(dest)
    if not text or not text.strip():
        os.remove(dest)
        raise HTTPException(status_code=400, detail="Could not extract text from resume (try PDF or DOCX)")

    content_hash = hashlib.sha256(text.strip().encode("utf-8")).hexdigest()

    with Session(engine) as session:
        existing = session.exec(select(Resume).where(Resume.content_hash == content_hash)).first()
        if existing:
            # Same resume content already indexed (e.g. candidate re-uploaded, or
            # applied via two different flows). Drop the new file, reuse the old entry.
            os.remove(dest)
            existing_doc = vector_store.get_document("resumes", existing.vector_doc_id)
            if existing_doc:
                embedding = EmbeddingModel.get().embed_text(text)  # cheap, needed for the response
                return existing.vector_doc_id, text, embedding
            # Vector store entry missing (e.g. chroma data wiped independently of sqlite) -
            # fall through and re-index under the existing doc id instead of the new uid.
            uid = existing.vector_doc_id

        embedding = EmbeddingModel.get().embed_text(text)
        vector_store.add_document(
            collection_name="resumes",
            doc_id=uid,
            document=text,
            metadata={"filename": file.filename, "path": dest},
            embedding=embedding,
        )

        if not existing:
            session.add(Resume(
                filename=file.filename,
                file_path=dest,
                vector_doc_id=uid,
                content_hash=content_hash,
            ))
            session.commit()

    return uid, text, embedding


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
):
    """
    FLOW 1: Normal ATS check.
    Candidate uploads a resume + pastes any job description (no company selection).
    Returns score + missing keywords, computed in milliseconds (embeddings + keyword match,
    no LLM call).
    """
    target_description = job_description
    target_title = None
    if role_id:
        role = get_role(role_id)
        if not role:
            raise HTTPException(status_code=400, detail="Unknown role_id")
        target_title = role.title
        target_description = role.description
    elif not job_description or not job_description.strip():
        raise HTTPException(status_code=400, detail="Job description or role_id is required")

    doc_id, resume_text, resume_embedding = _save_and_index_resume(file)
    jd_embedding = EmbeddingModel.get().embed_text(target_description)

    result = score_resume_against_jd(resume_text, target_description, resume_embedding, jd_embedding)
    result["resume_id"] = doc_id
    if role_id:
        result["role_id"] = role_id
        result["job_title"] = target_title
    return result


@router.get("/companies")
async def list_companies():
    """List companies a candidate can target for flow 2."""
    with Session(engine) as session:
        companies = session.exec(select(Company)).all()
        out = []
        for c in companies:
            jd = session.exec(
                select(JobDescription)
                .where(JobDescription.company_id == c.id)
                .order_by(JobDescription.updated_at.desc())
            ).first()
            out.append({
                "id": c.id,
                "name": c.name,
                "current_title": jd.title if jd else None,
                "apply_url": jd.apply_url if jd else None,
            })
        return out


@router.post("/ats-score-for-company")
async def company_specific_ats_score(file: UploadFile = File(...), company_id: int = Form(...)):
    """
    FLOW 2: Candidate selects a company, gets ATS score + missing items against that
    company's CURRENT job description/title (always the latest, since we look it up live).
    """
    with Session(engine) as session:
        jd = session.exec(
            select(JobDescription)
            .where(JobDescription.company_id == company_id)
            .order_by(JobDescription.updated_at.desc())
        ).first()
        if not jd:
            raise HTTPException(status_code=404, detail="This company has no job description posted yet")
        job_title, job_description = jd.title, jd.description

    doc_id, resume_text, resume_embedding = _save_and_index_resume(file)
    jd_embedding = EmbeddingModel.get().embed_text(f"{job_title}\n\n{job_description}")

    result = score_resume_against_jd(resume_text, job_description, resume_embedding, jd_embedding)
    result["resume_id"] = doc_id
    result["company_id"] = company_id
    result["job_title"] = job_title
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
