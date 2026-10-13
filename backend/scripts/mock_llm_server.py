"""
OpenAI-compatible mock LLM for offline end-to-end testing of the AI interview.

Simulates a fast hosted model (Groq-like): configurable time-to-first-token and
token rate, real SSE streaming, JSON mode for question plans and evaluation.

    MOCK_TTFT_MS=250 MOCK_TOKENS_PER_S=400 uvicorn scripts.mock_llm_server:app --port 9100
    INTERVIEW_LLM_BASE_URL=http://127.0.0.1:9100/v1  (backend env)
"""
import asyncio
import json
import os
import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
TTFT = float(os.environ.get("MOCK_TTFT_MS", "250")) / 1000
TPS = float(os.environ.get("MOCK_TOKENS_PER_S", "400"))


def _reply_for(messages):
    sys = messages[0]["content"]
    last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    words = re.findall(r"[A-Za-z][A-Za-z+#.]{3,}", last_user)
    detail = " ".join(words[-3:]) if words else "that"
    ack = "Got it, thanks for walking me through that."
    if "ALREADY SAID OUT LOUD" in sys:
        # A filler was already spoken by the client: react to a detail instead.
        ack = f"So you brought up {max(words, key=len).strip('.')}." if words else "Let's keep going."
    if "Next question:" in sys:
        q = sys.split("Next question:", 1)[1].strip()
        return f"{ack} Let's move on. {q}"
    if "follow-up" in sys:
        return f"{ack} Two quick things. First, what did you measure, and second, roughly how much did things improve?"
    if "re-ask" in sys or "Current question:" in sys:
        q = sys.split("Current question:", 1)[1].strip() if "Current question:" in sys else ""
        return f"No worries, take your time and think of one concrete example. {q}"
    if "restate" in sys:
        q = sys.split("words:", 1)[1].strip() if "words:" in sys else ""
        return f"Of course. {q}"
    return "Thank you so much for walking me through your work today. That's the end of the interview, and the hiring team will review it and get back to you soon."


def _json_for(messages):
    sys = messages[0]["content"]
    if "hiring panel" in sys:
        data = json.loads(messages[1]["content"])
        qa = data.get("interview", [])
        per = []
        for x in qa:
            n = len((x.get("answer") or "").split())
            per.append({"index": x.get("index", 0), "score": min(10, 3 + n // 12), "evidence": (x.get("answer") or "")[:80]})
        overall = int(sum(p["score"] for p in per) / max(len(per), 1) * 10)
        return {
            "overall_score": overall,
            "dimension_scores": {"technical_depth": 7, "problem_solving": 7, "communication": 8, "ownership_impact": 6, "role_fit": 7},
            "per_question": per,
            "strengths": ["Clear explanations", "Concrete examples"],
            "concerns": ["Limited metrics in some answers"],
            "recommendation": "advance" if overall >= 70 else "consider" if overall >= 50 else "decline",
            "summary": f"Mock evaluation across {len(qa)} questions.",
        }
    data = json.loads(messages[1]["content"])
    skills = data.get("key_skills") or ["your main stack"]
    role = data.get("role", "this role")
    return {"questions": [
        {"kind": "intro", "q": f"To kick things off, tell me a bit about yourself and why the {role} role caught your eye?"},
        {"kind": "technical", "q": f"Walk me through a real problem you solved using {skills[0]}. What did you do, step by step?"},
        {"kind": "technical", "q": f"How would you debug a {skills[min(1, len(skills)-1)]} service that suddenly became ten times slower in production?"},
        {"kind": "project", "q": "What was the hardest technical decision in your submitted project, and what alternatives did you weigh?"},
        {"kind": "behavioral", "q": "Tell me about a time you disagreed with a teammate. How did you resolve it?"},
    ]}


@app.get("/v1/models")
async def models():
    return {"data": [{"id": "fast"}, {"id": "smart"}]}


@app.post("/v1/chat/completions")
async def chat(req: Request):
    body = await req.json()
    messages = body["messages"]
    if body.get("response_format") or not body.get("stream"):
        await asyncio.sleep(TTFT * 2)
        content = json.dumps(_json_for(messages)) if body.get("response_format") else _reply_for(messages)
        return JSONResponse({"choices": [{"message": {"role": "assistant", "content": content}}]})

    text = _reply_for(messages)
    tokens = re.findall(r"\S+\s*", text)
    # Test hook: an answer containing "(slow)" simulates a slow model (2.4 s to
    # first token) so the client's "thinking aloud" path can be exercised.
    last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    ttft = max(TTFT, 2.4) if "(slow)" in last_user else TTFT

    async def gen():
        await asyncio.sleep(ttft)
        for tok in tokens:
            chunk = {"choices": [{"delta": {"content": tok}}]}
            yield f"data: {json.dumps(chunk)}\n\n"
            await asyncio.sleep(1.0 / TPS)
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")
