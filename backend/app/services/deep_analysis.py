"""
Deep analysis and resume improvement suggestions via free LLMs.

Provider priority (first configured wins):
  1. Ollama  — local, completely free. Set LLM_PROVIDER=ollama or just have Ollama
               running at OLLAMA_BASE_URL (default: http://localhost:11434).
               Model: OLLAMA_MODEL env var (default: llama3.2).
  2. Gemini  — Google Gemini free tier. Requires GEMINI_API_KEY.
               Model: GEMINI_MODEL env var (default: gemini-2.5-flash).
  3. None    — returns llm_configured: false gracefully. Main ATS score is
               never affected; only the optional deep analysis panel is disabled.

Set LLM_PROVIDER=none to explicitly disable deep analysis.

This module is NEVER in the hot scoring path. Scoring is always LLM-free.
"""
import hashlib
import json
import os
import re
import urllib.parse
from typing import Any, Dict, List

import httpx
from fastapi import HTTPException

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2")
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "auto").lower()  # auto | ollama | gemini | none

DEFAULT_NOT_CONFIGURED = {
    "llm_configured": False,
    "grammar_score": None,
    "grammar_notes": "AI Resume Insights are currently unavailable.",
    "technical_depth_score": None,
    "technical_depth_notes": "AI Resume Insights are currently unavailable.",
    "experience_score": None,
    "experience_notes": "AI Resume Insights are currently unavailable.",
    "overall_summary": "AI Resume Insights are currently unavailable. Your CoreLink matching score is still fully accurate.",
}


def make_cache_key(resume_id: str, target_kind: str, target_text: str) -> str:
    digest = hashlib.sha256(target_text.strip().encode("utf-8")).hexdigest()
    return f"deepanalysis:{resume_id}:{target_kind}:{digest}"


def parse_analysis_json(raw_text: str) -> Dict[str, Any]:
    text = raw_text.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        text = fenced.group(1).strip()
    # Ollama sometimes wraps in partial fences — try to extract first JSON object
    if not text.startswith("{"):
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            text = m.group(0)
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


def _resolve_provider() -> str:
    """Determine which LLM provider to use."""
    if LLM_PROVIDER == "none":
        return "none"
    if LLM_PROVIDER == "ollama":
        return "ollama"
    if LLM_PROVIDER == "gemini":
        return "gemini" if os.environ.get("GEMINI_API_KEY") else "none"
    # auto: prefer Ollama if reachable, fall back to Gemini, then none
    if _ollama_is_reachable():
        return "ollama"
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini"
    return "none"


def _ollama_is_reachable() -> bool:
    """Quick connectivity check (no model load). Times out in 2s."""
    try:
        resp = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=2.0)
        return resp.status_code == 200
    except Exception:
        return False


def run_deep_analysis(resume_text: str, target_text: str) -> Dict[str, Any]:
    provider = _resolve_provider()
    if provider == "ollama":
        return _run_ollama_analysis(resume_text, target_text)
    if provider == "gemini":
        return _run_gemini_analysis(resume_text, target_text)
    return DEFAULT_NOT_CONFIGURED.copy()


# ---------------------------------------------------------------------------
# Ollama (local, free)
# ---------------------------------------------------------------------------

def _run_ollama_analysis(resume_text: str, target_text: str) -> Dict[str, Any]:
    url = f"{OLLAMA_BASE_URL}/api/generate"
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": _prompt(resume_text, target_text),
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 1200},
    }
    try:
        response = httpx.post(url, json=payload, timeout=120.0)
        response.raise_for_status()
        data = response.json()
        raw = data.get("response", "")
        if not raw:
            raise ValueError("Empty response from Ollama")
        return parse_analysis_json(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Ollama returned invalid deep-analysis JSON: {exc}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Ollama deep-analysis request failed: {exc}") from exc


# ---------------------------------------------------------------------------
# Gemini (free tier)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Resume improvement suggestions
# ---------------------------------------------------------------------------

def parse_suggestions_json(raw_text: str) -> Dict[str, Any]:
    text = raw_text.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        text = fenced.group(1).strip()
    if not text.startswith("{"):
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            text = m.group(0)
    data = json.loads(text)
    if "suggestions" not in data:
        raise ValueError("Missing 'suggestions' key in response JSON")
    data["llm_configured"] = True
    return data


def _suggestions_prompt(resume_text: str, target_text: str, missing_skills: List[str]) -> str:
    return f"""
Analyze the resume and target job description to address the following missing skills/keywords:
{', '.join(missing_skills)}

Provide a list of specific, highly actionable additions or phrasing changes (e.g. concrete bullet points or sections) the candidate can add to their resume to highlight these skills. Return strict JSON only, with no markdown fences and no preamble.

JSON shape:
{{
  "suggestions": [
    "Specific line/bullet recommendation 1",
    "Specific line/bullet recommendation 2"
  ]
}}

Target job description:
{target_text[:4000]}

Resume:
{resume_text[:8000]}
""".strip()


def run_resume_suggestions(resume_text: str, target_text: str, missing_skills: List[str]) -> Dict[str, Any]:
    if not missing_skills:
        return {"llm_configured": True, "suggestions": ["Your resume already covers all the keywords identified in the job description!"]}
    provider = _resolve_provider()
    if provider == "ollama":
        return _run_ollama_suggestions(resume_text, target_text, missing_skills)
    if provider == "gemini":
        return _run_gemini_suggestions(resume_text, target_text, missing_skills)
    return {"llm_configured": False, "suggestions": []}


def _run_ollama_suggestions(resume_text: str, target_text: str, missing_skills: List[str]) -> Dict[str, Any]:
    url = f"{OLLAMA_BASE_URL}/api/generate"
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": _suggestions_prompt(resume_text, target_text, missing_skills),
        "stream": False,
        "options": {"temperature": 0.2, "num_predict": 1000},
    }
    try:
        response = httpx.post(url, json=payload, timeout=120.0)
        response.raise_for_status()
        data = response.json()
        raw = data.get("response", "")
        if not raw:
            raise ValueError("Empty response from Ollama")
        return parse_suggestions_json(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Ollama returned invalid suggestions JSON: {exc}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Ollama suggestions request failed: {exc}") from exc


def _run_gemini_suggestions(resume_text: str, target_text: str, missing_skills: List[str]) -> Dict[str, Any]:
    model = urllib.parse.quote(GEMINI_MODEL, safe="")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": _suggestions_prompt(resume_text, target_text, missing_skills)}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 1000,
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
        return parse_suggestions_json(raw)
    except (KeyError, IndexError, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Gemini returned invalid suggestions JSON") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Gemini suggestions request failed") from exc
