import hashlib
import json
import os
import re
import urllib.parse
from typing import Any, Dict

import httpx
from fastapi import HTTPException

ANTHROPIC_MODEL = os.environ.get("SUGGESTIONS_MODEL", "claude-haiku-4-5-20251001")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

DEFAULT_NOT_CONFIGURED = {
    "llm_configured": False,
    "grammar_score": None,
    "grammar_issues": [],
    "technical_depth_score": None,
    "technical_depth_notes": "Deep analysis requires GEMINI_API_KEY or ANTHROPIC_API_KEY.",
    "experience_score": None,
    "experience_notes": "Deep analysis requires GEMINI_API_KEY or ANTHROPIC_API_KEY.",
    "overall_summary": "Set GEMINI_API_KEY or ANTHROPIC_API_KEY to enable grammar, technical depth, and experience analysis.",
}


def make_cache_key(resume_id: str, target_kind: str, target_text: str) -> str:
    digest = hashlib.sha256(target_text.strip().encode("utf-8")).hexdigest()
    return f"deepanalysis:{resume_id}:{target_kind}:{digest}"


def parse_analysis_json(raw_text: str) -> Dict[str, Any]:
    text = raw_text.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        text = fenced.group(1).strip()
    data = json.loads(text)
    required = {
        "grammar_score",
        "grammar_issues",
        "technical_depth_score",
        "technical_depth_notes",
        "experience_score",
        "experience_notes",
        "overall_summary",
    }
    missing = required - set(data)
    if missing:
        raise ValueError(f"Missing keys: {', '.join(sorted(missing))}")
    data["llm_configured"] = True
    return data


def _prompt(resume_text: str, target_text: str) -> str:
    return f"""
Analyze this resume against the target job description. Return strict JSON only,
with no markdown fences and no preamble. Score conservatively using evidence from
the resume, not keyword presence alone.

JSON shape:
{{
  "grammar_score": 0-100,
  "grammar_issues": [
    {{"issue": "short description of the problem", "suggestion": "how to fix it"}}
  ],
  "technical_depth_score": 0-100,
  "technical_depth_notes": "1-2 sentences on whether the resume shows genuine technical substance vs generic filler",
  "experience_score": 0-100,
  "experience_notes": "1-2 sentences on quantified achievements, seniority signals, project depth",
  "overall_summary": "2-3 sentence overall take"
}}

Target job description:
{target_text[:6000]}

Resume:
{resume_text[:10000]}
""".strip()


def run_deep_analysis(resume_text: str, target_text: str) -> Dict[str, Any]:
    if os.environ.get("GEMINI_API_KEY"):
        return _run_gemini_analysis(resume_text, target_text)
    if os.environ.get("ANTHROPIC_API_KEY"):
        return _run_anthropic_analysis(resume_text, target_text)
    return DEFAULT_NOT_CONFIGURED.copy()


def _run_gemini_analysis(resume_text: str, target_text: str) -> Dict[str, Any]:
    model = urllib.parse.quote(GEMINI_MODEL, safe="")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": _prompt(resume_text, target_text)}]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 1200,
            "response_mime_type": "application/json",
        },
    }
    try:
        response = httpx.post(
            url,
            headers={"Content-Type": "application/json", "x-goog-api-key": os.environ["GEMINI_API_KEY"]},
            json=payload,
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        raw = data["candidates"][0]["content"]["parts"][0]["text"]
        return parse_analysis_json(raw)
    except (KeyError, IndexError, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Gemini returned invalid deep-analysis JSON") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Gemini deep-analysis request failed") from exc


def _run_anthropic_analysis(resume_text: str, target_text: str) -> Dict[str, Any]:
    try:
        from anthropic import Anthropic
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Anthropic SDK is not installed") from exc

    try:
        client = Anthropic()
        message = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=1200,
            temperature=0.1,
            messages=[{"role": "user", "content": _prompt(resume_text, target_text)}],
        )
        raw = "".join(block.text for block in message.content if getattr(block, "type", None) == "text")
        return parse_analysis_json(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="LLM returned invalid deep-analysis JSON") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Deep analysis provider request failed") from exc
