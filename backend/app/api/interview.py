"""
Live AI interview API (server-side LLM, streaming, low latency).

Flow
----
1. ``POST /api/interview/applications/{app_id}/session`` – called as soon as the
   candidate opens the interview (while they read consent / test their mic), so
   question planning (smart model) + LLM connection warm-up happen *before* the
   interview starts. Returns the spoken greeting + first question.
2. ``POST /api/interview/sessions/{sid}/turn`` – candidate's answer in, the
   interviewer's reply streamed back as NDJSON lines:
       {"t":"meta","action":"follow_up","q_index":1,"total":5}
       {"t":"d","v":"Got it, the caching layer "}      (text deltas)
       {"t":"end","done":false,"q_index":1,"provider":"groq","ttft_ms":180,...}
   The client speaks each sentence as soon as it is complete. The hot path does
   no database reads (session state is cached in-process) and the transcript is
   written after the reply has streamed.
3. ``POST /api/interview/sessions/{sid}/finish`` – server evaluates the
   transcript (smart-model JSON rubric → validation → one repair round →
   heuristic fallback), stores the result on the application, writes the audit
   log and emails the candidate. The candidate never receives the score.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from ..auth import get_current_admin, get_current_candidate
from ..db import (
    Application,
    CandidateProfile,
    CandidateUser,
    Company,
    InterviewSession,
    Job,
    Resume,
    StudentProject,
    User,
    engine,
    utc_now,
)
from ..services import interview_ai as ai
from ..services import llm_stream
from ..services import llm_telemetry
from ..rate_limit import limiter

logger = logging.getLogger("ats-platform.interview")
router = APIRouter(prefix="/api/interview", tags=["interview"])

SESSION_RESUME_WINDOW_S = 2 * 60 * 60
TURN_MAX_TOKENS = 100


def _envf(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


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


def _jl(raw, default):
    try:
        v = json.loads(raw) if raw else default
        return v if v is not None else default
    except Exception:
        return default


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
    if reqs:
        listed = [s.strip() for s in reqs.replace(";", ",").replace("\n", ",").split(",") if 1 < len(s.strip()) <= 40]
        skills = list(dict.fromkeys(skills + listed))[:12]
    return {"title": title, "company": company, "jd": f"{jd}\n{reqs}".strip(), "skills": skills, "branch": getattr(job, "branch", None)}


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


def _candidate_projects(session: Session, candidate_id: int) -> List[dict]:
    try:
        rows = session.exec(
            select(StudentProject).where(StudentProject.candidate_id == candidate_id, StudentProject.status != "draft")
            .order_by(StudentProject.featured.desc(), StudentProject.created_at.desc()).limit(3)
        ).all()
    except Exception:
        return []
    return [{"title": p.title, "description": p.description or "", "tools": _jl(p.tools_json, [])} for p in rows]


def _first_name(session: Session, cand: CandidateUser) -> str:
    user = session.exec(select(User).where(User.email == cand.username)).first()
    name = (user.name if user and user.name and "@" not in user.name else "") or ""
    if not name:
        name = cand.username.split("@")[0].replace(".", " ").replace("_", " ")
    return name.split()[0].capitalize() if name.split() else "there"


def _is_practice(s: InterviewSession) -> bool:
    return (s.mode or "application") == "practice" or s.application_id is None


def _plan_entry(s: InterviewSession) -> dict:
    for item in _jl(s.latency_json, []):
        if isinstance(item, dict) and item.get("kind") == "plan":
            return item
    return {}


def _practice_meta(s: InterviewSession) -> dict:
    ctx = _plan_entry(s).get("context")
    return ctx if isinstance(ctx, dict) else {}


def _session_context(session: Session, s: InterviewSession) -> dict:
    stored = _practice_meta(s)
    if _is_practice(s):
        title = stored.get("title") or s.practice_topic or "engineering"
        return {"title": title, "company": stored.get("company") or "", "jd": stored.get("jd") or title,
                "skills": stored.get("skills") or [], "branch": stored.get("branch")}
    if stored.get("title"):
        return stored  # cached at session creation: no job/skill lookups per turn
    return _job_context(session, session.get(Application, s.application_id))


def _load(s: InterviewSession):
    return _jl(s.plan_json, []), _jl(s.transcript_json, [])


def _trim_latency(lat: list, keep: int = 60) -> list:
    """Keep the plan entry (it carries the session context) plus recent samples."""
    plan = [x for x in lat if isinstance(x, dict) and x.get("kind") == "plan"][:1]
    rest = [x for x in lat if not (isinstance(x, dict) and x.get("kind") == "plan")]
    return plan + rest[-(keep - len(plan)):]


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


# ── In-process session state (hot path without DB reads) ─────────────────────
#
# The API runs as a single worker on the free tier, so caching the live session
# in memory is safe and saves several DB round-trips per turn (≈ 50-500 ms on a
# remote Postgres). Set INTERVIEW_SESSION_CACHE=0 when running several workers.

@dataclass
class _State:
    sid: int
    username: str
    status: str
    practice: bool
    ctx: dict
    plan: list
    transcript: list
    q_idx: int
    followups: int
    touched: float = field(default_factory=time.time)


_STATES: Dict[int, _State] = {}
_STATE_TTL_S = 45 * 60


def _cache_on() -> bool:
    return os.environ.get("INTERVIEW_SESSION_CACHE", "1").lower() not in {"0", "false", "no"}


def _evict_stale() -> None:
    now = time.time()
    for k in [k for k, v in _STATES.items() if now - v.touched > _STATE_TTL_S]:
        _STATES.pop(k, None)


def _state_from_db(sid: int, username: str) -> _State:
    with Session(engine) as session:
        s = _owned_session(session, sid, username)
        ctx = _session_context(session, s)
        plan, transcript = _load(s)
        return _State(sid=sid, username=username, status=s.status, practice=_is_practice(s), ctx=ctx, plan=plan,
                      transcript=transcript, q_idx=s.question_index, followups=s.followups_on_current)


async def _get_state(sid: int, username: str) -> _State:
    st = _STATES.get(sid) if _cache_on() else None
    if st is not None and st.username == username and time.time() - st.touched < _STATE_TTL_S:
        st.touched = time.time()
        return st
    st = await asyncio.to_thread(_state_from_db, sid, username)
    if _cache_on():
        _evict_stale()
        _STATES[sid] = st
    return st


def _drop_state(sid: int) -> None:
    _STATES.pop(sid, None)


def _persist_turn(sid: int, transcript: list, q_idx: int, followups: int, lat_entry: dict) -> None:
    with Session(engine) as session:
        s2 = session.get(InterviewSession, sid)
        if s2 is None:
            return
        s2.transcript_json = json.dumps(transcript)
        s2.question_index = q_idx
        s2.followups_on_current = followups
        lat = _jl(s2.latency_json, [])
        lat.append(lat_entry)
        s2.latency_json = json.dumps(_trim_latency(lat))
        session.add(s2)
        session.commit()


# ── Planning (smart model, cached) ────────────────────────────────────────────

_PLAN_CACHE: Dict[str, tuple] = {}
_PLAN_TTL_S = 6 * 60 * 60


def _plan_key(*parts) -> str:
    return hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()


async def _plan_with_llm(messages: List[dict], n: int, cache_key: Optional[str]) -> tuple:
    """(plan | None, provider). Smart model first, fast model if it's slow or down."""
    if not llm_stream.configured_providers():
        return None, "scripted"
    if cache_key and cache_key in _PLAN_CACHE and time.time() - _PLAN_CACHE[cache_key][2] < _PLAN_TTL_S:
        plan, provider, _ts = _PLAN_CACHE[cache_key]
        return [dict(x) for x in plan], provider
    budget = _envf("INTERVIEW_PLAN_BUDGET_S", 10.0)
    t0 = time.perf_counter()
    plan, provider = None, "scripted"
    for smart in (True, False):
        remaining = budget - (time.perf_counter() - t0)
        if remaining < 1.0:
            break
        try:
            obj = await asyncio.wait_for(
                llm_stream.complete_json(messages, smart=smart, max_tokens=900, timeout=min(7.0, remaining),
                                         deadline=remaining, operation="plan" if smart else "plan_fast",
                                         hedge_after=_envf("INTERVIEW_PLAN_HEDGE_S", 3.5)),
                timeout=remaining + 0.5,
            )
        except Exception as exc:
            logger.warning("[INTERVIEW] question planning (%s) failed: %s", "smart" if smart else "fast", exc)
            obj = None
        plan = ai.parse_plan(obj, n)
        if plan:
            provider = f"{(obj or {}).get('_provider', 'llm')}/{(obj or {}).get('_model', '')}".rstrip("/")
            break
    if plan and cache_key:
        _PLAN_CACHE[cache_key] = (plan, provider, time.time())
        if len(_PLAN_CACHE) > 500:
            _PLAN_CACHE.pop(next(iter(_PLAN_CACHE)))
    return plan, provider


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/providers")
async def providers():
    """Which LLM providers are configured (names only, never keys)."""
    return {"providers": [p.name for p in llm_stream.configured_providers()]}


@router.get("/llm/status")
async def llm_status(probe: int = 0, limit: int = 40, admin: str = Depends(get_current_admin)):
    """Admin: which provider/model answers interview turns and evaluations,
    failure reasons (HTTP status, timeout…) and first-token latency. ``probe=1``
    checks every provider's /models with the real key; ``probe=2`` also sends a
    1-token chat to the fast model. Keys are never returned."""
    out = {
        "order": [p.name for p in llm_stream.configured_providers()],
        "providers": llm_stream.health_snapshot(),
        "stats_1h": llm_telemetry.llm_stats(3600),
        "recent": llm_telemetry.recent_llm_events(max(1, min(limit, 200))),
    }
    if probe:
        out["probe"] = await llm_stream.probe_providers(chat=probe >= 2)
    return out


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
        cand_skills = [str(x) for x in _jl(profile.skills_json if profile else None, [])][:12]
        projects = _candidate_projects(session, cand.id)
        if not ctx.get("branch") and profile and profile.branch:
            ctx["branch"] = profile.branch

    # Plan questions with the smart LLM (bounded, cached), warm the connection in parallel.
    n = ai.DEFAULT_QUESTION_COUNT
    t0 = time.perf_counter()
    warm = asyncio.create_task(llm_stream.warm_up())
    msgs = ai.plan_messages(ctx["title"], ctx["company"], ctx["jd"], ctx["skills"], resume_text, project_summary, n,
                            branch=ctx.get("branch"), candidate_skills=cand_skills, projects=projects)
    plan, provider = await _plan_with_llm(msgs, n, _plan_key("app", app_id, msgs[1]["content"]))
    if not plan:
        plan = ai.fallback_plan(ctx["title"], ctx["skills"], project_summary, n, candidate_skills=cand_skills,
                                project_title=(projects[0]["title"] if projects else None))
    plan_ms = int((time.perf_counter() - t0) * 1000)
    if not warm.done():
        warm.cancel()
    llm_stream.touch_activity()

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
            latency_json=json.dumps([{"kind": "plan", "server_ms": plan_ms, "provider": provider, "context": ctx}]),
        )
        app_record.interview_status = "in_progress"
        session.add(s)
        session.add(app_record)
        session.commit()
        session.refresh(s)
        if _cache_on():
            _STATES[s.id] = _State(sid=s.id, username=candidate, status="active", practice=False, ctx=ctx, plan=plan,
                                   transcript=list(transcript), q_idx=0, followups=0)
        return _session_payload(s, greeting_text, resumed=False)


@router.post("/sessions/{sid}/warm")
@limiter.limit("30/minute")
async def warm_session(request: Request, sid: int, candidate: str = Depends(get_current_candidate)):
    """Called by the client when the candidate starts answering: loads the
    session into memory and refreshes keep-alive connections to the LLM, so the
    reply after a long answer doesn't pay a cold TLS handshake."""
    await _get_state(sid, candidate)
    llm_stream.touch_activity()
    asyncio.create_task(llm_stream.warm_up())
    return {"ok": True}


def _turn_counts(transcript: list, q_idx: int) -> dict:
    on_q = [t for t in transcript if t.get("role") == "interviewer" and t.get("q_index") == q_idx]
    last_interviewer = next((t for t in reversed(transcript) if t.get("role") == "interviewer"), {})
    prev_cand = [t for t in transcript if t.get("role") == "candidate"][-1:]
    return {
        "retries": sum(1 for t in on_q if t.get("kind") in ai.RETRY_KINDS),
        "loops": sum(1 for t in on_q if t.get("kind") in ai.LOOP_KINDS),
        "last_kind": last_interviewer.get("kind"),
        "recent_non": sum(1 for t in prev_cand if ai.is_non_substantive(t.get("text", ""))),
        "strikes": sum(1 for t in transcript if t.get("role") == "interviewer" and t.get("kind") == "warn_conduct"),
    }


class _ReplyShaper:
    """Holds back the first few characters of the stream to (a) detect the
    model's ``[PROBE]`` tag and (b) trim an opening that repeats the filler the
    client already spoke. Releases as soon as a decision is possible."""

    def __init__(self, filler: str, watch_probe: bool):
        self.filler = filler
        self.watch_probe = watch_probe
        self.buf: Optional[str] = "" if (filler or watch_probe) else None
        self.probe = False

    def _ready(self) -> bool:
        b = self.buf or ""
        s = b.lstrip()
        if self.watch_probe and len(s) < 9 and (not s or s[0] in "[(<"):
            return False
        if self.filler:
            if len(b) >= 60:
                return True
            m = re.search(r"[.!?…]\s+\S", b)
            return bool(m and len(b) >= 24)
        return len(s) >= 1

    def _release(self) -> str:
        text = self.buf or ""
        self.buf = None
        if self.watch_probe:
            self.probe, text = ai.split_probe_tag(text)
        if self.filler:
            text = ai.strip_repeated_filler(text, self.filler)
        return text

    def feed(self, delta: str) -> str:
        if self.buf is None:
            return delta
        self.buf += delta
        return self._release() if self._ready() else ""

    def flush(self) -> str:
        return self._release() if self.buf else ""


@router.post("/sessions/{sid}/turn")
@limiter.limit("40/minute")
async def interview_turn(request: Request, sid: int, payload: dict = Body(...), candidate: str = Depends(get_current_candidate)):
    t_req = time.perf_counter()
    answer = str(payload.get("answer") or "").strip()[:4000]
    client_meta = payload.get("client") or {}
    # Short acknowledgement the client already spoke ("Hmm, okay.") while the
    # reply is generated. It is only used to steer the prompt; it is never part
    # of the scored transcript text.
    filler = ai.sanitize_filler(payload.get("filler_spoken"))

    st = await _get_state(sid, candidate)
    if st.status != "active":
        raise HTTPException(status_code=409, detail="Interview already finished")
    llm_stream.touch_activity()
    ctx, plan, transcript = st.ctx, st.plan, st.transcript
    q_idx, followups = st.q_idx, st.followups
    is_practice = st.practice

    total = len(plan)
    cur = plan[q_idx] if q_idx < total else {}
    current_q = cur.get("q", "")
    counts = _turn_counts(transcript, q_idx)
    decision = ai.decide_action(
        answer,
        question_index=q_idx,
        total_questions=total,
        followups_on_current=followups,
        recent_non_answers=counts["recent_non"],
        hostile_strikes=counts["strikes"],
        current_kind="follow_up" if counts["last_kind"] == "follow_up" else "base",
        question_kind=cur.get("kind", "technical"),
        retries_on_current=counts["retries"],
        loops_on_current=counts["loops"],
        awaiting_exit_confirm=counts["last_kind"] == "confirm_exit",
        question_text=current_q,
        job_terms=list(ctx.get("skills") or []) + [ctx.get("title") or ""],
    )
    action = decision["action"]
    allow_probe = bool(decision.get("allow_probe")) and bool(llm_stream.configured_providers())
    next_idx = q_idx + 1 if action == "next" else q_idx
    next_q = plan[next_idx]["q"] if action == "next" and next_idx < total else None
    done = action in {"complete", "end_by_candidate", "end_conduct"}

    cand_entry = {"role": "candidate", "text": answer, "q_index": q_idx, "ts": time.time()}
    if decision.get("injection"):
        cand_entry["flag"] = "injection"
    transcript.append(cand_entry)
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
        allow_probe=allow_probe,
        look_for=cur.get("look_for"),
        plan=plan,
        q_index=q_idx,
        branch=ctx.get("branch"),
        injection=bool(decision.get("injection")),
    )
    pre_ms = int((time.perf_counter() - t_req) * 1000)

    async def gen():
        nonlocal action, next_idx, next_q, done
        t0 = time.perf_counter()
        yield json.dumps({"t": "meta", "action": action, "q_index": next_idx, "total": total, "done": done}) + "\n"
        result = llm_stream.StreamResult()
        text = ""
        shaper = _ReplyShaper(filler, allow_probe)
        persisted = False

        def finalize_state(spoken: str) -> dict:
            kind = {"follow_up": "follow_up", "next": "base"}.get(action, action)
            entry = {"role": "interviewer", "text": spoken, "q_index": next_idx, "kind": kind, "ts": time.time()}
            if shaper.probe:
                entry["probe"] = True
            if filler:
                entry["filler"] = filler  # kept apart from the text: never scored
            transcript.append(entry)
            st.q_idx = next_idx
            st.followups = followups + 1 if action == "follow_up" else (0 if action == "next" else followups)
            return {
                "kind": "turn", "action": action, "reason": decision.get("reason"), "probe": shaper.probe,
                "provider": result.provider, "model": result.model, "ttft_ms": result.ttft_ms,
                "server_ms": int((time.perf_counter() - t0) * 1000), "pre_ms": pre_ms,
                "attempts": result.attempts,
                "client": {k: client_meta.get(k) for k in ("silence_ms", "prev_tts_first_audio_ms", "prev_ttfa_ms", "endpoint_reason", "filler_ms", "thinking_aloud",
                                                         "prev_answer_to_voice_ms", "prev_first_token_ms") if k in client_meta},
            }

        try:
            try:
                if not llm_stream.configured_providers():
                    raise llm_stream.LLMUnavailable("no provider")
                async for delta in llm_stream.stream_chat(
                    messages,
                    max_tokens=TURN_MAX_TOKENS,
                    temperature=0.6,
                    result=result,
                    operation="practice_turn" if is_practice else "turn",
                ):
                    out = shaper.feed(delta)
                    if shaper.probe and action != "follow_up":
                        # The model judged the answer wrong/vague: stay on this question.
                        action, next_idx, next_q, done = "follow_up", q_idx, None, False
                    if out:
                        text += out
                        yield json.dumps({"t": "d", "v": out}) + "\n"
                rest = shaper.flush()
                if shaper.probe and action != "follow_up":
                    action, next_idx, next_q, done = "follow_up", q_idx, None, False
                if rest:
                    text += rest
                    yield json.dumps({"t": "d", "v": rest}) + "\n"
            except Exception as exc:
                rest = shaper.flush()
                if rest:
                    text += rest
                    yield json.dumps({"t": "d", "v": rest}) + "\n"
                if not ai.clean_spoken(text):
                    logger.warning("[INTERVIEW] scripted reply for session %s (%s)", sid, llm_telemetry.redact(exc))
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
            # Trailing space lets the client's sentence splitter release the last sentence immediately.
            yield json.dumps({"t": "d", "v": " "}) + "\n"
            lat_entry = finalize_state(spoken)
            persisted = True
            yield json.dumps({
                "t": "end",
                "done": done,
                "action": action,
                "q_index": next_idx,
                "provider": result.provider,
                "model": result.model or None,
                "ttft_ms": result.ttft_ms,
                "server_ms": lat_entry["server_ms"],
            }) + "\n"
            # Persist after streaming so the reply isn't delayed by DB writes.
            await asyncio.to_thread(_persist_turn, sid, list(transcript), st.q_idx, st.followups, lat_entry)
        finally:
            if not persisted:  # client went away mid-reply: keep the answer anyway
                lat_entry = finalize_state(ai.clean_spoken(text) or "(interrupted)")
                loop = asyncio.get_running_loop()
                loop.run_in_executor(None, _persist_turn, sid, list(transcript), st.q_idx, st.followups, lat_entry)

    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Evaluation ────────────────────────────────────────────────────────────────

async def _evaluate(ctx: dict, plan: list, transcript: list, *, practice: bool) -> tuple:
    """(qa, evaluation). Smart model → validate → one repair round → heuristic."""
    qa = ai.qa_pairs(transcript, plan)
    integrity = ai.integrity_flags(transcript)
    n = len(plan)
    evaluation = None
    has_substance = bool(ai._answer_stats(qa)["substantive"])
    if llm_stream.configured_providers() and has_substance:
        msgs = ai.eval_messages(ctx["title"], ctx["jd"], ctx.get("skills") or [], qa, practice=practice, plan=plan,
                                branch=ctx.get("branch"), total_questions=n)
        budget = _envf("INTERVIEW_EVAL_BUDGET_S", 28.0)
        t0 = time.perf_counter()
        repaired = False
        try:
            obj = await asyncio.wait_for(
                llm_stream.complete_json(msgs, smart=True, max_tokens=1400, timeout=20.0, deadline=budget * 0.7,
                                         operation="practice_eval" if practice else "evaluate", return_raw=True,
                                         hedge_after=_envf("INTERVIEW_EVAL_HEDGE_S", 12.0)),
                timeout=budget * 0.7 + 1,
            )
        except Exception as exc:
            logger.warning("[INTERVIEW] evaluation call failed: %s", exc)
            obj = None
        errs = ai.validate_eval(obj, qa) if obj is not None else ["no response"]
        if obj is not None and errs:
            remaining = budget - (time.perf_counter() - t0)
            logger.info("[INTERVIEW] evaluation JSON invalid (%s); repairing", "; ".join(errs)[:200])
            if remaining > 3:
                try:
                    obj2 = await asyncio.wait_for(
                        llm_stream.complete_json(ai.repair_messages(msgs, obj, errs), smart=True, max_tokens=1400, timeout=min(15.0, remaining),
                                                 deadline=remaining, operation="evaluate_repair", return_raw=True),
                        timeout=remaining + 1,
                    )
                except Exception:
                    obj2 = None
                if obj2 is not None and not ai.validate_eval(obj2, qa):
                    obj, errs, repaired = obj2, [], True
        if obj is not None and not errs:
            evaluation = ai.finalize_eval(obj, qa, total_questions=n, integrity=integrity)
            evaluation["repaired"] = repaired
    if evaluation is None:
        evaluation = ai.heuristic_eval(qa, total_questions=n, practice=practice, integrity=integrity)
        if practice:
            evaluation["summary"] = f"Estimated from the structure and detail of {len([x for x in qa if x.get('answer')])} answers (offline scoring)."
    return qa, evaluation


def _llm_usage(lat: list, evaluation: dict, plan_provider: Optional[str]) -> dict:
    turns: Dict[str, int] = {}
    ttfts = []
    for x in lat:
        if isinstance(x, dict) and x.get("kind") == "turn":
            key = x.get("provider") or "scripted"
            if x.get("model"):
                key = f"{key}/{x['model']}"
            turns[key] = turns.get(key, 0) + 1
            if isinstance(x.get("ttft_ms"), int):
                ttfts.append(x["ttft_ms"])
    ttfts.sort()
    return {
        "plan": plan_provider,
        "turns": turns,
        "turn_ttft_p50_ms": ttfts[len(ttfts) // 2] if ttfts else None,
        "evaluation": (f"{evaluation.get('provider')}/{evaluation.get('model')}" if evaluation.get("method") == "llm" else "offline heuristic"),
    }


@router.post("/sessions/{sid}/finish")
@limiter.limit("10/minute")
async def finish_interview(request: Request, sid: int, payload: dict = Body(default={}), candidate: str = Depends(get_current_candidate)):
    proctoring = payload.get("proctoring") or {}
    ended_reason = str(payload.get("ended_reason") or "completed")[:60]
    client_latency = payload.get("latency") or []

    with Session(engine) as session:
        s = _owned_session(session, sid, candidate)
        if s.status == "completed":
            _drop_state(sid)
            if _is_practice(s):
                return {"completed": True, "already": True, "practice": True, "evaluation": _practice_eval_view(s)}
            return {"completed": True, "already": True}
        if _is_practice(s):
            practice = True
        else:
            practice = False
            ctx = _session_context(session, s)
            plan, transcript = _load(s)
            plan_provider = s.provider
    if practice:
        return await _finish_practice(sid, payload)
    st = _STATES.get(sid)
    if st is not None:
        st.status = "finishing"  # no more turns while scoring
        if len(st.transcript) > len(transcript):
            transcript = list(st.transcript)

    qa, evaluation = await _evaluate(ctx, plan, transcript, practice=False)

    try:
        risk_score = int(max(0, min(100, float(proctoring.get("risk_score", 0)))))
    except Exception:
        risk_score = 0
    risk_level = str(proctoring.get("risk_level") or ("high" if risk_score >= 60 else "medium" if risk_score >= 30 else "low"))
    if risk_level not in {"low", "medium", "high"}:
        risk_level = "low"

    with Session(engine) as session:
        s = session.get(InterviewSession, sid)
        app_record = session.get(Application, s.application_id)
        lat = _jl(s.latency_json, [])
        usage = _llm_usage(lat, evaluation, plan_provider)
        evaluation["llm_usage"] = usage
        rec_text = (
            f"{evaluation['recommendation'].upper()}: {evaluation.get('summary', '')}".strip()
            + (f" Strengths: {'; '.join(evaluation['strengths'])}." if evaluation.get("strengths") else "")
            + (f" Concerns: {'; '.join(evaluation['concerns'])}." if evaluation.get("concerns") else "")
        )[:1400]
        rec_text += f" [AI: scored by {usage['evaluation']}; replies by {', '.join(f'{k} x{v}' for k, v in usage['turns'].items()) or 'n/a'}]"
        if isinstance(client_latency, list):
            lat.append({"kind": "client_summary", "samples": client_latency[-40:]})
        s.latency_json = json.dumps(lat)
        s.status = "completed"
        s.completed_at = utc_now()
        s.eval_json = json.dumps({**evaluation, "ended_reason": ended_reason, "proctoring": proctoring})
        session.add(s)

        app_record.interview_id = s.id
        app_record.interview_eval_score = evaluation["overall_score"]
        app_record.interview_recommendation = rec_text[:1600]
        app_record.interview_risk_score = risk_score
        app_record.interview_risk_level = risk_level
        app_record.interview_transcript_json = json.dumps(qa)
        app_record.interview_status = "completed"
        app_record.status = "automated_interview"
        if (risk_level == "high" or risk_score >= 50 or evaluation.get("method") != "llm" or ended_reason != "completed"
                or evaluation.get("integrity_flags")):
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
    _drop_state(sid)

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
_PRACTICE_EVAL_KEYS = ("overall_score", "dimension_scores", "rubric", "per_question", "strengths", "improvements", "concerns",
                       "recommendation", "summary", "method", "ended_reason", "coverage", "answered", "total_questions")


def _practice_eval_view(s: InterviewSession) -> Optional[dict]:
    ev = _jl(s.eval_json, None)
    if not ev:
        return None
    return {k: ev.get(k) for k in _PRACTICE_EVAL_KEYS}


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
            _drop_state(old.id)
        session.commit()
        profile = session.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == cand.id)).first()
        from .student_portal import branch_id, BRANCH_LABELS

        bid = branch_id(profile.branch if profile else None)
        branch_label = BRANCH_LABELS.get(bid or "", "Engineering")
        full = (profile.full_name or "").strip() if profile else ""
        first = full.split()[0].capitalize() if full else _first_name(session, cand)
        skills = [str(x) for x in _jl(profile.skills_json if profile else None, [])][:10]

    n = ai.PRACTICE_QUESTION_COUNT
    t0 = time.perf_counter()
    msgs = ai.practice_plan_messages(kind, topic, branch_label, company, seeds, n, candidate_skills=skills)
    # Practice plans are cached only when the student supplied the questions
    # (otherwise every session should get fresh questions).
    plan, provider = await _plan_with_llm(msgs, n, _plan_key("practice", candidate, msgs[1]["content"]) if seeds else None)
    if not plan:
        plan = ai.practice_fallback_plan(kind, topic, bid, seeds, n)
    plan_ms = int((time.perf_counter() - t0) * 1000)
    llm_stream.touch_activity()

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
        if _cache_on():
            _STATES[s.id] = _State(sid=s.id, username=candidate, status="active", practice=True,
                                   ctx={"title": topic, "company": company, "jd": context["jd"], "skills": skills, "branch": bid},
                                   plan=plan, transcript=list(transcript), q_idx=0, followups=0)
        out = _session_payload(s, greeting_text, resumed=False)
        out.update({"practice": True, "kind": kind, "topic": topic, "company": company or None, "max_minutes": 15})
        return out


async def _finish_practice(sid: int, payload: dict) -> dict:
    ended_reason = str(payload.get("ended_reason") or "completed")[:60]
    with Session(engine) as session:
        s = session.get(InterviewSession, sid)
        ctx = _session_context(session, s)
        plan, transcript = _load(s)
        plan_provider = s.provider
    st = _STATES.get(sid)
    if st is not None:
        st.status = "finishing"
        if len(st.transcript) > len(transcript):
            transcript = list(st.transcript)
    qa, evaluation = await _evaluate(ctx, plan, transcript, practice=True)
    with Session(engine) as session:
        s = session.get(InterviewSession, sid)
        lat = _jl(s.latency_json, [])
        evaluation["llm_usage"] = _llm_usage(lat, evaluation, plan_provider)
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
        _drop_state(sid)
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
        ev = _jl(s.eval_json, {})
        return {
            **_practice_row(s),
            "evaluation": _practice_eval_view(s),
            "qa": ev.get("qa") or ai.qa_pairs(transcript, plan),
            "transcript": [{"role": t.get("role"), "text": t.get("text")} for t in transcript],
        }
