"""Analysis job records: dedupe by input hash, progress, stuck-job recovery, limits."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import timedelta
from typing import List, Optional

from fastapi import HTTPException
from sqlmodel import Session, func, select

from ...db import ProjectAnalysisJob, ProjectFile, ProjectVideoEvidence, StudentProject, engine, utc_now
from .schemas import STAGE_LABELS, STAGES, StageStatus

STUCK_AFTER = timedelta(minutes=15)


def per_student_daily() -> int:
    try:
        return max(1, int(os.environ.get("PROJECT_ANALYSIS_MAX_PER_STUDENT_DAILY", "5")))
    except ValueError:
        return 5


def input_hash(session: Session, p: StudentProject) -> str:
    files = session.exec(select(ProjectFile.sha256).where(ProjectFile.project_id == p.id)).all()
    frames = session.exec(select(ProjectVideoEvidence.sha256).where(ProjectVideoEvidence.project_id == p.id)).all()
    raw = json.dumps({"f": sorted(files), "v": sorted(frames), "u": p.video_url, "d": p.description, "dom": p.domain, "t": p.title,
                      "l": p.links_json, "c": p.challenge_code, "ver": 2}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


def initial_stages() -> str:
    return json.dumps([StageStatus(name=n, label=STAGE_LABELS[n]).model_dump() for n in STAGES])


FRAME_RETENTION = timedelta(days=90)


def purge_old_frames(s: Session) -> int:
    """Demo-video key frames are deleted 90 days after upload (reports keep only text)."""
    from ..media_utils import delete_media_file
    old = s.exec(select(ProjectVideoEvidence).where(ProjectVideoEvidence.created_at < utc_now() - FRAME_RETENTION).limit(200)).all()
    for r in old:
        if r.media_path:
            delete_media_file(r.media_path)
        s.delete(r)
    if old:
        s.commit()
    return len(old)


def create_or_get(p: StudentProject, *, force: bool = False) -> tuple[ProjectAnalysisJob, bool]:
    """(job, created). Same inputs → the existing job (no duplicate analysis)."""
    with Session(engine) as s:
        purge_old_frames(s)
        digest = input_hash(s, p)
        if not force:
            old = s.exec(select(ProjectAnalysisJob).where(ProjectAnalysisJob.project_id == p.id, ProjectAnalysisJob.input_hash == digest)
                         .order_by(ProjectAnalysisJob.id.desc())).first()
            if old:
                recover_stuck(s, old)
            if old and old.status in {"queued", "running", "done"}:
                return old, False
            since = utc_now() - timedelta(days=1)
            n = s.exec(select(func.count(ProjectAnalysisJob.id)).where(ProjectAnalysisJob.candidate_id == p.candidate_id,
                                                                       ProjectAnalysisJob.created_at >= since)).one()
            if n >= per_student_daily():
                raise HTTPException(status_code=429, detail=f"You can run {per_student_daily()} analyses per day. Please try again tomorrow.")
        job = ProjectAnalysisJob(project_id=p.id, candidate_id=p.candidate_id, input_hash=digest, status="queued",
                                 stage=STAGES[0], stages_json=initial_stages())
        s.add(job)
        s.commit()
        s.refresh(job)
        return job, True


def set_stage(job_id: int, name: str, state: str, message: Optional[str] = None, progress: Optional[int] = None) -> None:
    with Session(engine) as s:
        j = s.get(ProjectAnalysisJob, job_id)
        if not j:
            return
        stages: List[dict] = json.loads(j.stages_json or "[]") or json.loads(initial_stages())
        now = utc_now().isoformat() + "Z"
        for st in stages:
            if st["name"] == name:
                st["state"] = state
                if message is not None:
                    st["message"] = message[:240]
                if state == "running":
                    st["started_at"] = now
                elif state in {"done", "skipped", "failed"}:
                    st["finished_at"] = now
        j.stages_json = json.dumps(stages)
        j.stage = name
        j.status = "failed" if state == "failed" else "running"
        if progress is not None:
            j.progress = progress
        j.updated_at = utc_now()
        s.add(j)
        s.commit()


def finish(job_id: int, result_json: str) -> None:
    with Session(engine) as s:
        j = s.get(ProjectAnalysisJob, job_id)
        if j:
            j.status, j.progress, j.result_json, j.finished_at, j.updated_at = "done", 100, result_json, utc_now(), utc_now()
            s.add(j)
            s.commit()


def fail(job_id: int, message: str) -> None:
    with Session(engine) as s:
        j = s.get(ProjectAnalysisJob, job_id)
        if j:
            j.status, j.error, j.finished_at, j.updated_at = "failed", message[:300], utc_now(), utc_now()
            s.add(j)
            s.commit()


def recover_stuck(session: Session, job: ProjectAnalysisJob) -> ProjectAnalysisJob:
    """A job left queued/running for 15+ min (server restarted) is marked failed so it can be re-run."""
    if job.status in {"queued", "running"} and job.updated_at and utc_now() - job.updated_at > STUCK_AFTER:
        job.status = "failed"
        job.error = "The analysis was interrupted (the server restarted). Press Analyse again."
        job.finished_at = utc_now()
        session.add(job)
        session.commit()
    return job


def public(job: ProjectAnalysisJob, *, include_result: bool = True) -> dict:
    return {"id": job.id, "status": job.status, "stage": job.stage, "progress": job.progress,
            "stages": json.loads(job.stages_json or "[]"), "error": job.error,
            "created_at": job.created_at.isoformat() + "Z" if job.created_at else None,
            "finished_at": job.finished_at.isoformat() + "Z" if job.finished_at else None,
            "result": json.loads(job.result_json) if include_result and job.result_json else None}
