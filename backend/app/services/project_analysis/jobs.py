import hashlib, json
from datetime import timedelta
from sqlmodel import Session, select
from ...db import ProjectAnalysisJob, ProjectFile, StudentProject, engine, utc_now

def input_hash(project, files):
    raw = json.dumps([sorted(f.sha256 for f in files), project.video_url, project.description, project.domain], sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()

def create_or_get_job(project):
    with Session(engine) as s:
        files = s.exec(select(ProjectFile).where(ProjectFile.project_id == project.id)).all()
        digest = input_hash(project, files)
        old = s.exec(select(ProjectAnalysisJob).where(ProjectAnalysisJob.project_id == project.id, ProjectAnalysisJob.input_hash == digest).order_by(ProjectAnalysisJob.id.desc())).first()
        if old and old.status in {"queued", "running", "done"}:
            return old
        job = ProjectAnalysisJob(project_id=project.id, candidate_id=project.candidate_id, input_hash=digest)
        s.add(job); s.commit(); s.refresh(job); return job

def update_stage(job_id, stage, state, message=None, progress=0):
    with Session(engine) as s:
        j=s.get(ProjectAnalysisJob, job_id)
        if not j: return
        j.stage, j.progress, j.status, j.updated_at = stage, progress, ("failed" if state == "failed" else "running"), utc_now()
        stages=json.loads(j.stages_json or "[]"); stages.append({"name":stage,"state":state,"message":message}); j.stages_json=json.dumps(stages)
        s.add(j); s.commit()

def fail_job(job_id, user_message):
    with Session(engine) as s:
        j=s.get(ProjectAnalysisJob, job_id)
        if j: j.status="failed"; j.error=user_message[:300]; j.finished_at=utc_now(); j.updated_at=utc_now(); s.add(j); s.commit()

def mark_stuck(job):
    limit = timedelta(minutes=30) if job.stage == "extract_files" else timedelta(minutes=15)
    if job.status == "running" and job.updated_at and utc_now() - job.updated_at > limit:
        message = "File reading stopped before finishing. Open the project and press Resume analysis." if job.stage == "extract_files" else "Analysis stopped because the service was interrupted. Please try again."
        fail_job(job.id, message)
        job.status="failed"
    return job
