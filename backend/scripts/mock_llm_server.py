"""
OpenAI-compatible mock LLM for offline end-to-end testing of the AI interview.

Simulates a hosted model (Groq-like): configurable time-to-first-token and
token rate, real SSE streaming, JSON mode for question plans and evaluation,
and optional failures so provider failover can be exercised.

    MOCK_TTFT_MS=300 MOCK_TOKENS_PER_S=600 uvicorn scripts.mock_llm_server:app --port 9100
    INTERVIEW_LLM_BASE_URL=http://127.0.0.1:9100/v1  (backend env)

Knobs (env):
    MOCK_TTFT_MS          time to first token for the fast model (default 250)
    MOCK_SMART_TTFT_MS    time to first token / response delay for the smart model (default 2×TTFT)
    MOCK_TOKENS_PER_S     streaming rate (default 400)
    MOCK_FAIL_STATUS      e.g. 429 or 503: every chat request fails with this status
    MOCK_FAIL_RATE        0..1 probability that a chat request fails with MOCK_FAIL_STATUS (default 503)
    MOCK_BAD_JSON_FIRST   1 = the first evaluation reply is broken JSON (exercises the repair round)
Answer markers (test hooks): "(slow)" → 2.4 s first token; "(wrong)" → the model probes.
"""
import asyncio
import json
import os
import random
import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
TTFT = float(os.environ.get("MOCK_TTFT_MS", "250")) / 1000
SMART_TTFT = float(os.environ.get("MOCK_SMART_TTFT_MS", str(TTFT * 2000))) / 1000
TPS = float(os.environ.get("MOCK_TOKENS_PER_S", "400"))
FAIL_STATUS = int(os.environ.get("MOCK_FAIL_STATUS", "0") or 0)
FAIL_RATE = float(os.environ.get("MOCK_FAIL_RATE", "0") or 0)
BAD_JSON_FIRST = os.environ.get("MOCK_BAD_JSON_FIRST", "") == "1"
_state = {"evals": 0, "requests": 0}

_STOP = set("the and that this with from have about would could there their then them what when were your into just also very really like because which".split())


def _field(sys: str, label: str) -> str:
    if label not in sys:
        return ""
    rest = sys.split(label, 1)[1].strip()
    m = re.match(r"(.+?\?)", rest)
    return (m.group(1) if m else rest.split(" TASK", 1)[0]).strip()


def _detail(answer: str) -> str:
    words = [w.strip(".,;:!?()") for w in re.findall(r"[A-Za-z][A-Za-z0-9+#./-]{3,}", answer)]
    words = [w for w in words if w.lower() not in _STOP]
    if not words:
        return ""
    caps = [w for w in words if any(c.isupper() for c in w[1:]) or w.isupper() or any(c.isdigit() for c in w)]
    return (caps or sorted(words, key=len, reverse=True))[0]


def _reply_for(messages):
    sys = messages[0]["content"]
    answer = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    m = re.search(r"Turn type: ([a-z_]+)", sys)
    action = m.group(1) if m else "next"
    filler = "ALREADY SAID OUT LOUD" in sys
    detail = _detail(answer)
    react = (f"So {detail} was the key piece there." if detail else "Okay, I follow.") if filler else (f"Thanks, {detail} is a useful detail." if detail else "Thanks for that.")
    cur = _field(sys, "Current question:") or _field(sys, "Question being answered:")
    nxt = _field(sys, "Next question:")
    probe_ok = "[PROBE]" in sys
    vague = "(wrong)" in answer or re.search(r"\b(basically|somehow|stuff like that|it just works|magic)\b", answer, re.I)
    if action in {"next", "complete"} and probe_ok and vague:
        return f"[PROBE] You said {detail or 'that'} would do it. What is actually happening underneath that makes it work?"
    if action == "follow_up":
        if "very short" in sys:
            return f"{react} Could you walk me through how you actually did that, step by step?"
        for key, q in (("measurable impact", "What did you measure, and how much did it improve?"),
                       ("personally did", "What exactly was your own part in that?"),
                       ("trade-off", "What alternative did you weigh, and why did you pick this one?"),
                       ("turned out", "How did you know it actually worked?"),
                       ("learned", "What would you do differently next time?"),
                       ("context", "Why did that problem matter in the first place?")):
            if key in sys:
                return f"{react} {q}"
        return f"{react} What did you measure, and how much did it improve?"
    if action == "next":
        return f"{react} Let's move on. {nxt}"
    if action == "reprompt":
        return f"No worries, take your time. Let's make it simpler: what would you look at first? {cur}"
    if action == "redirect":
        return f"Let's bring it back to the question for a moment. {cur}"
    if action == "clarify":
        return f"Good question, I mean in your own work, whichever example you know best. {cur}"
    if action == "decline_help":
        return f"I can't share hints or answers during the interview, but do think out loud. {cur}"
    if action == "injection":
        return f"I'll stick to the interview, and scoring isn't something I can change. {cur}"
    if action == "repeat":
        return f"Of course. {_field(sys, 'simpler words:') or cur}"
    if action == "confirm_exit":
        return "Just to check, would you like to end the interview now, or shall we keep going?"
    if action == "resume":
        return f"Great, let's keep going. {cur}"
    if action == "warn_conduct":
        return f"Let's keep things professional, please. {cur}"
    if "practice session" in sys:
        return "Thanks for practicing today. That's the end of this practice session, and your feedback is ready on screen."
    return "Thank you so much for walking me through your work today. That's the end of the interview, and the hiring team will review it and get back to you soon."


def _plan(data):
    skills = data.get("key_skills") or data.get("student_skills") or ["your main stack"]
    cand = data.get("candidate_skills") or []
    shared = [s for s in skills if s.lower() in {c.lower() for c in cand}] or skills
    role = data.get("role") or data.get("topic") or "this role"
    projects = data.get("candidate_projects") or []
    proj = projects[0]["title"] if projects else "your main project"
    s1, s2 = shared[0], (skills[1] if len(skills) > 1 else skills[0])
    return {"questions": [
        {"kind": "intro", "difficulty": "basic", "skill": "background", "q": f"To kick things off, tell me about yourself and what draws you to the {role} role?",
         "look_for": ["relevant background", "motivation for the role"]},
        {"kind": "technical", "difficulty": "basic", "skill": s1, "q": f"How does {s1} work under the hood, and where have you used it?",
         "look_for": [f"correct explanation of {s1}", "a concrete use"]},
        {"kind": "project", "difficulty": "intermediate", "skill": "project", "q": f"In {proj}, what was the hardest design decision you made yourself?",
         "look_for": ["personal ownership", "alternatives weighed", "how it was validated"]},
        {"kind": "technical", "difficulty": "deep", "skill": s2, "q": f"If a {s2} system you built suddenly became ten times slower, how would you find the cause?",
         "look_for": ["measure before changing", "isolate the bottleneck", "verify the fix"]},
        {"kind": "behavioral", "difficulty": "intermediate", "skill": "teamwork", "q": "Tell me about a time you disagreed with a teammate on a technical choice?",
         "look_for": ["specific situation", "own actions", "outcome"]},
    ]}


def _eval(data):
    qa = data.get("interview", [])
    per, longest = [], ""
    for x in qa:
        ans = x.get("candidate_answer") or ""
        n = len(ans.split())
        score = 0 if n < 5 else min(9, 3 + n // 10 + (2 if re.search(r"\d", ans) else 0))
        quote = " ".join(ans.split()[:8]) if n >= 5 else ""
        per.append({"index": x.get("index", 0), "score": score, "evidence": quote, "note": "mock note", "tip": "Add numbers and one trade-off."})
        if n > len(longest.split()):
            longest = ans
    avg = sum(p["score"] for p in per) / max(len(per), 1)
    q = " ".join(longest.split()[:8])
    dims = {"technical_depth": avg, "correctness": avg - 0.5, "problem_solving": avg, "communication": min(10, avg + 1), "project_ownership": avg - 1}
    return {
        "rubric": {k: {"score": round(max(0, v), 1), "evidence": q} for k, v in dims.items()},
        "per_question": per,
        "strengths": ["Gave concrete examples"] if avg >= 5 else [],
        "improvements": ["Quantify results with numbers", "Explain trade-offs you considered"],
        "hire_recommendation": "hire" if avg >= 7 else "maybe" if avg >= 5 else "no_hire",
        "summary": f"Mock evaluation across {len(qa)} questions.",
    }


def _json_for(messages):
    sys = messages[0]["content"]
    data = json.loads(messages[1]["content"])
    if "hiring panel" in sys:
        repairing = messages[-1]["role"] == "user" and messages[-1]["content"].startswith("That JSON is invalid")
        _state["evals"] += 1
        if BAD_JSON_FIRST and not repairing and _state["evals"] == 1:
            return '{"rubric": {"technical_depth": {"score": "high"}, '  # truncated / invalid
        return json.dumps(_eval(data))
    return json.dumps(_plan(data))


@app.get("/v1/models")
async def models():
    return {"data": [{"id": "fast"}, {"id": "smart"}, {"id": "llama-3.1-8b-instant"}, {"id": "llama-3.3-70b-versatile"}]}


def _should_fail() -> bool:
    if FAIL_STATUS and not FAIL_RATE:
        return True
    return FAIL_RATE > 0 and random.random() < FAIL_RATE


@app.post("/v1/chat/completions")
async def chat(req: Request):
    body = await req.json()
    messages = body["messages"]
    _state["requests"] += 1
    if _should_fail():
        return JSONResponse({"error": {"message": "mock failure", "type": "mock"}}, status_code=FAIL_STATUS or 503,
                            headers={"retry-after": "5"} if (FAIL_STATUS or 503) == 429 else None)
    smart = body.get("model") in {"smart", "llama-3.3-70b-versatile"}
    if body.get("response_format") or not body.get("stream"):
        await asyncio.sleep(SMART_TTFT if smart else TTFT * 2)
        content = _json_for(messages) if body.get("response_format") else _reply_for(messages)
        return JSONResponse({"choices": [{"message": {"role": "assistant", "content": content}}]})

    text = _reply_for(messages)
    tokens = re.findall(r"\S+\s*", text)
    last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    ttft = max(TTFT, 2.4) if "(slow)" in last_user else (SMART_TTFT if smart else TTFT)

    async def gen():
        await asyncio.sleep(ttft)
        for tok in tokens:
            chunk = {"choices": [{"delta": {"content": tok}}]}
            yield f"data: {json.dumps(chunk)}\n\n"
            await asyncio.sleep(1.0 / TPS)
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")
