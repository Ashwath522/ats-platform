"""Runs one analysis job end to end. Called through services.precompute (a
background thread; inline in tests). Each stage records its state so the UI
can show real progress; a failing optional stage never sinks the job."""
from __future__ import annotations

import json
import logging
from typing import List, Tuple

from sqlmodel import Session, select

from ...db import CandidateProfile, CandidateUser, ProjectAnalysisJob, ProjectFile, ProjectVideoEvidence, StudentProject, engine
from . import analysers, claims as claims_mod, jobs, media, report, scoring
from .ai import QuotaExceeded
from .context import Ctx
from .extractors import extract, flatten
from .extractors.base import Fact
from .files import read_bytes
from .schemas import AnalysisResult, StageStatus

logger = logging.getLogger("ats-platform")
PENDING = "Daily AI limit reached — this step will run on the next analysis."


def _load(job_id: int):
    with Session(engine) as s:
        job = s.get(ProjectAnalysisJob, job_id)
        p = s.get(StudentProject, job.project_id) if job else None
        if not p:
            return None
        files = s.exec(select(ProjectFile).where(ProjectFile.project_id == p.id).order_by(ProjectFile.id)).all()
        frames = s.exec(select(ProjectVideoEvidence).where(ProjectVideoEvidence.project_id == p.id).order_by(ProjectVideoEvidence.timestamp)).all()
        prof = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == p.candidate_id)).first()
        user = s.get(CandidateUser, p.candidate_id)
        names = [x for x in [prof.full_name if prof else None, user.username.split("@")[0] if user else None,
                             (prof.full_name or "").split()[0] if prof and prof.full_name else None] if x]
        ctx = Ctx(project_id=p.id, domain=p.domain or "other", title=p.title, description=p.description or "",
                  links=json.loads(p.links_json or "[]"), challenge_code=p.challenge_code or "", video_url=p.video_url, student_names=names)
        file_rows = [(f.id, f.filename, f.ext, f.kind, f.media_path) for f in files]
        frame_rows = [(fr.timestamp, fr.media_path) for fr in frames if fr.media_path]
        return ctx, file_rows, frame_rows


def run_job(job_id: int) -> None:
    loaded = _load(job_id)
    if not loaded:
        jobs.fail(job_id, "The project no longer exists.")
        return
    ctx, file_rows, frame_rows = loaded
    try:
        _run(job_id, ctx, file_rows, frame_rows)
    except Exception:
        logger.exception("[project-analysis] job %s crashed", job_id)
        jobs.fail(job_id, "Something went wrong while analysing this project. Please try again.")


def _run(job_id: int, ctx: Ctx, file_rows, frame_rows) -> None:
    # 1 ── validate
    jobs.set_stage(job_id, "validate_files", "running", progress=3)
    blobs: List[Tuple[dict, bytes]] = []
    for fid, name, ext, kind, path in file_rows:
        data = read_bytes(path)
        if data is None:
            ctx.warnings.append(f"{name}: the stored file could not be found — upload it again.")
            continue
        blobs.append(({"id": fid, "filename": name, "ext": ext, "kind": kind}, data))
    ctx.files = [b[0] for b in blobs]
    jobs.set_stage(job_id, "validate_files", "done", f"{len(blobs)} file(s) ready" + (f", {len(file_rows) - len(blobs)} missing" if len(blobs) < len(file_rows) else ""), 10)

    # 2 ── extract
    jobs.set_stage(job_id, "extract_files", "running", progress=12)
    if ctx.description.strip():
        ctx.add_evidence(Fact(fact=f"Student says: {ctx.description.strip()[:400]}", method="student_claim", confidence="low",
                              source_type="description", key="description"), "description")
    photos = []
    for i, (meta, data) in enumerate(blobs):
        ex = extract(meta["filename"], data)
        ctx.extracted.append(ex)
        for fact in ex.facts:
            ctx.add_evidence(fact, meta["filename"])
        ctx.warnings.extend(ex.warnings)
        if meta["kind"] == "image":
            photos.append((meta["filename"], data, "image/png" if meta["ext"] == ".png" else "image/webp" if meta["ext"] == ".webp" else "image/jpeg"))
        jobs.set_stage(job_id, "extract_files", "running", f"Read {i + 1} of {len(blobs)}: {meta['filename']}", 12 + int(30 * (i + 1) / max(1, len(blobs))))
    ctx.blocks = flatten(ctx.extracted)
    n_ev = sum(1 for e in ctx.evidence if e.source_type == "file")
    jobs.set_stage(job_id, "extract_files", "done" if blobs else "skipped", f"{n_ev} facts read from {len(blobs)} file(s)" if blobs else "No files uploaded", 42)

    # 3 ── domain analysis (+ photos)
    jobs.set_stage(job_id, "analyse_domain", "running", progress=45)
    msg = ""
    try:
        media.read_photos(ctx, photos)
    except QuotaExceeded:
        msg = " Photos not read: " + PENDING
    ctx.domain_data.update(analysers.run(ctx))
    jobs.set_stage(job_id, "analyse_domain", "done", f"{len(ctx.findings)} engineering checks.{msg}", 60)

    # 4 ── video
    jobs.set_stage(job_id, "analyse_video", "running", progress=62)
    frames = [(ts, d) for ts, path in frame_rows for d in [read_bytes(path)] if d]
    try:
        state, _, vmsg = media.analyse_video(ctx, frames).partition(":")
    except QuotaExceeded:
        state, vmsg = "skipped", PENDING
    jobs.set_stage(job_id, "analyse_video", state, vmsg, 75)

    # 5 ── claims
    jobs.set_stage(job_id, "verify_claims", "running", progress=78)
    claims = claims_mod.extract_claims(ctx)
    claims_mod.verify_claims(claims, ctx)
    counts = {k: sum(1 for c in claims if c.status == k) for k in ("verified", "partially_verified", "unverified", "contradicted")}
    jobs.set_stage(job_id, "verify_claims", "done",
                   f"{len(claims)} claims: {counts['verified']} verified, {counts['partially_verified']} partly, {counts['contradicted']} contradicted", 90)

    # 6 ── score + report
    jobs.set_stage(job_id, "build_report", "running", progress=92)
    scores = scoring.score(ctx, claims)
    rep = report.build(ctx, claims, scores)
    with Session(engine) as s:
        stages = [StageStatus(**st) for st in json.loads(s.get(ProjectAnalysisJob, job_id).stages_json or "[]")]
    for st in stages:
        if st.name == "build_report":
            st.state, st.message = "done", "Report ready"
    result = AnalysisResult(project_id=ctx.project_id, domain=ctx.domain, stages=stages, evidence=ctx.evidence, claims=claims,
                            domain_data={k: v for k, v in ctx.domain_data.items() if not k.startswith("_")} | {"findings": ctx.findings},
                            video=ctx.video, scores=scores, report=rep, warnings=list(dict.fromkeys(ctx.warnings))[:40], ai_used=ctx.ai_used)
    jobs.set_stage(job_id, "build_report", "done", "Report ready", 99)
    jobs.finish(job_id, result.model_dump_json())
