"""
Shared resume upload/indexing logic.

Extracted from api/candidate.py so both the original anonymous ATS-check
endpoints and the new authenticated profile-resume-upload endpoint can reuse
the same save → extract → dedup → embed → index pipeline without duplication.
"""
import hashlib
import os
import uuid

from fastapi import UploadFile, HTTPException
from sqlmodel import Session, select

from .db import engine, Resume
from .services.extract import extract_text_from_file
from .services.embeddings import EmbeddingModel
from .vector_store import VectorStore

from .services.mime_check import validate_file_content_matches_extension

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))  # -> backend/
DATA_DIR = os.environ.get("ATS_DATA_DIR", os.path.join(BASE_DIR, "data"))
RESUME_DIR = os.path.join(DATA_DIR, "resumes")
os.makedirs(RESUME_DIR, exist_ok=True)

vector_store = VectorStore(persist_directory=os.path.join(DATA_DIR, "chroma"))

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8 MB


def _validate_extension(filename: str) -> str:
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext or 'unknown'}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )
    return ext


def _write_with_size_limit(file: UploadFile, dest: str, max_bytes: int) -> None:
    """Stream the upload to disk in chunks, aborting if it exceeds max_bytes."""
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


def save_and_index_resume(file: UploadFile) -> tuple:
    """Save uploaded resume to disk, extract text, embed + store in vector DB.
    Deduplicates by content hash: if this exact resume text was already indexed,
    the newly-saved file is discarded and the existing entry is reused.
    Returns (doc_id, extracted_text, embedding, resume_db_id)."""
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

    try:
        text = extract_text_from_file(dest)
    except ValueError as e:
        os.remove(dest)
        if str(e) == "password-protected":
            raise HTTPException(status_code=400, detail="The uploaded PDF is password-protected. Please remove the password and try again.")
        elif str(e) == "corrupted":
            raise HTTPException(status_code=400, detail="The uploaded PDF appears to be corrupted or malformed and cannot be read.")
        raise

    if not text or not text.strip():
        os.remove(dest)
        raise HTTPException(status_code=400, detail="Could not extract any readable text from the resume (try a standard PDF or DOCX format).")

    content_hash = hashlib.sha256(text.strip().encode("utf-8")).hexdigest()

    with Session(engine) as session:
        existing = session.exec(select(Resume).where(Resume.content_hash == content_hash)).first()
        if existing:
            os.remove(dest)
            existing_doc = vector_store.get_document("resumes", existing.vector_doc_id)
            if existing_doc:
                embedding = EmbeddingModel.get().embed_text(text)
                return existing.vector_doc_id, text, embedding, existing.id
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
            resume_row = Resume(
                filename=file.filename,
                file_path=dest,
                vector_doc_id=uid,
                content_hash=content_hash,
            )
            session.add(resume_row)
            session.commit()
            session.refresh(resume_row)
            return uid, text, embedding, resume_row.id
        else:
            return uid, text, embedding, existing.id
