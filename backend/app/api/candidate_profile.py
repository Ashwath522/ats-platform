"""Candidate profile CRUD + resume upload linked to profile."""
import json
import re
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Form, Path
from pydantic import BaseModel
from typing import Optional, List
from sqlmodel import Session, select

from ..db import engine, CandidateUser, CandidateProfile, Application, Resume, utc_now
from ..auth import get_current_candidate
from ..resume_utils import save_and_index_resume
from ..services import email_templates
from ..services.email_delivery import queue_email
from ..services.media_utils import validate_and_save_image, validate_and_save_cert_file, delete_media_file
import tempfile
import os
import shutil
from ..services.report_parsers.router import route_file
from ..services.scorer import evaluate_profile_project
from ..services.linkedin_pdf import parse_linkedin_text

logger = logging.getLogger("ats-platform")

router = APIRouter(prefix="/api/candidate/profile", tags=["candidate-profile"])


class ProfileUpdate(BaseModel):
    headline: Optional[str] = None
    bio: Optional[str] = None
    branch: Optional[str] = None
    skills: Optional[List[str]] = None
    experience: Optional[List[dict]] = None
    education: Optional[List[dict]] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    gender: Optional[str] = None  # EEO self-ID, candidate-controlled
    # v2 student portal fields
    full_name: Optional[str] = None
    college: Optional[str] = None
    degree: Optional[str] = None
    grad_year: Optional[int] = None
    current_year: Optional[str] = None
    cgpa: Optional[float] = None
    location_text: Optional[str] = None
    date_of_birth: Optional[str] = None
    portfolio_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    interests: Optional[List[str]] = None
    achievements: Optional[List[dict]] = None
    skill_levels: Optional[dict] = None
    preferences: Optional[dict] = None
    privacy: Optional[dict] = None
    notifications: Optional[dict] = None
    # {id, domain} of a college picked from the frontend college list; {} clears it.
    college_meta: Optional[dict] = None


def _get_candidate_user(session: Session, username: str) -> CandidateUser:
    user = session.exec(select(CandidateUser).where(CandidateUser.username == username)).first()
    if not user:
        raise HTTPException(status_code=404, detail="Candidate user not found")
    return user


def _get_or_create_profile(session: Session, candidate_id: int) -> CandidateProfile:
    profile = session.exec(
        select(CandidateProfile).where(CandidateProfile.candidate_id == candidate_id)
    ).first()
    if not profile:
        profile = CandidateProfile(candidate_id=candidate_id)
        session.add(profile)
        session.commit()
        session.refresh(profile)
    return profile


def _j(raw, default):
    try:
        return json.loads(raw) if raw else default
    except Exception:
        return default


_V2_SCALARS = ("full_name", "college", "degree", "grad_year", "current_year", "cgpa", "location_text",
               "date_of_birth", "portfolio_url", "linkedin_url", "github_url")
_V2_JSON = {"interests": ("interests_json", []), "achievements": ("achievements_json", []),
            "skill_levels": ("skill_levels_json", {}), "preferences": ("preferences_json", {}),
            "privacy": ("privacy_json", {}), "notifications": ("notifications_json", {})}


# College metadata (dataset id + official domain for the logo) is kept inside
# preferences_json under this key, so no new column is needed. It is exposed as
# a top-level `college_meta` and hidden from `preferences`.
_COLLEGE_META_KEY = "college_meta"
_HOST_RE = re.compile(r"^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})*\.[a-z]{2,24}$")
_COLLEGE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
_LINKEDIN_URL_RE = re.compile(r"^https?://(?:[a-z]{2,3}\.)?www\.linkedin\.com/in/([A-Za-z0-9-]+)$", re.I)

def normalize_linkedin_url(value):
    raw = str(value or '').strip()
    if not raw: return None
    candidate = raw if re.match(r'^https?://', raw, re.I) else 'https://' + raw
    candidate = candidate.split('?', 1)[0].rstrip('/')
    m = _LINKEDIN_URL_RE.match(candidate)
    if not m: raise HTTPException(422, 'Enter a valid LinkedIn profile URL, such as linkedin.com/in/your-name')
    return 'https://www.linkedin.com/in/' + m.group(1)


def _clean_college_meta(raw: Optional[dict], college: Optional[str]) -> Optional[dict]:
    if not isinstance(raw, dict) or not raw:
        return None
    cid = str(raw.get("id") or "").strip().lower()
    domain = str(raw.get("domain") or "").strip().lower()
    if not _COLLEGE_ID_RE.match(cid):
        raise HTTPException(status_code=422, detail="Invalid college id")
    if domain and (len(domain) > 120 or not _HOST_RE.match(domain)):
        raise HTTPException(status_code=422, detail="Invalid college domain")
    return {"id": cid, "domain": domain, "name": (college or "").strip()[:200]}


def _college_meta(profile: CandidateProfile) -> Optional[dict]:
    meta = _j(profile.preferences_json, {}).get(_COLLEGE_META_KEY) if profile.preferences_json else None
    if not isinstance(meta, dict) or not meta.get("id"):
        return None
    # Stale if the college text was changed elsewhere (e.g. by an admin) without new metadata.
    if (meta.get("name") or "").strip().lower() != (profile.college or "").strip().lower():
        return None
    return {"id": meta["id"], "domain": meta.get("domain") or ""}


def profile_completion(profile: CandidateProfile, has_resume: bool, project_count: int = 0) -> dict:
    """Checklist shown on dashboard / profile / settings (same rules everywhere)."""
    items = [
        ("personal", "Personal Information", bool((profile.full_name or "").strip() and (profile.contact_email or profile.contact_phone))),
        ("education", "Education Details", bool(profile.college or _j(profile.education_json, []))),
        ("skills", "Skills & Keywords", len(_j(profile.skills_json, [])) >= 3),
        ("projects", "Projects (Add at least 2)", project_count >= 2),
        ("resume", "Resume Upload", has_resume),
        ("certifications", "Certifications", len(_j(profile.certifications_json, [])) >= 1),
        ("portfolio", "Portfolio Links", bool(profile.portfolio_url or profile.github_url or profile.linkedin_url)),
    ]
    done = sum(1 for _, _, ok in items if ok)
    return {"percent": round(done * 100 / len(items)), "items": [{"key": k, "label": l, "done": ok} for k, l, ok in items]}


def _profile_to_dict(profile: CandidateProfile, resume: Resume = None, project_count: Optional[int] = None) -> dict:
    if project_count is None:
        with Session(engine) as _s:
            project_count = _project_count(_s, profile.candidate_id)
    v2 = {k: getattr(profile, k, None) for k in _V2_SCALARS}
    v2.update({k: _j(getattr(profile, col, None), d) for k, (col, d) in _V2_JSON.items()})
    if isinstance(v2.get("preferences"), dict):
        verified = v2["preferences"].get("linkedin_verified")
        v2["preferences"].pop(_COLLEGE_META_KEY, None)
    else: verified = None
    v2["college_meta"] = _college_meta(profile)
    return {
        **v2,
        "completion": profile_completion(profile, bool(resume), project_count),
        "headline": profile.headline,
        "bio": profile.bio,
        "branch": profile.branch,
        "skills": json.loads(profile.skills_json),
        "experience": json.loads(profile.experience_json),
        "education": json.loads(profile.education_json),
        "certifications": json.loads(profile.certifications_json),
        "avatar_url": f"/media/{profile.avatar_path}" if profile.avatar_path else None,
        "cover_photo_url": f"/media/{profile.cover_photo_path}" if profile.cover_photo_path else None,
        "contact_email": profile.contact_email,
        "contact_phone": profile.contact_phone,
        "latitude": profile.latitude,
        "longitude": profile.longitude,
        "gender": profile.gender,
        "resume": {
            "id": resume.id,
            "resume_id": resume.vector_doc_id,
            "filename": resume.filename,
            "uploaded_at": resume.uploaded_at.isoformat(),
        } if resume else None,
        "updated_at": profile.updated_at.isoformat(),
        "linkedin_verified": bool(verified),
        "linkedin_verified_at": verified.get("at") if isinstance(verified, dict) else None,
    }


@router.get("")
def get_profile(candidate: str = Depends(get_current_candidate)):
    """ONE round trip: profile + its resume + project count (the candidate id
    comes from the auth principal cache). Used by every student page shell."""
    from sqlalchemy import func, select as sa_select
    from ..db import StudentProject
    from ..auth import cached_candidate

    cid = cached_candidate(candidate).id
    n_projects = sa_select(func.count(StudentProject.id)).where(StudentProject.candidate_id == cid).scalar_subquery()
    with Session(engine) as session:
        row = session.execute(sa_select(CandidateProfile, Resume, n_projects)
                              .outerjoin(Resume, Resume.id == CandidateProfile.resume_id)
                              .where(CandidateProfile.candidate_id == cid)).first()
        if row is None:
            profile = _get_or_create_profile(session, cid)
            return _profile_to_dict(profile, None, 0)
        return _profile_to_dict(row[0], row[1], int(row[2] or 0))


def _project_count(session: Session, candidate_id: int) -> int:
    from ..db import StudentProject
    return len(session.exec(select(StudentProject.id).where(StudentProject.candidate_id == candidate_id)).all())


@router.post("/resume")
def upload_profile_resume(file: UploadFile = File(...), candidate: str = Depends(get_current_candidate)):
    """
    Upload/replace the resume on the candidate's profile. The frontend has
    called this endpoint since the Profile page was built, but it never
    actually existed - reuses the same extraction/dedup/vector-indexing
    pipeline as every other resume upload path in this app.
    """
    _, _, _, resume_db_id = save_and_index_resume(file)

    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)
        profile.resume_id = resume_db_id
        profile.updated_at = utc_now()
        session.add(profile)
        session.commit()

        resume = session.get(Resume, resume_db_id)
        return _profile_to_dict(profile, resume)

@router.post("/project")
def upload_profile_project(
    description: str = Form(...),
    file: Optional[UploadFile] = File(None),
    candidate: str = Depends(get_current_candidate)
):
    project_texts = []
    
    if file:
        ext = os.path.splitext(file.filename)[1].lower()
        fd, temp_path = tempfile.mkstemp(suffix=ext)
        try:
            with os.fdopen(fd, 'wb') as f:
                shutil.copyfileobj(file.file, f)
            text, _ = route_file(temp_path)
            if text:
                project_texts.append(text)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
                
    result = evaluate_profile_project(description, project_texts)
    
    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)
        profile.project_description = description
        profile.project_summary = result.get("project_summary", "Evaluation failed.")
        profile.project_general_score = result.get("project_general_score", 0)
        profile.updated_at = utc_now()
        session.add(profile)
        session.commit()
        
        resume = session.get(Resume, profile.resume_id) if profile.resume_id else None
        return _profile_to_dict(profile, resume)


@router.put("")
def update_profile(update: ProfileUpdate, candidate: str = Depends(get_current_candidate)):
    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)
        previous_contact_email = (profile.contact_email or "").strip().lower()

        if update.headline is not None:
            profile.headline = update.headline
        if update.bio is not None:
            profile.bio = update.bio
        if update.branch is not None:
            profile.branch = update.branch
        if update.skills is not None:
            profile.skills_json = json.dumps(update.skills)
        if update.experience is not None:
            profile.experience_json = json.dumps(update.experience)
        if update.education is not None:
            profile.education_json = json.dumps(update.education)
        if update.contact_email is not None:
            profile.contact_email = update.contact_email
        if update.contact_phone is not None:
            profile.contact_phone = update.contact_phone
        if update.latitude is not None:
            profile.latitude = update.latitude
        if update.longitude is not None:
            profile.longitude = update.longitude
        if update.gender is not None:
            profile.gender = update.gender
        for k in _V2_SCALARS:
            v = getattr(update, k)
            if v is not None:
                setattr(profile, k, v.strip() if isinstance(v, str) else v)
        if update.linkedin_url is not None:
            profile.linkedin_url = normalize_linkedin_url(update.linkedin_url)
        previous_prefs = _j(profile.preferences_json, {})
        prev_meta = previous_prefs.get(_COLLEGE_META_KEY)
        prev_linkedin_verified = previous_prefs.get("linkedin_verified")
        for k, (col, _d) in _V2_JSON.items():
            v = getattr(update, k)
            if v is not None:
                if k == "preferences" and isinstance(v, dict):
                    v = {key: value for key, value in v.items() if key != "linkedin_verified"}
                setattr(profile, col, json.dumps(v))
        # Keep college metadata across preference rewrites; replace/clear it when asked.
        prefs = _j(profile.preferences_json, {})
        if not isinstance(prefs, dict):
            prefs = {}
        verified = prev_linkedin_verified
        prefs.pop(_COLLEGE_META_KEY, None)
        if update.college_meta is not None:
            meta = _clean_college_meta(update.college_meta, profile.college)
        elif update.college is not None and isinstance(prev_meta, dict) and \
                (prev_meta.get("name") or "").strip().lower() != (profile.college or "").strip().lower():
            meta = None  # college typed as free text → drop the old logo metadata
        else:
            meta = prev_meta if isinstance(prev_meta, dict) else None
        if meta:
            prefs[_COLLEGE_META_KEY] = meta
        if verified:
            prefs["linkedin_verified"] = verified
        if prefs or profile.preferences_json:
            profile.preferences_json = json.dumps(prefs)

        profile.updated_at = utc_now()
        session.add(profile)
        session.commit()
        session.refresh(profile)
        # Welcome email the first time a contact email is set (or when it changes).
        new_contact_email = (profile.contact_email or "").strip()
        if new_contact_email and new_contact_email.lower() != previous_contact_email:
            try:
                display_name = getattr(profile, "full_name", None) or None
                subject, text, html = email_templates.welcome(display_name)
                queue_email(new_contact_email, subject, text, html=html, category="welcome")
            except Exception as e:
                logger.warning("Failed to queue welcome email: %s", e)

        resume = session.get(Resume, profile.resume_id) if profile.resume_id else None
        return _profile_to_dict(profile, resume, _project_count(session, user.id))

@router.post("/linkedin-import")
async def linkedin_import(file: UploadFile = File(...), candidate: str = Depends(get_current_candidate)):
    data = await file.read()
    if len(data) > 5 * 1024 * 1024 or not data.startswith(b"%PDF"):
        raise HTTPException(400, "Upload a PDF file smaller than 5 MB")
    fd, path = tempfile.mkstemp(suffix=".pdf")
    try:
        with os.fdopen(fd, "wb") as f: f.write(data)
        from ..services.extract import extract_text_from_file
        return parse_linkedin_text(extract_text_from_file(path) or "")
    except Exception:
        return parse_linkedin_text("")
    finally:
        if os.path.exists(path): os.remove(path)


@router.post("/project-upload")
def upload_candidate_project(
    file: UploadFile = File(...),
    description: str = Form(""),
    candidate: str = Depends(get_current_candidate),
):
    """
    Candidate project upload endpoint.
    Accepts multipart: file (PDF, DOCX, ZIP, code, text) + description.
    Parses file, generates technical summary with Gemini, updates CandidateProfile,
    and ensures candidate_status is set to 'applied'.
    """
    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)

        # 1. Save uploaded file to temp
        suffix = os.path.splitext(file.filename or "")[1] or ".bin"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name

        try:
            # 2. Parse file using project_parsers
            from ..services.project_parsers import parse_project_file
            content = parse_project_file(tmp_path)

            # 3. Generate summary using Groq -> Gemini -> fallback
            summary = ""
            groq_raw = os.environ.get("GROQ_API_KEY", "")
            if groq_raw:
                try:
                    from groq import Groq
                    gc = Groq(api_key=groq_raw.split(",")[0].strip(), timeout=10.0)
                    resp = gc.chat.completions.create(
                        model=os.environ.get("GROQ_MODEL", "qwen/qwen3.8-27b"),
                        messages=[{"role": "user", "content": f"You are a senior engineering reviewer. Summarize this candidate project in 2-3 paragraphs. Highlight domain, technologies, architecture, and complexity.\n\nDescription: {description}\n\nContent:\n{content[:6000]}"}],
                        max_tokens=500
                    )
                    summary = (resp.choices[0].message.content or "").strip()
                except Exception as g_err:
                    logger.warning(f"Groq summary generation failed: {g_err}")

            if not summary:
                from ..services.gemini_client import GeminiClient
                gemini_key = os.environ.get("GEMINI_API_KEY", "").split(",")[0].strip()
                g_client = GeminiClient(gemini_key)
                summary = g_client.generate_project_summary(content, description)

            # 4. Store on candidate profile
            profile.project_description = description
            profile.project_summary = summary
            profile.candidate_status = "applied"
            profile.updated_at = utc_now()
            session.add(profile)

            # 5. Set candidate_status = applied on active applications
            apps = session.exec(select(Application).where(Application.candidate_id == user.id)).all()
            for app in apps:
                if not app.candidate_status or app.candidate_status == "applied":
                    app.candidate_status = "applied"
                if not app.project_summary:
                    app.project_summary = summary
                session.add(app)

            session.commit()
            session.refresh(profile)

            # 6. Audit event
            from ..services.audit import record_audit_event
            record_audit_event(
                session=session,
                event_type="candidate_project_upload",
                candidate_id=user.id,
                final_recommendation=f"Candidate uploaded project portfolio file {file.filename}: {description[:100]}",
            )

            return {
                "message": "Project uploaded successfully",
                "filename": file.filename,
                "candidate_status": "applied",
            }
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass


@router.get("/status")
def get_candidate_status(
    candidate: str = Depends(get_current_candidate),
):
    """
    Candidate simplified status endpoint.
    Returns ONLY the simplified enum (applied, shortlisted, not_selected, interview, final_result).
    Never returns numbers, scores, logs, analysis text, or 'ATS' / 'verification' terminology.
    """
    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        app = session.exec(
            select(Application)
            .where(Application.candidate_id == user.id)
            .order_by(Application.applied_at.desc())
        ).first()

        status = "applied"
        if app and app.candidate_status:
            status = app.candidate_status
        else:
            profile = session.exec(
                select(CandidateProfile).where(CandidateProfile.candidate_id == user.id)
            ).first()
            if profile and profile.candidate_status:
                status = profile.candidate_status

        allowed = {"applied", "shortlisted", "not_selected", "interview", "final_result"}
        if status not in allowed:
            status = "applied"

        return {"status": status}


# ────── Education Management ──────

@router.put("/education")
def update_candidate_education(
    education_list: List[dict],
    candidate: str = Depends(get_current_candidate),
):
    """
    Replace the full education list. Each entry should have:
    { level: "school" | "pu" | "degree" | "pg",
      institution: string,
      field_of_study: string (optional),
      start_year: string (optional),
      end_year: string (optional),
      grade: string (optional) }
    """
    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)
        profile.education_json = json.dumps(education_list)
        profile.updated_at = utc_now()
        session.add(profile)
        session.commit()
        session.refresh(profile)
        resume = session.get(Resume, profile.resume_id) if profile.resume_id else None
        return _profile_to_dict(profile, resume)


# ────── Certifications Management ──────

@router.post("/certifications")
def add_candidate_certification(
    name: str = Form(...),
    issuing_organization: str = Form(...),
    issue_date: Optional[str] = Form(None),
    credential_url: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    candidate: str = Depends(get_current_candidate),
):
    """
    Add a certification entry with optional file upload (PDF, PNG, JPG, etc).
    Returns updated profile with certifications list.
    """
    cert_file_path = None
    if file:
        try:
            cert_file_path = validate_and_save_cert_file(file)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to upload certification file: {str(e)}")

    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)

        certifications = json.loads(profile.certifications_json)
        new_cert = {
            "name": name.strip(),
            "issuing_organization": issuing_organization.strip(),
            "issue_date": issue_date,
            "credential_url": credential_url,
            "file_path": cert_file_path,
        }
        certifications.append(new_cert)
        profile.certifications_json = json.dumps(certifications)
        profile.updated_at = utc_now()
        session.add(profile)
        session.commit()
        session.refresh(profile)
        resume = session.get(Resume, profile.resume_id) if profile.resume_id else None
        return _profile_to_dict(profile, resume)


@router.delete("/certifications/{cert_index}")
def delete_candidate_certification(
    cert_index: int = Path(..., ge=0),
    candidate: str = Depends(get_current_candidate),
):
    """
    Remove a certification entry by index and delete its associated file if present.
    """
    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)

        certifications = json.loads(profile.certifications_json)
        if cert_index < 0 or cert_index >= len(certifications):
            raise HTTPException(status_code=400, detail="Invalid certification index")

        cert = certifications[cert_index]
        if cert.get("file_path"):
            delete_media_file(cert["file_path"])

        certifications.pop(cert_index)
        profile.certifications_json = json.dumps(certifications)
        profile.updated_at = utc_now()
        session.add(profile)
        session.commit()
        session.refresh(profile)
        resume = session.get(Resume, profile.resume_id) if profile.resume_id else None
        return _profile_to_dict(profile, resume)


# ────── Avatar & Cover Photo Management ──────

@router.post("/avatar")
def upload_candidate_avatar(
    file: UploadFile = File(...),
    candidate: str = Depends(get_current_candidate),
):
    """Upload or replace candidate profile avatar photo."""
    rel_path = validate_and_save_image(file, "avatars")

    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)

        if profile.avatar_path and profile.avatar_path != rel_path:
            delete_media_file(profile.avatar_path)

        profile.avatar_path = rel_path
        profile.updated_at = utc_now()
        session.add(profile)
        session.commit()
        session.refresh(profile)
        resume = session.get(Resume, profile.resume_id) if profile.resume_id else None
        return _profile_to_dict(profile, resume)


@router.post("/cover-photo")
def upload_candidate_cover_photo(
    file: UploadFile = File(...),
    candidate: str = Depends(get_current_candidate),
):
    """Upload or replace candidate profile cover banner photo."""
    rel_path = validate_and_save_image(file, "covers")

    with Session(engine) as session:
        user = _get_candidate_user(session, candidate)
        profile = _get_or_create_profile(session, user.id)

        if profile.cover_photo_path and profile.cover_photo_path != rel_path:
            delete_media_file(profile.cover_photo_path)

        profile.cover_photo_path = rel_path
        profile.updated_at = utc_now()
        session.add(profile)
        session.commit()
        session.refresh(profile)
        resume = session.get(Resume, profile.resume_id) if profile.resume_id else None
        return _profile_to_dict(profile, resume)
