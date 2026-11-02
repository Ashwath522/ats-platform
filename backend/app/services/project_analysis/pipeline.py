import json, os
from datetime import datetime
from sqlmodel import Session, select
from ...db import ProjectAnalysisJob, ProjectFile, StudentProject, engine, utc_now
from .schemas import Evidence, AnalysisResult, StageStatus
from .jobs import update_stage, fail_job

STAGES = ["validate_files", "extract_files", "analyse_domain", "analyse_video", "verify_claims", "build_report"]
def run_job(job_id):
    with Session(engine) as s:
        job=s.get(ProjectAnalysisJob, job_id); project=s.get(StudentProject, job.project_id) if job else None
        files=s.exec(select(ProjectFile).where(ProjectFile.project_id==project.id)).all() if project else []
    if not job or not project: return
    try:
        ev=[]; update_stage(job_id,"validate_files","running",progress=5)
        for i,f in enumerate(files, 1):
            path=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "media", f.media_path)
            if not os.path.exists(path) or os.path.getsize(path) != f.size_bytes: raise ValueError("An uploaded project file is unavailable or changed.")
            ev.append(Evidence(id=f"ev_{i}",source_type="file",source_ref=str(f.id),fact=f"File '{f.filename}' ({f.ext.lstrip('.').upper()} source, {f.size_bytes / 1024:.1f} KB) uploaded",method="parsed",confidence="high"))
        if (project.description or '').strip(): ev.append(Evidence(id=f"ev_{len(ev)+1}",source_type="description",source_ref="description",fact="Student provided a project description.",method="student_claim",confidence="low"))
        update_stage(job_id,"validate_files","done",progress=20)
        domain_data=None; domain_evidence=[]
        if project.domain == "electronics":
            from .analysers.electronics import analyse_electronics
            domain_data, domain_evidence = analyse_electronics(project, files, ev)
            ev.extend(domain_evidence)
        elif project.domain in {"software", "ai_ml", "mechanical", "civil", "robotics_iot"}:
            mod=__import__(f"app.services.project_analysis.analysers.{project.domain if project.domain != 'ai_ml' else 'ai_ml'}",fromlist=['analyse'])
            domain_data=mod.analyse(files, ev)
            for n, finding in enumerate(domain_data.get("findings", []), 1):
                ev.append(Evidence(id=f"domain_{n}",source_type="analysis",source_ref=project.domain,fact=finding["fact"],method="rule",confidence="medium"))
        stages=[]
        for name in STAGES:
            if name == "validate_files": stages.append(StageStatus(name=name,state="done",message="Files validated")); continue
            msg = "Video analysis coming soon" if name == "analyse_video" and project.video_url else ("Skipped: no video provided — practical functionality will be unverified" if name == "analyse_video" else "Available in a later update")
            stages.append(StageStatus(name=name,state="skipped",message=msg)); update_stage(job_id,name,"skipped",msg,20)
        result=AnalysisResult(project_id=project.id,domain=project.domain,stages=stages,evidence=ev,domain_data=domain_data,created_at=utc_now())
        with Session(engine) as s:
            j=s.get(ProjectAnalysisJob,job_id); j.status="done"; j.progress=100; j.stage="build_report"; j.result_json=result.model_dump_json(); j.stages_json=json.dumps([x.model_dump(mode="json") for x in stages]); j.finished_at=utc_now(); j.updated_at=utc_now(); s.add(j); s.commit()
    except Exception:
        fail_job(job_id,"Analysis could not validate the project files. Please check the uploads and try again.")
