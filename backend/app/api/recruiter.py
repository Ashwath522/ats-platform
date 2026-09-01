import os
import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, Query
from sqlmodel import Session, select

from ..db import engine, Company, JobDescription
from ..auth import get_current_recruiter
from ..services.embeddings import EmbeddingModel
from ..services.scoring import score_resume_against_jd
from ..vector_store import VectorStore

router = APIRouter(prefix="/api/recruiter", tags=["recruiter"])

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # -> backend/
DATA_DIR = os.environ.get("ATS_DATA_DIR", os.path.join(BASE_DIR, "data"))
vector_store = VectorStore(persist_directory=os.path.join(DATA_DIR, "chroma"))

MAX_TOP_K = 200  # hard ceiling regardless of what the client requests


def _require_owned_company(session: Session, company_id: int, recruiter: str) -> Company:
    company = session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    if company.owner_username != recruiter:
        raise HTTPException(status_code=403, detail="You do not have access to this company")
    return company


@router.get("/companies")
async def list_owned_companies(recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        companies = session.exec(
            select(Company)
            .where(Company.owner_username == recruiter)
            .order_by(Company.created_at.desc())
        ).all()
        out = []
        for company in companies:
            jd = session.exec(
                select(JobDescription)
                .where(JobDescription.company_id == company.id)
                .order_by(JobDescription.updated_at.desc())
            ).first()
            out.append({
                "id": company.id,
                "name": company.name,
                "current_title": jd.title if jd else None,
                "apply_url": jd.apply_url if jd else None,
            })
        return out


@router.post("/companies")
async def create_company(name: str = Form(...), recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        company = Company(name=name, owner_username=recruiter)
        session.add(company)
        session.commit()
        session.refresh(company)
        return {"id": company.id, "name": company.name}


@router.delete("/companies/{company_id}")
async def delete_company(company_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        company = _require_owned_company(session, company_id, recruiter)
        jds = session.exec(select(JobDescription).where(JobDescription.company_id == company_id)).all()
        for jd in jds:
            session.delete(jd)
        session.delete(company)
        session.commit()
        return {"deleted": True, "company_id": company_id}


@router.put("/companies/{company_id}")
async def update_company(
    company_id: int,
    name: str = Form(...),
    recruiter: str = Depends(get_current_recruiter),
):
    with Session(engine) as session:
        company = _require_owned_company(session, company_id, recruiter)
        company.name = name
        session.add(company)
        session.commit()
        session.refresh(company)
        return {"id": company.id, "name": company.name}


@router.get("/companies/{company_id}/job-descriptions")
async def list_job_descriptions(company_id: int, recruiter: str = Depends(get_current_recruiter)):
    with Session(engine) as session:
        _require_owned_company(session, company_id, recruiter)
        jds = session.exec(
            select(JobDescription)
            .where(JobDescription.company_id == company_id)
            .order_by(JobDescription.updated_at.desc())
        ).all()
        return [
            {
                "id": jd.id,
                "title": jd.title,
                "description": jd.description,
                "apply_url": jd.apply_url,
                "updated_at": jd.updated_at
            }
            for jd in jds
        ]


@router.post("/companies/{company_id}/job-description")
async def set_job_description(
    company_id: int,
    title: str = Form(...),
    description: str = Form(...),
    apply_url: str = Form(""),
    recruiter: str = Depends(get_current_recruiter),
):
    """
    Recruiter posts or UPDATES the title/JD for their company. This is what makes
    flow 3 'automatic': every time this is called, the JD embedding is recomputed and
    the next call to /matching-resumes re-ranks against the new text - no separate
    resync step needed.
    """
    with Session(engine) as session:
        _require_owned_company(session, company_id, recruiter)

        vector_doc_id = str(uuid.uuid4())
        embedding = EmbeddingModel.get().embed_text(f"{title}\n\n{description}")
        vector_store.add_document(
            collection_name="jobs",
            doc_id=vector_doc_id,
            document=f"{title}\n\n{description}",
            metadata={"company_id": company_id, "title": title},
            embedding=embedding,
        )

        jd = JobDescription(
            company_id=company_id,
            title=title,
            description=description,
            apply_url=apply_url.strip() or None,
            vector_doc_id=vector_doc_id,
        )
        session.add(jd)
        session.commit()
        session.refresh(jd)
        return {"id": jd.id, "company_id": company_id, "title": title, "apply_url": jd.apply_url}


@router.get("/companies/{company_id}/matching-resumes")
async def matching_resumes(
    company_id: int,
    top_k: int = Query(default=20, ge=1, le=MAX_TOP_K),
    offset: int = Query(default=0, ge=0),
    recruiter: str = Depends(get_current_recruiter),
):
    """
    FLOW 3: Recruiter sees resumes ranked against the company's CURRENT job description.
    Always uses the latest JD row for this company, so if the JD was just updated,
    this endpoint immediately reflects it - nothing needs to be manually resynced.

    Scaling note: resume embeddings are read back from Chroma (stored at upload time)
    instead of being recomputed by the model on every request. This was previously the
    dominant cost on this endpoint (one model.encode() call per resume, per request) -
    now scoring is pure vector math, cheap even with a large resume pool. `top_k` +
    `offset` provide basic pagination on top of that.
    """
    with Session(engine) as session:
        _require_owned_company(session, company_id, recruiter)

        jd = session.exec(
            select(JobDescription)
            .where(JobDescription.company_id == company_id)
            .order_by(JobDescription.updated_at.desc())
        ).first()
        if not jd:
            raise HTTPException(status_code=404, detail="No job description set for this company yet")

        job_title, job_description = jd.title, jd.description
        jd_embedding = EmbeddingModel.get().embed_text(f"{job_title}\n\n{job_description}")

        # Fetch enough candidates to cover the requested page. Chroma doesn't support
        # true offset pagination, so we over-fetch to (offset + top_k) and slice locally -
        # fine up to MAX_TOP_K, revisit if the resume pool grows past a few thousand.
        candidates = vector_store.query_collection(
            collection_name="resumes", query_embedding=jd_embedding, n_results=offset + top_k
        )
        page = candidates[offset:offset + top_k]

        ranked = []
        for c in page:
            # Reuse the embedding stored at upload time instead of recomputing it here.
            scored = score_resume_against_jd(
                c["document"], job_description, c["embedding"], jd_embedding
            )
            ranked.append({
                "resume_id": c["id"],
                "filename": c["metadata"].get("filename"),
                **scored,
            })

        ranked.sort(key=lambda r: r["ats_score"], reverse=True)
        return {
            "company_id": company_id,
            "job_title": job_title,
            "results": ranked,
            "offset": offset,
            "top_k": top_k,
            "returned": len(ranked),
        }

from ..db import RecruiterPost, RecruiterUser
from pydantic import BaseModel
import datetime

class PostCreate(BaseModel):
    content: str

@router.post("/posts")
async def create_recruiter_post(
    post_in: PostCreate,
    recruiter: str = Depends(get_current_recruiter)
):
    with Session(engine) as session:
        user = session.exec(select(RecruiterUser).where(RecruiterUser.username == recruiter)).first()
        if not user:
            raise HTTPException(status_code=403, detail="Not authorized")
            
        post = RecruiterPost(
            recruiter_id=user.id,
            content=post_in.content
        )
        session.add(post)
        session.commit()
        session.refresh(post)
        
        return {
            "id": post.id,
            "content": post.content,
            "created_at": post.created_at,
            "recruiter_username": recruiter
        }

@router.get("/posts")
async def get_recruiter_posts(
    recruiter: str = Depends(get_current_recruiter)
):
    with Session(engine) as session:
        posts = session.exec(
            select(RecruiterPost)
            .order_by(RecruiterPost.created_at.desc())
            .limit(50)
        ).all()
        
        out = []
        for post in posts:
            user = session.get(RecruiterUser, post.recruiter_id)
            out.append({
                "id": post.id,
                "content": post.content,
                "created_at": post.created_at,
                "recruiter_username": user.username if user else "Unknown"
            })
        return out
