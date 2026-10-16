"""Live jobs & resources API.

Admin    /api/admin/live-sync[...]          trigger, status, settings, test a company id, moderate jobs
         /api/admin/live-resources[...]     CRUD for papers / videos / notes (PDF upload ≤10 MB)
Internal POST /api/internal/live-sync        cron trigger, header X-Sync-Token == LIVE_SYNC_TOKEN
Student  /api/student/external-jobs/{id}    detail + click/applied tracking
         /api/student/live-resources        fresh material per branch

Opportunities, saved jobs and the applications overview merge external
jobs in app/api/student_portal.py using the helpers at the bottom of this file.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import uuid
from datetime import timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field as PField
from sqlalchemy import or_
from sqlmodel import Session, select

from ..auth import get_current_admin, get_current_candidate
from ..db import (
    ExternalApplicationLog, ExternalJob, LiveResource, SavedExternalJob, SyncRun, engine, utc_now,
)
from ..services import live_sync
from ..services.audit import record_audit_event
from ..services.live_sources import PROVIDERS
from ..services.live_sources.base import https_on_domain

router = APIRouter(tags=["live_data"])

RESOURCE_KINDS = {"paper", "video", "article", "notes", "course"}
RESOURCE_BRANCHES = set(live_sync.CORE_BRANCHES) | {"all"}
MAX_PDF = 10 * 1024 * 1024
MAX_CLICKS_PER_JOB = 20


def _z(d):
    return d.replace(microsecond=0).isoformat() + "Z" if d else None


def _audit(admin: str, action: str, details: Optional[dict] = None):
    try:
        with Session(engine) as s:
            record_audit_event(s, event_type="admin_action", human_reviewer=admin, human_action=action,
                               raw_verdicts=details or None)
    except Exception:
        pass


# ── triggering ───────────────────────────────────────────────────────────────

class SyncBody(BaseModel):
    kind: str = PField(default="all", pattern="^(jobs|resources|all)$")


def _start(kind: str, who: str, background: BackgroundTasks) -> dict:
    if live_sync.is_running():
        return {"started": False, "running": True, "message": "A sync is already running — try again in a few minutes."}
    background.add_task(live_sync.run_sync_blocking, kind, who)
    settings = live_sync.load_settings()
    srcs = []
    for n in live_sync.sources_for(kind):
        p = PROVIDERS[n]
        state = "queued" if settings["enabled"].get(n, True) and p.configured(settings) else (
            "disabled" if not settings["enabled"].get(n, True) else "not configured")
        srcs.append({"source": n, "state": state})
    return {"started": True, "running": True, "kind": kind, "sources": srcs, "requested_at": _z(utc_now())}


@router.post("/api/admin/live-sync", status_code=202)
def admin_trigger(body: SyncBody, background: BackgroundTasks, admin: str = Depends(get_current_admin)):
    out = _start(body.kind, f"admin:{admin}", background)
    if out["started"]:
        _audit(admin, f"live_sync:{body.kind}")
    return out


@router.post("/api/internal/live-sync", status_code=202)
def internal_trigger(background: BackgroundTasks, body: Optional[SyncBody] = None,
                           x_sync_token: Optional[str] = Header(default=None)):
    expected = (os.environ.get("LIVE_SYNC_TOKEN") or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="LIVE_SYNC_TOKEN is not configured on the server")
    if not x_sync_token or not hmac.compare_digest(x_sync_token.strip().encode(), expected.encode()):
        raise HTTPException(status_code=403, detail="Invalid sync token")
    return _start((body.kind if body else "all"), "cron", background)


# ── admin status / settings ──────────────────────────────────────────────────

@router.get("/api/admin/live-sync/status")
def admin_status(history: int = Query(30, ge=1, le=100), admin: str = Depends(get_current_admin)):
    return live_sync.status_snapshot(history)


class SettingsBody(BaseModel):
    enabled: Optional[Dict[str, bool]] = None
    smartrecruiters_companies: Optional[List[str]] = PField(default=None, max_length=25)
    greenhouse_boards: Optional[List[str]] = PField(default=None, max_length=25)
    lever_boards: Optional[List[str]] = PField(default=None, max_length=25)


@router.get("/api/admin/live-sync/settings")
def get_settings(admin: str = Depends(get_current_admin)):
    return {"settings": live_sync.load_settings(), "sources": list(PROVIDERS)}


@router.put("/api/admin/live-sync/settings")
def put_settings(body: SettingsBody, admin: str = Depends(get_current_admin)):
    try:
        st = live_sync.save_settings(body.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    _audit(admin, "live_sync_settings", body.model_dump(exclude_unset=True))
    return {"settings": st}


class TestBody(BaseModel):
    provider: str = PField(pattern="^(smartrecruiters|greenhouse|lever)$")
    id: str = PField(min_length=1, max_length=80)


@router.post("/api/admin/live-sync/test-company")
async def test_company(body: TestBody, admin: str = Depends(get_current_admin)):
    try:
        return await live_sync.test_company(body.provider, body.id.strip())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _admin_job(e: ExternalJob) -> dict:
    return {"id": e.id, "source": e.source, "source_label": PROVIDERS[e.source].source_label(e.company_name) if e.source in PROVIDERS else e.source,
            "external_id": e.external_id, "title": e.title, "company": e.company_name, "location": e.location_text,
            "branch": e.branch, "status": e.status, "apply_url": e.apply_url, "posted_at": _z(e.posted_at),
            "last_seen_at": _z(e.last_seen_at), "last_checked_at": _z(e.last_checked_at), "miss_count": e.miss_count}


@router.get("/api/admin/live-sync/jobs")
def admin_jobs(status: str = Query("active", pattern="^(active|expired|hidden|all)$"), source: Optional[str] = Query(None, max_length=30),
                     q: Optional[str] = Query(None, max_length=120), page: int = Query(1, ge=1, le=500),
                     page_size: int = Query(20, ge=1, le=100), admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        stmt = select(ExternalJob)
        if status != "all":
            stmt = stmt.where(ExternalJob.status == status)
        if source:
            stmt = stmt.where(ExternalJob.source == source)
        if q:
            like = f"%{q.strip()}%"
            stmt = stmt.where(or_(ExternalJob.title.ilike(like), ExternalJob.company_name.ilike(like)))
        rows = s.exec(stmt.order_by(ExternalJob.posted_at.desc(), ExternalJob.id.desc())).all()
        total = len(rows)
        start = (page - 1) * page_size
        return {"items": [_admin_job(e) for e in rows[start:start + page_size]], "total": total, "page": page,
                "pages": max(1, -(-total // page_size)), "page_size": page_size}


class JobStatusBody(BaseModel):
    status: str = PField(pattern="^(active|hidden)$")


@router.patch("/api/admin/live-sync/jobs/{job_id}")
def admin_job_status(job_id: int, body: JobStatusBody, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        e = s.get(ExternalJob, job_id)
        if not e:
            raise HTTPException(status_code=404, detail="Job not found")
        if body.status == "active" and e.status == "expired":
            raise HTTPException(status_code=409, detail="Expired listings come back only when the source lists them again")
        e.status = body.status
        s.add(e)
        s.commit()
        s.refresh(e)
        out = _admin_job(e)
    _audit(admin, f"external_job_{body.status}:{job_id}")
    return out


# ── admin resources ──────────────────────────────────────────────────────────

def _res(r: LiveResource) -> dict:
    return {"id": r.id, "branch": r.branch, "kind": r.kind, "title": r.title, "url": r.url,
            "file_url": f"/media/{r.media_path}" if r.media_path else None, "source": r.source,
            "source_label": {"arxiv": "arXiv", "youtube": "YouTube", "admin": "CoreLink notes"}.get(r.source, r.source),
            "author": r.author, "summary": r.summary, "thumbnail_url": r.thumbnail_url, "published_at": _z(r.published_at),
            "created_at": _z(r.created_at), "created_by": r.created_by if r.source == "admin" else None, "status": r.status}


@router.get("/api/admin/live-resources")
def admin_resources(branch: Optional[str] = Query(None, max_length=20), kind: Optional[str] = Query(None, max_length=20),
                          source: Optional[str] = Query(None, max_length=20), status: str = Query("all", pattern="^(active|hidden|all)$"),
                          q: Optional[str] = Query(None, max_length=120), page: int = Query(1, ge=1, le=500),
                          page_size: int = Query(20, ge=1, le=100), admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        stmt = select(LiveResource)
        if branch:
            stmt = stmt.where(LiveResource.branch == branch)
        if kind:
            stmt = stmt.where(LiveResource.kind == kind)
        if source:
            stmt = stmt.where(LiveResource.source == source)
        if status != "all":
            stmt = stmt.where(LiveResource.status == status)
        if q:
            stmt = stmt.where(LiveResource.title.ilike(f"%{q.strip()}%"))
        rows = s.exec(stmt.order_by(LiveResource.created_at.desc(), LiveResource.id.desc())).all()
        total = len(rows)
        start = (page - 1) * page_size
        return {"items": [_res(r) for r in rows[start:start + page_size]], "total": total, "page": page,
                "pages": max(1, -(-total // page_size)), "page_size": page_size}


def _check_meta(branch: str, kind: str, title: str):
    if branch not in RESOURCE_BRANCHES:
        raise HTTPException(status_code=422, detail="Choose one of the 8 core branches (or all)")
    if kind not in RESOURCE_KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of {', '.join(sorted(RESOURCE_KINDS))}")
    if len((title or "").strip()) < 3:
        raise HTTPException(status_code=422, detail="Title must be at least 3 characters")


class ResourceIn(BaseModel):
    branch: str = PField(max_length=20)
    kind: str = PField(max_length=20)
    title: str = PField(max_length=300)
    url: str = PField(max_length=1000)
    author: Optional[str] = PField(default=None, max_length=200)
    summary: Optional[str] = PField(default=None, max_length=1000)


@router.post("/api/admin/live-resources", status_code=201)
def admin_add_resource(body: ResourceIn, admin: str = Depends(get_current_admin)):
    _check_meta(body.branch, body.kind, body.title)
    url = body.url.strip()
    if not re.match(r"^https://[^\s/]+\.[^\s/]+", url):
        raise HTTPException(status_code=422, detail="Link must be a full https:// URL")
    with Session(engine) as s:
        if s.exec(select(LiveResource).where(LiveResource.source == "admin", LiveResource.url == url)).first():
            raise HTTPException(status_code=409, detail="This link is already in the library")
        r = LiveResource(branch=body.branch, kind=body.kind, title=body.title.strip(), url=url, source="admin",
                         author=(body.author or "").strip() or None, summary=(body.summary or "").strip() or None,
                         published_at=utc_now(), created_by=admin)
        s.add(r)
        s.commit()
        s.refresh(r)
        out = _res(r)
    _audit(admin, f"live_resource_add:{out['id']}")
    return out


@router.post("/api/admin/live-resources/upload", status_code=201)
async def admin_upload_resource(file: UploadFile = File(...), branch: str = Form(...), kind: str = Form("notes"),
                                title: str = Form(...), author: Optional[str] = Form(None), summary: Optional[str] = Form(None),
                                admin: str = Depends(get_current_admin)):
    from ..services.media_utils import MEDIA_DIR, mirror_to_db

    _check_meta(branch, kind, title)
    name = os.path.basename(file.filename or "")
    if os.path.splitext(name)[1].lower() != ".pdf":
        raise HTTPException(status_code=400, detail="Only PDF files can be uploaded")
    data = await file.read(MAX_PDF + 1)
    if not data:
        raise HTTPException(status_code=400, detail="Empty file uploaded")
    if len(data) > MAX_PDF:
        raise HTTPException(status_code=400, detail="PDF too large (max 10 MB)")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="File content is not a valid PDF")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name)[-60:] or "notes.pdf"
    rel = f"resources/{uuid.uuid4().hex[:12]}_{safe}"
    dest = os.path.join(MEDIA_DIR, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(data)
    mirror_to_db(rel, dest)
    with Session(engine) as s:
        r = LiveResource(branch=branch, kind=kind, title=title.strip()[:300], media_path=rel, source="admin",
                         author=(author or "").strip()[:200] or None, summary=(summary or "").strip()[:1000] or None,
                         published_at=utc_now(), created_by=admin)
        s.add(r)
        s.commit()
        s.refresh(r)
        out = _res(r)
    _audit(admin, f"live_resource_upload:{out['id']}")
    return out


class ResourcePatch(BaseModel):
    status: Optional[str] = PField(default=None, pattern="^(active|hidden)$")
    title: Optional[str] = PField(default=None, max_length=300)
    summary: Optional[str] = PField(default=None, max_length=1000)
    branch: Optional[str] = PField(default=None, max_length=20)
    kind: Optional[str] = PField(default=None, max_length=20)


@router.patch("/api/admin/live-resources/{rid}")
def admin_patch_resource(rid: int, body: ResourcePatch, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        r = s.get(LiveResource, rid)
        if not r:
            raise HTTPException(status_code=404, detail="Resource not found")
        ch = body.model_dump(exclude_unset=True)
        _check_meta(ch.get("branch", r.branch), ch.get("kind", r.kind), ch.get("title", r.title))
        for k, v in ch.items():
            if v is not None:
                setattr(r, k, v.strip() if isinstance(v, str) else v)
        s.add(r)
        s.commit()
        s.refresh(r)
        out = _res(r)
    _audit(admin, f"live_resource_update:{rid}", body.model_dump(exclude_unset=True))
    return out


@router.delete("/api/admin/live-resources/{rid}")
def admin_delete_resource(rid: int, admin: str = Depends(get_current_admin)):
    from ..services.media_utils import delete_media_file

    with Session(engine) as s:
        r = s.get(LiveResource, rid)
        if not r:
            raise HTTPException(status_code=404, detail="Resource not found")
        path = r.media_path
        s.delete(r)
        s.commit()
    if path:
        delete_media_file(path)
    _audit(admin, f"live_resource_delete:{rid}")
    return {"deleted": True, "id": rid}


# ── student ──────────────────────────────────────────────────────────────────

def visible_jobs_stmt():
    cutoff = utc_now() - timedelta(days=live_sync.MAX_AGE_DAYS)
    return (select(ExternalJob)
            .where(ExternalJob.status == "active")
            .where(or_(ExternalJob.posted_at == None, ExternalJob.posted_at >= cutoff))  # noqa: E711
            .order_by(ExternalJob.posted_at.desc()))


def best_per_key(rows: List[ExternalJob]) -> List[ExternalJob]:
    """Collapse the same job listed by several sources (official board wins)."""
    best: Dict[str, ExternalJob] = {}
    for e in rows:
        k = e.dedupe_key or f"{e.source}:{e.external_id}"
        cur = best.get(k)
        if cur is None or (live_sync._prio(e.source), e.id) < (live_sync._prio(cur.source), cur.id):
            best[k] = e
    keep = {id(v) for v in best.values()}
    return [e for e in rows if id(e) in keep]


def student_state(session: Session, cid: int):
    """→ (saved ext ids, applied {ext_id: created_at}, last click {ext_id: created_at})."""
    saved = {r.external_job_id for r in session.exec(select(SavedExternalJob).where(SavedExternalJob.candidate_id == cid)).all()}
    applied, clicked = {}, {}
    for r in session.exec(select(ExternalApplicationLog).where(ExternalApplicationLog.candidate_id == cid)).all():
        target = applied if r.action == "applied" else clicked
        if r.external_job_id not in target or r.created_at > target[r.external_job_id]:
            target[r.external_job_id] = r.created_at
    return saved, applied, clicked


def external_card(e: ExternalJob, *, pskills: List[str], pbranch: Optional[str], saved: bool, applied_at=None) -> dict:
    from .student_portal import BRANCH_LABELS

    skills = []
    try:
        skills = [str(x) for x in json.loads(e.skills_json or "[]")][:12]
    except ValueError:
        pass
    ps = {s.lower() for s in pskills}
    same = 1.0 if (pbranch and e.branch == pbranch) else 0.0
    overlap = (sum(1 for s in skills if s.lower() in ps) / len(skills)) if skills else 0.0
    raw = (0.7 * overlap + 0.3 * same) if skills else (0.2 + 0.6 * same)
    posted = e.posted_at or e.first_seen_at
    label = PROVIDERS[e.source].source_label(e.company_name) if e.source in PROVIDERS else e.source
    from ..services.company_directory import card_meta, slug_for_external
    return {
        **card_meta(slug_for_external(e)),
        "id": f"ext-{e.id}", "external": True, "external_job_id": e.id, "title": e.title, "company": e.company_name,
        "company_logo": None, "location": e.location_text or "", "branch": e.branch, "branch_label": BRANCH_LABELS.get(e.branch or "", ""),
        "job_type": e.job_type, "remote_type": e.remote_type, "experience_level": e.experience_level,
        "salary_min": e.salary_min, "salary_max": e.salary_max, "currency": "INR", "skills": skills,
        "snippet": (e.description_text or "")[:220], "posted_at": _z(posted),
        "days_ago": max(0, (utc_now() - posted).days) if posted else None, "openings": None,
        "status": "open" if e.status == "active" else e.status, "match": int(max(0, min(99, round(raw * 100)))),
        "match_source": "skills", "saved": saved, "applied": applied_at is not None, "applied_at": _z(applied_at),
        "application_id": None, "apply_url": e.apply_url, "posting_url": e.posting_url, "source": e.source,
        "source_label": label, "last_checked_at": _z(e.last_checked_at),
    }


def _ext_or_404(session: Session, ext_id: int, cid: int, *, allow_inactive_for_owner: bool = True) -> ExternalJob:
    e = session.get(ExternalJob, ext_id)
    if e and e.status == "active":
        return e
    if e and allow_inactive_for_owner and e.status == "expired":
        # Students who saved / applied keep seeing the record (marked expired, no apply link).
        has = session.exec(select(SavedExternalJob.id).where(SavedExternalJob.candidate_id == cid, SavedExternalJob.external_job_id == ext_id)).first() \
            or session.exec(select(ExternalApplicationLog.id).where(ExternalApplicationLog.candidate_id == cid, ExternalApplicationLog.external_job_id == ext_id)).first()
        if has:
            return e
    raise HTTPException(status_code=404, detail="This listing has expired or was removed")


@router.get("/api/student/external-jobs/{ext_id}")
def external_job_detail(ext_id: int, candidate: str = Depends(get_current_candidate)):
    from .student_portal import _candidate_context, branch_id, profile_skills

    with Session(engine) as s:
        user, profile, _apps, _saved = _candidate_context(s, candidate)
        e = _ext_or_404(s, ext_id, user.id)
        saved, applied, clicked = student_state(s, user.id)
        card = external_card(e, pskills=profile_skills(profile), pbranch=branch_id(profile.branch), saved=e.id in saved, applied_at=applied.get(e.id))
        ps = {x.lower() for x in profile_skills(profile)}
        card.update({
            "description": e.description_text or "", "skills_have": [x for x in card["skills"] if x.lower() in ps],
            "skills_missing": [x for x in card["skills"] if x.lower() not in ps], "has_resume": bool(profile.resume_id),
            "clicked_at": _z(clicked.get(e.id)), "first_seen_at": _z(e.first_seen_at),
            "expired": e.status != "active",
        })
        if e.status != "active":
            card["apply_url"] = None
        return card


class TrackBody(BaseModel):
    action: str = PField(pattern="^(clicked|applied|not_applied)$")


@router.post("/api/student/external-jobs/{ext_id}/track")
def track_external(ext_id: int, body: TrackBody, candidate: str = Depends(get_current_candidate)):
    from .student_portal import _user

    with Session(engine) as s:
        user = _user(s, candidate)
        e = _ext_or_404(s, ext_id, user.id, allow_inactive_for_owner=body.action == "not_applied")
        logs = s.exec(select(ExternalApplicationLog).where(ExternalApplicationLog.candidate_id == user.id,
                                                          ExternalApplicationLog.external_job_id == ext_id)).all()
        if body.action == "clicked":
            clicks = [l for l in logs if l.action == "clicked"]
            if len(clicks) < MAX_CLICKS_PER_JOB:
                s.add(ExternalApplicationLog(candidate_id=user.id, external_job_id=ext_id, action="clicked"))
        elif body.action == "applied":
            if not any(l.action == "applied" for l in logs):
                s.add(ExternalApplicationLog(candidate_id=user.id, external_job_id=ext_id, action="applied"))
        else:
            for l in logs:
                if l.action == "applied":
                    s.delete(l)
        s.commit()
        applied = s.exec(select(ExternalApplicationLog).where(ExternalApplicationLog.candidate_id == user.id,
                                                             ExternalApplicationLog.external_job_id == ext_id,
                                                             ExternalApplicationLog.action == "applied")).first()
        return {"ok": True, "external_job_id": e.id, "action": body.action, "applied": applied is not None,
                "applied_at": _z(applied.created_at) if applied else None}


@router.get("/api/student/live-resources")
def student_live_resources(branch: Optional[str] = Query(None, max_length=40), kind: Optional[str] = Query(None, max_length=20),
                                 q: Optional[str] = Query(None, max_length=120), limit: int = Query(12, ge=1, le=60),
                                 candidate: str = Depends(get_current_candidate)):
    from .student_portal import _candidate_context, branch_id

    with Session(engine) as s:
        _user_row, profile, _a, _b = _candidate_context(s, candidate)
        b = branch_id(branch) if branch and branch not in {"all", "any"} else (None if branch in {"all", "any"} else branch_id(profile.branch))
        stmt = select(LiveResource).where(LiveResource.status == "active")
        if b:
            stmt = stmt.where(or_(LiveResource.branch == b, LiveResource.branch == "all"))
        if kind:
            if kind not in RESOURCE_KINDS:
                raise HTTPException(status_code=422, detail="Unknown kind")
            stmt = stmt.where(LiveResource.kind == kind)
        if q:
            like = f"%{q.strip()}%"
            stmt = stmt.where(or_(LiveResource.title.ilike(like), LiveResource.summary.ilike(like), LiveResource.author.ilike(like)))
        rows = s.exec(stmt.order_by(LiveResource.published_at.desc(), LiveResource.id.desc()).limit(300)).all()
        # Interleave kinds so one source can't crowd out the others.
        by_kind: Dict[str, List[LiveResource]] = {}
        for r in rows:
            by_kind.setdefault(r.kind, []).append(r)
        mixed: List[LiveResource] = []
        order = ["notes", "paper", "video", "article", "course"] + [k for k in by_kind if k not in RESOURCE_KINDS]
        while len(mixed) < min(limit, len(rows)) and any(by_kind.values()):
            for k in order:
                if by_kind.get(k):
                    mixed.append(by_kind[k].pop(0))
        counts: Dict[str, int] = {}
        for r in rows:
            counts[r.kind] = counts.get(r.kind, 0) + 1
        last = s.exec(select(SyncRun).where(SyncRun.kind == "resources", SyncRun.status.in_(["ok", "partial"]))
                      .order_by(SyncRun.finished_at.desc())).first()
        return {"branch": b, "items": [_res(r) | {"created_by": None} for r in mixed[:limit]], "total": len(rows),
                "counts": counts, "last_synced_at": _z(last.finished_at) if last else None}
