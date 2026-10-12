"""Server-side AI interviewer: session → streamed turns → server evaluation."""
import json

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.auth import create_access_token
from app.db import Application, CandidateUser, InterviewSession, Job, RecruiterUser, User, engine
from app.main import app
from app.services import interview_ai as ai
from app.services import llm_stream


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _setup(status="shortlisted", interview_status="unlocked"):
    with Session(engine) as s:
        rec = RecruiterUser(username="int_rec@example.com", password_hash="x")
        cand = CandidateUser(username="priya.sharma@example.com", password_hash="x")
        s.add(User(email="priya.sharma@example.com", name="Priya Sharma", role="candidate", password_hash="x", email_verified=True))
        s.add(rec)
        s.add(cand)
        s.commit()
        s.refresh(rec)
        s.refresh(cand)
        job = Job(recruiter_id=rec.id, title="Backend Engineer", description="Python, FastAPI, PostgreSQL, Redis, Docker", requirements="Python, FastAPI, Redis")
        s.add(job)
        s.commit()
        s.refresh(job)
        appl = Application(candidate_id=cand.id, job_id=job.id, ats_score=80, project_score=75.0, final_score=77.0,
                           status=status, interview_status=interview_status)
        s.add(appl)
        s.commit()
        s.refresh(appl)
        return appl.id


def _headers(email="priya.sharma@example.com"):
    return {"Authorization": f"Bearer {create_access_token(username=email, role='candidate')}"}


def _turn(client, sid, answer):
    res = client.post(f"/api/interview/sessions/{sid}/turn", json={"answer": answer}, headers=_headers())
    assert res.status_code == 200, res.text
    events = [json.loads(line) for line in res.text.splitlines() if line.strip()]
    text = "".join(e["v"] for e in events if e["t"] == "d")
    end = next(e for e in events if e["t"] == "end")
    return events[0], text, end


def test_full_scripted_interview_no_llm(client, monkeypatch):
    monkeypatch.setattr(llm_stream, "configured_providers", lambda: [])
    app_id = _setup()
    res = client.post(f"/api/interview/applications/{app_id}/session", headers=_headers())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["greeting"].startswith("Hi Priya, I'm Aria")
    assert body["total_questions"] == ai.DEFAULT_QUESTION_COUNT
    sid = body["session_id"]

    good = ("At my internship the checkout API was slow, so I built a Redis caching layer in FastAPI and "
            "we reduced p95 latency from 900ms to 120ms; the trade-off was cache invalidation complexity, "
            "which we validated with load tests and monitoring dashboards before we shipped it.")
    meta, text, end = _turn(client, sid, good)
    assert meta["action"] == "next" and end["q_index"] == 1
    assert "?" in text and end["provider"] == "scripted"

    # Short-but-real answer triggers one follow-up, then moves on
    meta, text, end = _turn(client, sid, "I used Python and FastAPI to build a small service for my college project.")
    assert meta["action"] == "follow_up"
    meta, _, end = _turn(client, sid, "It handled about 200 users and we cut response time in half after adding indexes.")
    assert meta["action"] == "next"

    # Candidate asks to repeat, then ends early
    meta, text, _ = _turn(client, sid, "Sorry, can you repeat the question?")
    assert meta["action"] == "repeat" and text.startswith("Of course")
    meta, _, end = _turn(client, sid, "I want to end the interview now please")
    assert meta["action"] == "end_by_candidate" and end["done"] is True

    res = client.post(f"/api/interview/sessions/{sid}/finish", json={"ended_reason": "ended_by_candidate", "proctoring": {"risk_score": 12, "risk_level": "low"}}, headers=_headers())
    assert res.status_code == 200
    assert "score" not in json.dumps(res.json())  # no score leakage to the candidate
    with Session(engine) as s:
        appl = s.get(Application, app_id)
        assert appl.interview_status == "completed"
        assert appl.interview_eval_score is not None
        assert appl.pending_human_review is True  # heuristic eval + early end → human review
        qa = json.loads(appl.interview_transcript_json)
        assert qa[0]["answer"].startswith("At my internship")
        sess = s.get(InterviewSession, sid)
        assert sess.status == "completed"
    # Turn after finish is rejected
    res = client.post(f"/api/interview/sessions/{sid}/turn", json={"answer": "hi"}, headers=_headers())
    assert res.status_code == 409


def test_streaming_llm_reply_and_llm_eval(client, monkeypatch):
    fake = llm_stream.Provider("custom", "http://fake", None, "fast", "smart")
    monkeypatch.setattr(llm_stream, "configured_providers", lambda: [fake])

    async def fake_plan(messages, **kw):
        if "hiring panel" in messages[0]["content"]:
            return {"overall_score": 82, "recommendation": "advance", "summary": "Solid.", "strengths": ["Caching"],
                    "concerns": [], "per_question": [{"index": 0, "score": 8, "evidence": "Redis"}], "_provider": "custom", "_model": "smart"}
        return {"questions": [{"kind": "intro", "q": f"Question number {i} about your Redis and FastAPI work?"} for i in range(5)], "_provider": "custom"}

    async def fake_stream(messages, result=None, **kw):
        result.provider, result.ttft_ms = "custom", 42
        for chunk in ["Nice detail on the Redis layer. ", "Moving on: ", "Question number 1 about your Redis and FastAPI work?"]:
            yield chunk

    async def fake_warm():
        return None

    monkeypatch.setattr(llm_stream, "complete_json", fake_plan)
    monkeypatch.setattr(llm_stream, "stream_chat", fake_stream)
    monkeypatch.setattr(llm_stream, "warm_up", fake_warm)

    app_id = _setup()
    body = client.post(f"/api/interview/applications/{app_id}/session", headers=_headers()).json()
    assert "Question number 0" in body["greeting"]
    meta, text, end = _turn(client, body["session_id"], "I designed a Redis cache which reduced latency by 80% and we validated it with load tests; the trade-off was invalidation.")
    assert text.startswith("Nice detail") and end["provider"] == "custom" and end["ttft_ms"] == 42
    res = client.post(f"/api/interview/sessions/{body['session_id']}/finish", json={"proctoring": {"risk_score": 5}}, headers=_headers())
    assert res.status_code == 200
    with Session(engine) as s:
        appl = s.get(Application, app_id)
        assert appl.interview_eval_score == 82
        assert appl.interview_recommendation.startswith("ADVANCE")


def test_interview_requires_owner_and_unlock(client, monkeypatch):
    monkeypatch.setattr(llm_stream, "configured_providers", lambda: [])
    app_id = _setup(interview_status="locked")
    res = client.post(f"/api/interview/applications/{app_id}/session", headers=_headers())
    assert res.status_code == 403
    with Session(engine) as s:
        s.add(CandidateUser(username="intruder@example.com", password_hash="x"))
        s.commit()
    res = client.post(f"/api/interview/applications/{app_id}/session", headers=_headers("intruder@example.com"))
    assert res.status_code == 404
    res = client.post(f"/api/interview/applications/{app_id}/session")
    assert res.status_code in (401, 403)


def test_turn_policy_unit():
    d = ai.decide_action("idk", question_index=0, total_questions=5, followups_on_current=0, recent_non_answers=0, hostile_strikes=0)
    assert d["action"] == "reprompt"
    d = ai.decide_action("idk", question_index=0, total_questions=5, followups_on_current=0, recent_non_answers=1, hostile_strikes=0)
    assert d["action"] == "next"
    d = ai.decide_action("this is a waste of my time", question_index=1, total_questions=5, followups_on_current=0, recent_non_answers=0, hostile_strikes=0)
    assert d["action"] == "warn_conduct"
    d = ai.decide_action("this is a waste of my time", question_index=1, total_questions=5, followups_on_current=0, recent_non_answers=0, hostile_strikes=1)
    assert d["action"] == "end_conduct"
    d = ai.decide_action("I built the API and it worked well for our team members.", question_index=4, total_questions=5, followups_on_current=1, recent_non_answers=0, hostile_strikes=0)
    assert d["action"] == "complete"
    assert ai.clean_spoken('**Aria:** "Great."  Next?') == "Great. Next?"
