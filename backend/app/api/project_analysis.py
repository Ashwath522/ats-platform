"""Project evidence & analysis API: files, demo-video frames, analysis jobs, reports.

Students manage their own projects; admins see everything (and still make the
final verification decision); recruiters get a reduced, safe view.
"""
from __future__ import annotations

import json
import re
import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlmodel import Session, select

from ..auth import get_current_admin, get_current_candidate
from ..db import CandidateProfile, CandidateUser, ProjectAnalysisJob, ProjectFile, ProjectVideoEvidence, StudentProject, engine
from ..rate_limit import limiter
from ..services import precompute
from ..services.media_utils import delete_media_file
from ..services.project_analysis import files as pf
from ..services.project_analysis import jobs
from ..services.project_analysis.domains import DOMAIN_MAP, domain_list

router = APIRouter(tags=["project_analysis"])

FRAME_MAX = 12
FRAME_BYTES = 200 * 1024
TS_RE = re.compile(r"^\d{1,3}:\d{2}$")


def _owned(s: Session, pid: int, candidate: str) -> StudentProject:
    user = s.exec(select(CandidateUser).where(CandidateUser.username == candidate)).first()
    p = s.get(StudentProject, pid)
    if not user or not p or p.candidate_id != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


def _file_dict(f: ProjectFile) -> dict:
    return {"id": f.id, "filename": f.filename, "ext": f.ext, "kind": f.kind, "size_bytes": f.size_bytes,
            "sha256": f.sha256, "created_at": f.created_at.isoformat() + "Z"}


def migrate_legacy_attachment(s: Session, p: StudentProject) -> None:
    """Older projects had one attachment in StudentProject.file_path — expose it as a ProjectFile once."""
    if not p.file_path or s.exec(select(ProjectFile.id).where(ProjectFile.project_id == p.id)).first():
        return
    data = pf.read_bytes(p.file_path)
    if not data:
        return
    name = re.sub(r"^[0-9a-f]{32}_", "", p.file_path.rsplit("/", 1)[-1])
    ext = pf.file_ext(name)
    s.add(ProjectFile(project_id=p.id, candidate_id=p.candidate_id, filename=name, ext=ext, mime="application/octet-stream",
                      size_bytes=len(data), sha256=pf.sha256(data), media_path=p.file_path, kind=pf.kind_of(ext)))
    s.commit()


# ── student: domains & files ─────────────────────────────────────────────────

@router.get("/api/student/project-domains")
def project_domains(candidate: str = Depends(get_current_candidate)):
    return {"domains": domain_list(), "limits": {"files": pf.MAX_FILES, "file_mb": pf.MAX_FILE_BYTES // 2**20, "total_mb": pf.MAX_TOTAL_BYTES // 2**20}}


@router.get("/api/student/projects/{pid}/files")
def list_files(pid: int, candidate: str = Depends(get_current_candidate)):
    with Session(engine) as s:
        p = _owned(s, pid, candidate)
        migrate_legacy_attachment(s, p)
        rows = s.exec(select(ProjectFile).where(ProjectFile.project_id == pid).order_by(ProjectFile.id)).all()
        frames = s.exec(select(ProjectVideoEvidence).where(ProjectVideoEvidence.project_id == pid).order_by(ProjectVideoEvidence.timestamp)).all()
        return {"files": [_file_dict(f) for f in rows], "frames": [{"id": f.id, "timestamp": f.timestamp} for f in frames]}


@router.post("/api/student/projects/{pid}/files")
@limiter.limit("60/hour")
def add_file(request: Request, pid: int, file: UploadFile = File(...), candidate: str = Depends(get_current_candidate)):
    data = file.file.read(pf.MAX_FILE_BYTES + 1)
    name = (file.filename or "file").replace("\\", "/").rsplit("/", 1)[-1][:120]
    ext = pf.validate_content(name, data)
    with Session(engine) as s:
        p = _owned(s, pid, candidate)
        rows = s.exec(select(ProjectFile).where(ProjectFile.project_id == pid)).all()
        digest = pf.sha256(data)
        same = next((r for r in rows if r.sha256 == digest), None)
        if same:
            return _file_dict(same) | {"duplicate": True}
        if len(rows) >= pf.MAX_FILES:
            raise HTTPException(status_code=400, detail=f"A project can have at most {pf.MAX_FILES} files")
        if sum(r.size_bytes for r in rows) + len(data) > pf.MAX_TOTAL_BYTES:
            raise HTTPException(status_code=400, detail="Project files can't exceed 60 MB in total")
        rel = pf.store_bytes("files", name, data)
        row = ProjectFile(project_id=pid, candidate_id=p.candidate_id, filename=name, ext=ext, mime=file.content_type or "application/octet-stream",
                          size_bytes=len(data), sha256=digest, media_path=rel, kind=pf.kind_of(ext))
        s.add(row)
        s.commit()
        s.refresh(row)
        return _file_dict(row)


@router.delete("/api/student/projects/{pid}/files/{fid}")
def delete_file(pid: int, fid: int, candidate: str = Depends(get_current_candidate)):
    with Session(engine) as s:
        p = _owned(s, pid, candidate)
        row = s.get(ProjectFile, fid)
        if not row or row.project_id != pid:
            raise HTTPException(status_code=404, detail="File not found")
        if row.media_path != p.file_path:
            delete_media_file(row.media_path)
        s.delete(row)
        s.commit()
        return {"deleted": True}


@router.post("/api/student/projects/{pid}/challenge-code")
def new_challenge_code(pid: int, candidate: str = Depends(get_current_candidate)):
    with Session(engine) as s:
        p = _owned(s, pid, candidate)
        p.challenge_code = f"{secrets.randbelow(9000) + 1000}"
        s.add(p)
        s.commit()
        return {"challenge_code": p.challenge_code}


@router.put("/api/student/projects/{pid}/video-frames")
@limiter.limit("20/hour")
def put_video_frames(request: Request, pid: int, frames: List[UploadFile] = File(...), timestamps: List[str] = Form(...),
                     candidate: str = Depends(get_current_candidate)):
    """Replace the key frames picked in the browser from a local demo video. The video itself is never uploaded."""
    if not frames or len(frames) > FRAME_MAX or len(frames) != len(timestamps):
        raise HTTPException(status_code=400, detail=f"Send 1–{FRAME_MAX} frames, each with a timestamp")
    blobs = []
    for f, ts in zip(frames, timestamps):
        data = f.file.read(FRAME_BYTES + 1)
        if len(data) > FRAME_BYTES or not data.startswith(b"\xff\xd8\xff"):
            raise HTTPException(status_code=400, detail="Each frame must be a JPEG of at most 200 KB")
        if not TS_RE.match(ts or ""):
            raise HTTPException(status_code=400, detail="Timestamps must look like mm:ss")
        blobs.append((ts, data))
    with Session(engine) as s:
        p = _owned(s, pid, candidate)
        for old in s.exec(select(ProjectVideoEvidence).where(ProjectVideoEvidence.project_id == pid)).all():
            if old.media_path:
                delete_media_file(old.media_path)
            s.delete(old)
        for ts, data in blobs:
            s.add(ProjectVideoEvidence(project_id=p.id, timestamp=ts.zfill(5), sha256=pf.sha256(data),
                                       media_path=pf.store_bytes("frames", f"frame_{ts.replace(':', '')}.jpg", data)))
        s.commit()
    return {"frames": len(blobs), "message": "Key frames saved. Your video itself was not uploaded."}


@router.delete("/api/student/projects/{pid}/video-frames")
def delete_video_frames(pid: int, candidate: str = Depends(get_current_candidate)):
    with Session(engine) as s:
        _owned(s, pid, candidate)
        rows = s.exec(select(ProjectVideoEvidence).where(ProjectVideoEvidence.project_id == pid)).all()
        for r in rows:
            if r.media_path:
                delete_media_file(r.media_path)
            s.delete(r)
        s.commit()
        return {"deleted": len(rows)}


# ── student: analysis ────────────────────────────────────────────────────────

def _start(p: StudentProject, force: bool = False) -> dict:
    from ..services.project_analysis.pipeline import run_job
    job, created = jobs.create_or_get(p, force=force)
    if created:
        precompute.submit(f"project-analysis:{job.id}", run_job, job.id)
        with Session(engine) as s:
            job = s.get(ProjectAnalysisJob, job.id)
    return jobs.public(job, include_result=False) | {"reused": not created}


@router.post("/api/student/projects/{pid}/analyse")
@limiter.limit("15/hour")
def analyse(request: Request, pid: int, candidate: str = Depends(get_current_candidate)):
    with Session(engine) as s:
        p = _owned(s, pid, candidate)
        migrate_legacy_attachment(s, p)
        if p.domain not in DOMAIN_MAP:
            raise HTTPException(status_code=400, detail="Choose the project's engineering domain first")
        has_files = s.exec(select(ProjectFile.id).where(ProjectFile.project_id == pid)).first()
        has_frames = s.exec(select(ProjectVideoEvidence.id).where(ProjectVideoEvidence.project_id == pid)).first()
        if not has_files and not p.video_url and not has_frames and len((p.description or "").strip()) < 30:
            raise HTTPException(status_code=400, detail="Add at least one file, a demo video or a description (30+ characters) first")
        s.expunge(p)
    return _start(p)


def _latest(s: Session, pid: int, history: bool = False):
    rows = s.exec(select(ProjectAnalysisJob).where(ProjectAnalysisJob.project_id == pid).order_by(ProjectAnalysisJob.id.desc()).limit(5)).all()
    if not rows:
        return None, []
    jobs.recover_stuck(s, rows[0])
    prev = [jobs.public(j, include_result=False) for j in rows[1:] if j.status == "done"] if history else []
    return rows[0], prev


@router.get("/api/student/projects/{pid}/analysis")
def get_analysis(pid: int, candidate: str = Depends(get_current_candidate)):
    with Session(engine) as s:
        p = _owned(s, pid, candidate)
        job, prev = _latest(s, pid, history=True)
        if not job:
            return {"status": "none"}
        out = jobs.public(job)
        if job.status != "done":   # keep showing the last finished report while a new one runs
            last_done = s.exec(select(ProjectAnalysisJob).where(ProjectAnalysisJob.project_id == pid, ProjectAnalysisJob.status == "done")
                               .order_by(ProjectAnalysisJob.id.desc())).first()
            out["previous_result"] = json.loads(last_done.result_json) if last_done and last_done.result_json else None
        out["history"] = prev
        out["stale"] = job.status == "done" and job.input_hash != jobs.input_hash(s, p)
        return out


@router.delete("/api/student/projects/{pid}/analysis")
def delete_analysis(pid: int, candidate: str = Depends(get_current_candidate)):
    with Session(engine) as s:
        _owned(s, pid, candidate)
        rows = s.exec(select(ProjectAnalysisJob).where(ProjectAnalysisJob.project_id == pid)).all()
        for r in rows:
            s.delete(r)
        s.commit()
        return {"deleted": len(rows)}


def _pdf(s: Session, p: StudentProject) -> Response:
    from ..services.project_analysis.pdf import render
    job = s.exec(select(ProjectAnalysisJob).where(ProjectAnalysisJob.project_id == p.id, ProjectAnalysisJob.status == "done")
                 .order_by(ProjectAnalysisJob.id.desc())).first()
    if not job or not job.result_json:
        raise HTTPException(status_code=404, detail="No finished analysis yet")
    prof = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == p.candidate_id)).first()
    data = render(json.loads(job.result_json), p.title, (prof.full_name if prof and prof.full_name else ""))
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", p.title)[:50] or "project"
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="CoreLink_{safe}_report.pdf"'})


@router.get("/api/student/projects/{pid}/analysis/report.pdf")
@limiter.limit("30/hour")
def student_pdf(request: Request, pid: int, candidate: str = Depends(get_current_candidate)):
    with Session(engine) as s:
        return _pdf(s, _owned(s, pid, candidate))


# ── admin ────────────────────────────────────────────────────────────────────

def _project_or_404(s: Session, pid: int) -> StudentProject:
    p = s.get(StudentProject, pid)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


def suggested_note(result: Optional[dict]) -> str:
    if not result:
        return ""
    sc = result.get("scores") or {}
    cl = result.get("claims") or []
    v = sum(1 for c in cl if c.get("status") == "verified")
    bad = [c["text"] for c in cl if c.get("status") == "contradicted"][:2]
    sugg = next((s for s in (result.get("report") or {}).get("sections", []) if s["id"] == "suggestions"), {}).get("items", [])
    note = f"Evidence score {sc.get('overall', '—')}/100 ({sc.get('coverage', 0)}% coverage); {v} of {len(cl)} claims verified."
    if bad:
        note += " Contradicted: " + "; ".join(bad) + "."
    if sugg:
        note += " Next: " + sugg[0]["text"]
    return note[:500]


@router.get("/api/admin/projects/{pid}/analysis")
def admin_analysis(pid: int, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        _project_or_404(s, pid)
        job, prev = _latest(s, pid, history=True)
        if not job:
            return {"status": "none"}
        out = jobs.public(job) | {"history": prev}
        out["suggested_note"] = suggested_note(out.get("result"))
        return out


@router.post("/api/admin/projects/{pid}/analysis/rerun")
def admin_rerun(pid: int, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        p = _project_or_404(s, pid)
        s.expunge(p)
    return _start(p, force=True)


@router.get("/api/admin/projects/{pid}/analysis/report.pdf")
def admin_pdf(pid: int, admin: str = Depends(get_current_admin)):
    with Session(engine) as s:
        return _pdf(s, _project_or_404(s, pid))


# ── shared helpers for other routers ────────────────────────────────────────

def recruiter_view(s: Session, project: StudentProject) -> Optional[dict]:
    """Safe projection for recruiters: no files, transcript, challenge code or internal warnings."""
    job = s.exec(select(ProjectAnalysisJob).where(ProjectAnalysisJob.project_id == project.id, ProjectAnalysisJob.status == "done")
                 .order_by(ProjectAnalysisJob.id.desc())).first()
    if not job or not job.result_json:
        return None
    r = json.loads(job.result_json)
    sections = [{k: v for k, v in sec.items() if k != "evidence"} for sec in (r.get("report") or {}).get("sections", []) if sec["id"] not in {"video"}]
    video = r.get("video") or {}
    return {
        "domain": project.domain, "verification_status": project.status, "analysed_at": job.finished_at.isoformat() + "Z" if job.finished_at else None,
        "scores": {k: r.get("scores", {}).get(k) for k in ("overall", "coverage", "dimensions")},
        "claims": [{k: c.get(k) for k in ("id", "text", "status", "reasoning", "evidence_ids")} for c in r.get("claims", [])],
        "evidence": [{k: e.get(k) for k in ("id", "source_type", "source_ref", "fact", "method", "confidence")}
                     for e in r.get("evidence", []) if e.get("method") not in {"student_claim", "transcript"}][:150],
        "report": {"sections": sections, "domain_label": (r.get("report") or {}).get("domain_label")},
        "video": {"analysed": bool(video), "segments": len(video.get("segments", [])), "code_found": video.get("challenge_code_found")} if video else None,
    }


def summary(s: Session, project_id: int) -> Optional[dict]:
    job = s.exec(select(ProjectAnalysisJob).where(ProjectAnalysisJob.project_id == project_id).order_by(ProjectAnalysisJob.id.desc())).first()
    if not job:
        return None
    r = json.loads(job.result_json) if job.result_json else {}
    cl = r.get("claims", [])
    return {"status": job.status, "progress": job.progress, "overall": (r.get("scores") or {}).get("overall"),
            "coverage": (r.get("scores") or {}).get("coverage"), "claims": len(cl),
            "verified": sum(1 for c in cl if c.get("status") == "verified"),
            "contradicted": sum(1 for c in cl if c.get("status") == "contradicted"), "suggested_note": suggested_note(r) if r else ""}
