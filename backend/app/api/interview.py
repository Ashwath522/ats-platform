"""
Live AI interview API (server-side LLM, streaming, low latency).

Flow
----
1. ``POST /api/interview/applications/{app_id}/session`` – called as soon as the
   candidate opens the interview (while they read consent / test their mic), so
   question planning + LLM connection warm-up happen *before* the interview
   starts. Returns the spoken greeting + first question.
2. ``POST /api/interview/sessions/{sid}/turn`` – candidate's answer in, the
   interviewer's reply streamed back as NDJSON lines:
       {"t":"meta","action":"follow_up","q_index":1,"total":5}
       {"t":"d","v":"Got it, the caching layer "}      (text deltas)
       {"t":"end","done":false,"q_index":1,"provider":"groq","ttft_ms":180,...}
   The client speaks each sentence as soon as it is complete.
3. ``POST /api/interview/sessions/{sid}/finish`` – server evaluates the
   transcript (LLM rubric, heuristic fallback), stores the result on the
   application, writes the audit log and emails the candidate. The candidate
   never receives the score (no score leakage).
"""
from __future__ import annotations

import asyncio
import json
import re
import logging
import time
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from ..auth import get_current_candidate
from ..db import (
    Application,
    CandidateProfile,
    CandidateUser,
    Company,
    InterviewSession,
    Job,
    Resume,
    User,
    engine,
    utc_now,
)
from ..services import interview_ai as ai
from ..services import llm_stream
from ..rate_limit import limiter

logger = logging.getLogger("ats-platform.interview")
router = APIRouter(prefix="/api/interview", tags=["interview"])

SESSION_RESUME_WINDOW_S = 2 * 60 * 60


# ── helpers ───────────────────────────────────────────────────────────────────

def _candidate_user(session: Session, username: str) -> CandidateUser:
    user = session.exec(select(CandidateUser).where(CandidateUser.username == username)).first()
    if not user:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return user


def _owned_application(session: Session, app_id: int, cand: CandidateUser) -> Application:
    app_record = session.get(Application, app_id)
    if not app_record or app_record.candidate_id != cand.id:
        raise HTTPException(status_code=404, detail="Application not found")
    return app_record


def _owned_session(session: Session, sid: int, username: str) -> InterviewSession:
    cand = _candidate_user(session, username)
    s = session.get(InterviewSession, sid)
    if not s or s.candidate_id != cand.id:
        raise HTTPException(status_code=404, detail="Interview session not found")
    return s


def _job_context(session: Session, app_record: Application) -> dict:
    job = session.get(Job, app_record.job_id) if app_record.job_id else None
    company = ""
    if job and job.company_id:
        c = session.get(Company, job.company_id)
        company = c.name if c else ""
    jd = (job.description if job else "") or ""
    reqs = (job.requirements if job else "") or ""
    title = (job.title if job else "") or "this"
    try:
        from ..services.scoring import _extract_skills_present

        skills = _extract_skills_present(f"{jd}\n{reqs}", getattr(job, "branch", None))
    except Exception:
        skills = []
    if not skills and reqs:
        skills = [s.strip() for s in reqs.replace(";", ",").split(",") if s.strip()][:8]
    return {"title": title, "company": company, "jd": f"{jd}\n{reqs}".strip(), "skills": skills}


def _resume_excerpt(session: Session, app_record: Application) -> str:
    if not app_record.resume_id:
        return ""
    resume = session.get(Resume, app_record.resume_id)
    if not resume:
        return ""
    try:
        from ..resume_utils import vector_store

        doc = vector_store.get_document("resumes", resume.vector_doc_id)
        return (doc or {}).get("document", "")[:2000]
    except Exception:
        return ""


def _first_name(session: Session, cand: CandidateUser) -> str:
    user = session.exec(select(User).where(User.email == cand.username)).first()
    name = (user.name if user and user.name and "@" not in user.name else "") or ""
    if not name:
        name = cand.username.split("@")[0].replace(".", " ").replace("_", " ")
    return name.split()[0].capitalize() if name.split() else "there"


def _is_practice(s: InterviewSession) -> bool:
    return (s.mode or "application") == "practice" or s.application_id is None


def _practice_meta(s: InterviewSession) -> dict:
    for item in json.loads(s.latency_json or "[]"):
        if isinstance(item, dict) and item.get("kind") == "plan" and isinstance(item.get("context"), dict):
            return item["context"]
    return {}


def _session_context(session: Session, s: InterviewSession) -> dict:
    if _is_practice(s):
        meta = _practice_meta(s)
        title = meta.get("title") or s.practice_topic or "engineering"
        return {"title": title, "company": meta.get("company") or "", "jd": meta.get("jd") or title, "skills": meta.get("skills") or []}
    return _job_context(session, session.get(Application, s.application_id))


def _load(s: InterviewSession):
    return json.loads(s.plan_json or "[]"), json.loads(s.transcript_json or "[]")


def _session_payload(s: InterviewSession, greeting_text: str, resumed: bool) -> dict:
    plan, transcript = _load(s)
    return {
        "session_id": s.id,
        "interviewer": {"name": ai.INTERVIEWER_NAME},
        "greeting": greeting_text,
        "total_questions": len(plan),
        "question_index": s.question_index,
        "resumed": resumed,
        "turns": len([t for t in transcript if t.get("role") == "candidate"]),
        "max_minutes": 20,
    }


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/providers")
async def providers():
    """Which LLM providers are configured (names only, never keys)."""
    return {"providers": [p.name for p in llm_stream.configured_providers()]}


@router.post("/applications/{app_id}/session")
@limiter.limit("20/minute")
async def create_or_resume_session(request: Request, app_id: int, candidate: str = Depends(get_current_candidate)):
    from .candidate import can_take_interview

    with Session(engine) as session:
        cand = _candidate_user(session, candidate)
        app_record = _owned_application(session, app_id, cand)

        existing = session.exec(
            select(InterviewSession)
            .where(InterviewSession.application_id == app_id, InterviewSession.status == "active")
            .order_by(InterviewSession.started_at.desc())
        ).first()
        if existing and (utc_now() - existing.started_at).total_seconds() < SESSION_RESUME_WINDOW_S:
            _plan, transcript = _load(existing)
            last = next((t["text"] for t in reversed(transcript) if t.get("role") == "interviewer"), "")
            answered = any(t.get("role") == "candidate" for t in transcript)
            # Only say "welcome back" if they had actually started answering.
            greeting_text = (f"Welcome back. Let's pick up where we left off. {last}" if answered else last) or ""
            asyncio.create_task(llm_stream.warm_up())
            return _session_payload(existing, greeting_text, resumed=True)

        access = can_take_interview(app_record)
        if not access["allowed"] and app_record.interview_status != "in_progress":
            raise HTTPException(status_code=403, detail=access["reason"])

        ctx = _job_context(session, app_record)
        resume_text = _resume_excerpt(session, app_record)
        first = _first_name(session, cand)
        profile = session.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == cand.id)).first()
        project_summary = app_record.project_summary or (profile.project_summary if profile else None)

    # Plan questions with the LLM (bounded), warm the connection in parallel.
    n = ai.DEFAULT_QUESTION_COUNT
    t0 = time.perf_counter()
    warm = asyncio.create_task(llm_stream.warm_up())
    plan = None
    provider = "scripted"
    if llm_stream.configured_providers():
        try:
            obj = await asyncio.wait_for(
                llm_stream.complete_json(
                    ai.plan_messages(ctx["title"], ctx["company"], ctx["jd"], ctx["skills"], resume_text, project_summary, n),
                    smart=False,
                    max_tokens=700,
                    timeout=8.0,
                ),
                timeout=9.0,
            )
            plan = ai.parse_plan(obj, n)
            if plan:
                provider = (obj or {}).get("_provider", "llm")
        except Exception as exc:
            logger.warning("[INTERVIEW] question planning failed: %s", exc)
    if not plan:
        plan = ai.fallback_plan(ctx["title"], ctx["skills"], project_summary, n)
    plan_ms = int((time.perf_counter() - t0) * 1000)
    if not warm.done():
        warm.cancel()

    greeting_text = ai.greeting(first, ctx["title"], ctx["company"], plan[0]["q"], len(plan))
    transcript = [{"role": "interviewer", "text": greeting_text, "q_index": 0, "kind": "base", "ts": time.time()}]

    with Session(engine) as session:
        app_record = session.get(Application, app_id)
        s = InterviewSession(
            application_id=app_id,
            candidate_id=app_record.candidate_id,
            job_id=app_record.job_id,
            plan_json=json.dumps(plan),
            transcript_json=json.dumps(transcript),
            question_index=0,
            provider=provider,
            latency_json=json.dumps([{"kind": "plan", "server_ms": plan_ms, "provider": provider}]),
        )
        app_record.interview_status = "in_progress"
        session.add(s)
        session.add(app_record)
        session.commit()
        session.refresh(s)
        return _session_payload(s, greeting_text, resumed=False)


@router.post("/sessions/{sid}/turn")
@limiter.limit("40/minute")
async def interview_turn(request: Request, sid: int, payload: dict = Body(...), candidate: str = Depends(get_current_candidate)):
    answer = str(payload.get("answer") or "").strip()[:4000]
    client_meta = payload.get("client") or {}
    # Short acknowledgement the client already spoke ("Hmm, okay.") while the
    # reply is generated. It is only used to steer the prompt; it is never part
    # of the scored transcript text.
    filler = ai.sanitize_filler(payload.get("filler_spoken"))

    with Session(engine) as session:
        s = _owned_session(session, sid, candidate)
        if s.status != "active":
            raise HTTPException(status_code=409, detail="Interview already finished")
        ctx = _session_context(session, s)
        is_practice = _is_practice(s)
        plan, transcript = _load(s)
        q_idx, followups = s.question_index, s.followups_on_current

    total = len(plan)
    current_q = plan[q_idx]["q"] if q_idx < total else ""
    last_interviewer = next((t for t in reversed(transcript) if t.get("role") == "interviewer"), {})
    current_kind = "follow_up" if last_interviewer.get("kind") == "follow_up" else "base"
    recent_cand = [t for t in transcript if t.get("role") == "candidate"][-1:]
    recent_non = sum(1 for t in recent_cand if ai.is_non_substantive(t.get("text", "")))
    strikes = sum(1 for t in transcript if t.get("role") == "interviewer" and t.get("kind") == "warn_conduct")

    decision = ai.decide_action(
        answer,
        question_index=q_idx,
        total_questions=total,
        followups_on_current=followups,
        recent_non_answers=recent_non,
        hostile_strikes=strikes,
        current_kind=current_kind,
        question_kind=(plan[q_idx].get("kind", "technical") if q_idx < total else "technical"),
    )
    action = decision["action"]
    next_idx = q_idx + 1 if action == "next" else q_idx
    next_q = plan[next_idx]["q"] if action == "next" and next_idx < total else None
    done = action in {"complete", "end_by_candidate", "end_conduct"}

    transcript.append({"role": "candidate", "text": answer, "q_index": q_idx, "ts": time.time()})
    messages = ai.turn_messages(
        action=action,
        job_title=ctx["title"],
        company=ctx["company"],
        history=transcript,
        answer=answer,
        current_question=current_q,
        next_question=next_q,
        focus=decision.get("focus"),
        practice=is_practice,
        filler_spoken=filler,
    )

    async def gen():
        t0 = time.perf_counter()
        yield json.dumps({"t": "meta", "action": action, "q_index": next_idx, "total": total, "done": done}) + "\n"
        result = llm_stream.StreamResult()
        text = ""
        # When a filler was already spoken, hold back the first few words so a
        # reply that opens by repeating it ("Okay, got it. ...") can be trimmed.
        held = "" if filler else None
        try:
            if not llm_stream.configured_providers():
                raise llm_stream.LLMUnavailable("no provider")
            async for delta in llm_stream.stream_chat(
                messages,
                max_tokens=110,
                temperature=0.7,
                first_token_timeout=float(__import__("os").environ.get("INTERVIEW_TTFT_BUDGET_S", "3.5")),
                result=result,
            ):
                if held is not None:
                    held += delta
                    if len(held) < 60:
                        continue
                    delta, held = ai.strip_repeated_filler(held, filler), None
                text += delta
                yield json.dumps({"t": "d", "v": delta}) + "\n"
            if held:
                held = ai.strip_repeated_filler(held, filler)
                text += held
                yield json.dumps({"t": "d", "v": held}) + "\n"
        except Exception as exc:
            if held:
                text += held
                yield json.dumps({"t": "d", "v": held}) + "\n"
            if not text:
                logger.info("[INTERVIEW] scripted reply (%s)", exc)
                text = ai.scripted_reply(action, current_question=current_q, next_question=next_q, focus=decision.get("focus"), filler_spoken=filler)
                if is_practice and done:
                    text = ai.practice_scripted_end(action)
                result.provider = "scripted"
                yield json.dumps({"t": "d", "v": text}) + "\n"

        spoken = ai.clean_spoken(text)
        # Safety net: a "next" turn must actually contain the next question.
        if action == "next" and next_q and "?" not in spoken:
            extra = " " + next_q
            spoken += extra
            yield json.dumps({"t": "d", "v": extra}) + "\n"
        server_ms = int((time.perf_counter() - t0) * 1000)
        yield json.dumps({
            "t": "end",
            "done": done,
            "action": action,
            "q_index": next_idx,
            "provider": result.provider,
            "ttft_ms": result.ttft_ms,
            "server_ms": server_ms,
        }) + "\n"

        # Persist after streaming so the response isn't delayed by DB writes.
        kind = {"follow_up": "follow_up", "next": "base"}.get(action, action)
        entry = {"role": "interviewer", "text": spoken, "q_index": next_idx, "kind": kind, "ts": time.time()}
        if filler:
            entry["filler"] = filler  # kept apart from the text: never scored
        transcript.append(entry)
        with Session(engine) as session:
            s2 = session.get(InterviewSession, sid)
            if s2 is None:
                return
            s2.transcript_json = json.dumps(transcript)
            s2.question_index = next_idx
            s2.followups_on_current = followups + 1 if action == "follow_up" else (0 if action == "next" else followups)
            lat = json.loads(s2.latency_json or "[]")
            lat.append({
                "kind": "turn",
                "action": action,
                "provider": result.provider,
                "ttft_ms": result.ttft_ms,
                "server_ms": server_ms,
                "client": {k: client_meta.get(k) for k in ("silence_ms", "prev_tts_first_audio_ms", "prev_ttfa_ms", "endpoint_reason", "filler_ms", "thinking_aloud") if k in client_meta},
            })
            s2.latency_json = json.dumps(lat[-60:])
            session.add(s2)
            session.commit()

    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/sessions/{sid}/finish")
@limiter.limit("10/minute")
async def finish_interview(request: Request, sid: int, payload: dict = Body(default={}), candidate: str = Depends(get_current_candidate)):
    proctoring = payload.get("proctoring") or {}
    ended_reason = str(payload.get("ended_reason") or "completed")[:60]
    client_latency = payload.get("latency") or []

    with Session(engine) as session:
        s = _owned_session(session, sid, candidate)
        if s.status == "completed":
            if _is_practice(s):
                return {"completed": True, "already": True, "practice": True, "evaluation": _practice_eval_view(s)}
            return {"completed": True, "already": True}
        if _is_practice(s):
            return await _finish_practice(sid, payload)
        app_record = session.get(Application, s.application_id)
        ctx = _job_context(session, app_record)
        plan, transcript = _load(s)

    qa = ai.qa_pairs(transcript, plan)
    evaluation = None
    if llm_stream.configured_providers() and any(x.get("answer") for x in qa):
        obj = await llm_stream.complete_json(ai.eval_messages(ctx["title"], ctx["jd"], ctx["skills"], qa), smart=True, max_tokens=1200, timeout=30.0)
        if obj:
            evaluation = ai.normalise_eval(obj)
    if evaluation is None:
        evaluation = ai.heuristic_eval(qa)

    try:
        risk_score = int(max(0, min(100, float(proctoring.get("risk_score", 0)))))
    except Exception:
        risk_score = 0
    risk_level = str(proctoring.get("risk_level") or ("high" if risk_score >= 60 else "medium" if risk_score >= 30 else "low"))
    if risk_level not in {"low", "medium", "high"}:
        risk_level = "low"

    rec_text = (
        f"{evaluation['recommendation'].upper()}: {evaluation.get('summary', '')}".strip()
        + (f" Strengths: {'; '.join(evaluation['strengths'])}." if evaluation.get("strengths") else "")
        + (f" Concerns: {'; '.join(evaluation['concerns'])}." if evaluation.get("concerns") else "")
    )[:1500]

    with Session(engine) as session:
        s = session.get(InterviewSession, sid)
        app_record = session.get(Application, s.application_id)
        lat = json.loads(s.latency_json or "[]")
        if isinstance(client_latency, list):
            lat.append({"kind": "client_summary", "samples": client_latency[-40:]})
        s.latency_json = json.dumps(lat)
        s.status = "completed"
        s.completed_at = utc_now()
        s.eval_json = json.dumps({**evaluation, "ended_reason": ended_reason, "proctoring": proctoring})
        session.add(s)

        app_record.interview_id = s.id
        app_record.interview_eval_score = evaluation["overall_score"]
        app_record.interview_recommendation = rec_text
        app_record.interview_risk_score = risk_score
        app_record.interview_risk_level = risk_level
        app_record.interview_transcript_json = json.dumps(qa)
        app_record.interview_status = "completed"
        app_record.status = "automated_interview"
        if risk_level == "high" or risk_score >= 50 or evaluation.get("method") != "llm" or ended_reason != "completed":
            app_record.pending_human_review = True
        session.add(app_record)
        session.commit()
        session.refresh(app_record)

        from ..services.audit import record_audit_event

        record_audit_event(
            session=session,
            event_type="interview_evaluation",
            application_id=app_record.id,
            candidate_id=app_record.candidate_id,
            job_id=app_record.job_id,
            ats_score=app_record.ats_score,
            project_score=app_record.project_score,
            final_score=app_record.final_score,
            risk_score=risk_score,
            risk_level=risk_level,
            llm_providers_consulted=[evaluation.get("provider")] if evaluation.get("provider") else [],
            raw_verdicts={"evaluation": evaluation, "ended_reason": ended_reason, "proctoring": proctoring},
            final_recommendation=rec_text,
        )

        cand = session.get(CandidateUser, app_record.candidate_id)
        profile = session.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == app_record.candidate_id)).first()
        to_email = (profile.contact_email if profile and profile.contact_email else None) or (cand.username if cand else None)
        first = _first_name(session, cand) if cand else "there"

    if to_email and "@" in to_email:
        try:
            from ..services import email_templates
            from ..services.email_delivery import queue_email

            subject, text, html = email_templates.interview_completed(first, ctx["title"])
            queue_email(to_email, subject, text, html=html, category="interview_completed")
        except Exception as exc:
            logger.info("[INTERVIEW] completion email skipped: %s", exc)

    return {"completed": True, "ended_reason": ended_reason}


# ── Practice mode (student portal: private mock interviews) ───────────────────

PRACTICE_DAILY_LIMIT = 40


def _practice_eval_view(s: InterviewSession) -> Optional[dict]:
    ev = json.loads(s.eval_json) if s.eval_json else None
    if not ev:
        return None
    return {k: ev.get(k) for k in ("overall_score", "dimension_scores", "per_question", "strengths", "concerns", "recommendation", "summary", "method", "ended_reason")}


def _practice_row(s: InterviewSession) -> dict:
    ev = _practice_eval_view(s) or {}
    _plan, transcript = _load(s)
    meta = _practice_meta(s)
    return {
        "id": s.id,
        "kind": s.practice_kind,
        "topic": s.practice_topic,
        "company": meta.get("company") or None,
        "status": s.status,
        "started_at": s.started_at.isoformat() if s.started_at else None,
        "completed_at": s.completed_at.isoformat() if s.completed_at else None,
        "overall_score": ev.get("overall_score"),
        "dimension_scores": ev.get("dimension_scores") or {},
        "recommendation": ev.get("recommendation"),
        "questions_answered": len({t.get("q_index") for t in transcript if t.get("role") == "candidate" and (t.get("text") or "").strip()}),
        "total_questions": len(_plan),
    }


@router.post("/practice/session")
@limiter.limit("20/minute")
async def create_practice_session(request: Request, payload: dict = Body(...), candidate: str = Depends(get_current_candidate)):
    """Start a private practice interview (never linked to an application)."""
    kind = str(payload.get("kind") or "technical").strip().lower()
    if kind not in ai.PRACTICE_KINDS:
        raise HTTPException(status_code=422, detail="kind must be technical, domain, hr or mock")
    topic = re.sub(r"\s+", " ", str(payload.get("topic") or "")).strip()[:120]
    company = re.sub(r"\s+", " ", str(payload.get("company") or "")).strip()[:80]
    seeds_in = payload.get("questions") or []
    if not isinstance(seeds_in, list):
        raise HTTPException(status_code=422, detail="questions must be a list")
    seeds = [re.sub(r"\s+", " ", str(q)).strip() for q in seeds_in[:20] if isinstance(q, str)]
    seeds = [q for q in seeds if 12 <= len(q) <= 300][:12]
    if not topic:
        topic = {"technical": "Core technical concepts", "domain": "Domain knowledge", "hr": "HR interview", "mock": "Mock interview"}[kind]

    with Session(engine) as session:
        cand = _candidate_user(session, candidate)
        since = utc_now() - __import__("datetime").timedelta(days=1)
        today = session.exec(select(InterviewSession.id).where(
            InterviewSession.candidate_id == cand.id, InterviewSession.mode == "practice", InterviewSession.started_at >= since)).all()
        if len(today) >= PRACTICE_DAILY_LIMIT:
            raise HTTPException(status_code=429, detail="Daily practice limit reached — try again tomorrow")
        # Only one active practice session at a time.
        for old in session.exec(select(InterviewSession).where(
                InterviewSession.candidate_id == cand.id, InterviewSession.mode == "practice", InterviewSession.status == "active")).all():
            old.status = "abandoned"
            session.add(old)
        session.commit()
        profile = session.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == cand.id)).first()
        from .student_portal import branch_id, BRANCH_LABELS

        bid = branch_id(profile.branch if profile else None)
        branch_label = BRANCH_LABELS.get(bid or "", "Engineering")
        full = (profile.full_name or "").strip() if profile else ""
        first = full.split()[0].capitalize() if full else _first_name(session, cand)
        skills = []
        if profile:
            try:
                skills = [str(x) for x in json.loads(profile.skills_json or "[]")][:10]
            except Exception:
                skills = []

    n = ai.PRACTICE_QUESTION_COUNT
    t0 = time.perf_counter()
    plan = None
    provider = "scripted"
    if llm_stream.configured_providers():
        try:
            obj = await asyncio.wait_for(
                llm_stream.complete_json(ai.practice_plan_messages(kind, topic, branch_label, company, seeds, n), smart=False, max_tokens=700, timeout=8.0),
                timeout=9.0,
            )
            plan = ai.parse_plan(obj, n)
            if plan:
                provider = (obj or {}).get("_provider", "llm")
        except Exception as exc:
            logger.warning("[INTERVIEW] practice planning failed: %s", exc)
    if not plan:
        plan = ai.practice_fallback_plan(kind, topic, bid, seeds, n)
    plan_ms = int((time.perf_counter() - t0) * 1000)

    greeting_text = ai.practice_greeting(first, kind, topic, company, plan[0]["q"], len(plan))
    transcript = [{"role": "interviewer", "text": greeting_text, "q_index": 0, "kind": "base", "ts": time.time()}]
    context = {"title": topic, "company": company, "jd": f"{kind} practice for {branch_label} engineering students: {topic}", "skills": skills, "branch": bid}
    with Session(engine) as session:
        s = InterviewSession(
            application_id=None,
            candidate_id=cand.id,
            job_id=None,
            mode="practice",
            practice_kind=kind,
            practice_topic=topic,
            plan_json=json.dumps(plan),
            transcript_json=json.dumps(transcript),
            question_index=0,
            provider=provider,
            latency_json=json.dumps([{"kind": "plan", "server_ms": plan_ms, "provider": provider, "context": context}]),
        )
        session.add(s)
        session.commit()
        session.refresh(s)
        out = _session_payload(s, greeting_text, resumed=False)
        out.update({"practice": True, "kind": kind, "topic": topic, "company": company or None, "max_minutes": 15})
        return out


async def _finish_practice(sid: int, payload: dict) -> dict:
    ended_reason = str(payload.get("ended_reason") or "completed")[:60]
    with Session(engine) as session:
        s = session.get(InterviewSession, sid)
        ctx = _session_context(session, s)
        plan, transcript = _load(s)
    qa = ai.qa_pairs(transcript, plan)
    evaluation = None
    if llm_stream.configured_providers() and any(x.get("answer") for x in qa):
        try:
            obj = await asyncio.wait_for(
                llm_stream.complete_json(ai.eval_messages(ctx["title"], ctx["jd"], ctx["skills"], qa), smart=True, max_tokens=1200, timeout=25.0),
                timeout=27.0,
            )
        except Exception:
            obj = None
        if obj:
            evaluation = ai.normalise_eval(obj)
    if evaluation is None:
        evaluation = ai.heuristic_eval(qa)
        fb = ai.practice_feedback(qa)
        evaluation["dimension_scores"] = fb["dimension_scores"]
        evaluation["strengths"] = fb["strengths"]
        evaluation["concerns"] = fb["concerns"]
        evaluation["summary"] = f"Estimated from the structure and detail of {len([x for x in qa if x.get('answer')])} answers (offline scoring)."
    with Session(engine) as session:
        s = session.get(InterviewSession, sid)
        lat = json.loads(s.latency_json or "[]")
        client_latency = payload.get("latency") or []
        if isinstance(client_latency, list):
            lat.append({"kind": "client_summary", "samples": client_latency[-40:]})
        s.latency_json = json.dumps(lat)
        s.status = "completed"
        s.completed_at = utc_now()
        s.eval_json = json.dumps({**evaluation, "ended_reason": ended_reason, "qa": qa})
        session.add(s)
        session.commit()
        session.refresh(s)
        return {"completed": True, "ended_reason": ended_reason, "practice": True, "evaluation": _practice_eval_view(s)}


@router.get("/practice/history")
async def practice_history(limit: int = 50, candidate: str = Depends(get_current_candidate)):
    limit = max(1, min(int(limit or 50), 200))
    with Session(engine) as session:
        cand = _candidate_user(session, candidate)
        rows = session.exec(
            select(InterviewSession)
            .where(InterviewSession.candidate_id == cand.id, InterviewSession.mode == "practice")
            .order_by(InterviewSession.started_at.desc())
        ).all()[:limit]
        return {"sessions": [_practice_row(s) for s in rows]}


@router.get("/practice/sessions/{sid}")
async def practice_session_detail(sid: int, candidate: str = Depends(get_current_candidate)):
    with Session(engine) as session:
        s = _owned_session(session, sid, candidate)
        if not _is_practice(s):
            raise HTTPException(status_code=404, detail="Practice session not found")
        plan, transcript = _load(s)
        ev = json.loads(s.eval_json) if s.eval_json else {}
        return {
            **_practice_row(s),
            "evaluation": _practice_eval_view(s),
            "qa": ev.get("qa") or ai.qa_pairs(transcript, plan),
            "transcript": [{"role": t.get("role"), "text": t.get("text")} for t in transcript],
        }
