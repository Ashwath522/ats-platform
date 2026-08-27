from typing import Union
from typing import Optional
"""
ai/groq_client.py
─────────────────
Thin wrapper around the Groq chat API used as the primary project
scorer. Returns a strict JSON dict; on any failure it degrades to a
safe default so the pipeline keeps running.
"""

import json
import time
import logging

import os
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant")
GROQ_MODEL_PREFERENCES = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b-32768",
]

# Server logger
logger = logging.getLogger("corelink")
handler = logging.FileHandler("server.log")
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
if not logger.handlers:
    logger.addHandler(handler)
logger.setLevel(logging.INFO)
# Substrings that mark a model as NOT a general text-chat model.
# Groq adds audio (orpheus), TTS, embeddings, guard, vision-only, and
# compound/agentic models — all must be excluded when auto-selecting.
_NON_CHAT_HINTS = (
    "whisper", "guard", "tts", "embed", "embedding",
    "orpheus", "canopylabs", "vision", "distil-whisper",
    "compound", "preview", "speech", "transcription",
)



class RateLimitError(Exception):
    """Raised when Groq API returns 429 rate limit response."""
    pass


class GroqClient:
    """Groq LLM client for scoring a student's projects against a job.

    The chat model is resolved dynamically from the live API rather than
    being hardcoded, so a valid key keeps working even after a provider
    retires a particular model. A model may still be pinned via the
    GROQ_MODEL env var, but that is optional.
    """

    def __init__(self, api_key: str, model: Optional[str] = None):
        # Keep the API key for checks later.
        self.api_key = (api_key or "")
        self._model = (model or GROQ_MODEL or "").strip() or None

        # Try to import the real SDK, but never raise on import failure.
        self._available = False
        self._import_error = None
        self._init_error = None
        try:
            from groq import Groq  # type: ignore
            try:
                self.client = Groq(api_key=self.api_key, timeout=15.0)
                self._available = True
            except Exception as exc:
                self.client = None
                self._init_error = str(exc)
                logger.warning(f"Groq client init failed: {exc}")
        except Exception as exc:  # missing package or other import problem
            self.client = None
            self._import_error = str(exc)
            logger.warning(f"Groq import failed: {exc}")

    # ── Model discovery ───────────────────────────────────────────
    def available_models(self) -> list[str]:
        """Return the chat-capable model ids this key can access."""
        if not self._available or not self.client:
            raise RuntimeError("Groq SDK not available")
        resp = self.client.models.list()
        data = getattr(resp, "data", resp) or []
        ids = []
        for m in data:
            mid = getattr(m, "id", None) or (m.get("id") if isinstance(m, dict) else None)
            if not mid:
                continue
            low = mid.lower()
            if any(h in low for h in _NON_CHAT_HINTS):
                continue
            ids.append(mid)
        return ids

    @property
    def model(self) -> str:
        """The chat model to use — pinned, else auto-selected from the API."""
        if self._model:
            return self._model
        try:
            ids = self.available_models()
        except Exception:
            ids = []
        # Prefer a known-good ordering, but fall back to whatever exists.
        for pref in GROQ_MODEL_PREFERENCES:
            if pref in ids:
                self._model = pref
                return self._model
        self._model = ids[0] if ids else "llama-3.1-8b-instant"
        return self._model

    # ── Public API ────────────────────────────────────────────────
    def analyze_project(self, student: dict, project_text: str, job: dict) -> Optional[dict]:
        """Score one student's combined project text against one job.

        Returns the parsed result dict on success, or ``None`` on a hard
        API failure (SDK missing, quota / rate-limit exhausted, network).
        Returning ``None`` — rather than a score-0 placeholder — lets the
        scorer fall back to keyword + semantic scoring and report an honest
        ``api_used`` instead of a misleading ``project_score`` of 0.
        """
        if not self._available or not self.client:
            return None

        # Cap project_text to 4000 chars so Groq has full token headroom for the 500+ word JSON output
        safe_project_text = (project_text or "")[:4000]

        prompt = self._build_prompt(student, safe_project_text, job)
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a JSON-only API. You output only valid JSON "
                    "objects. Never add explanations, markdown, or text "
                    "outside the JSON."
                ),
            },
            {"role": "user", "content": prompt},
        ]

        # Call with rate-limit-aware retry. If the API never responds
        # (quota exhausted / network), let it raise → scorer falls back.
        try:
            response = self._call_with_retry(messages, max_tokens=4096)
        except RateLimitError:
            # Propagate so the scorer's KeyRotator can rotate to another key
            # on a 429 / quota hit. Swallowing this (returning None) would
            # break multi-key rotation — the scorer would never see the 429.
            raise
        except Exception as exc:
            logger.warning(f"Groq analyze_project failed (no response): {exc}")
            return None

        text = (response.choices[0].message.content or "")
        try:
            result = self._extract_json(text)
        except Exception as exc:
            # Log the actual response so the failure is debuggable.
            logger.warning(f"[GROQ JSON PARSE ERROR] {exc}")
            logger.warning(f"[GROQ RAW RESPONSE] {text[:500]}")
            # One repair attempt: force a strict JSON-only reply.
            try:
                retry_prompt = (
                    "Your previous response could not be parsed as JSON. "
                    "Return ONLY this JSON object, nothing else, no markdown:\n"
                    '{"project_score":0,"skills_matched":[],"skills_missing":[],'
                    '"project_summary":"","technical_analysis":"","skills_matched_detail":"",'
                    '"skills_gap_detail":"","strengths":"","recommendation":"","content_quality":0}'
                    f"\n\nOriginal task result: {text[:400]}"
                )
                r2 = self._call_with_retry(
                    [{"role": "user", "content": retry_prompt}], max_tokens=4096
                )
                result = self._extract_json(r2.choices[0].message.content or "")
            except Exception:
                return self._default_result()

        # Validate required fields exist and coerce/clamp into range.
        result.setdefault("project_score", 0)
        result.setdefault("skills_matched", [])
        result.setdefault("skills_missing", [])
        result.setdefault("project_summary", "")
        result.setdefault("technical_analysis", "")
        result.setdefault("skills_matched_detail", "")
        result.setdefault("skills_gap_detail", "")
        result.setdefault("strengths", "")
        result.setdefault("recommendation", "")
        result.setdefault("content_quality", 0)
        try:
            result["project_score"] = max(0, min(100, int(float(result["project_score"]))))
        except Exception:
            result["project_score"] = 0
        try:
            result["content_quality"] = max(0, min(10, int(float(result["content_quality"]))))
        except Exception:
            result["content_quality"] = 0
        if not isinstance(result["skills_matched"], list):
            result["skills_matched"] = []
        if not isinstance(result["skills_missing"], list):
            result["skills_missing"] = []

        return result

    def _call_with_retry(self, messages, max_retries: int = 3,
                         temperature: float = 0.1, max_tokens: int = 4096):
        """Create a chat completion.

        On a rate-limit / quota (429) error, raise ``RateLimitError`` right
        away so the key rotator can switch to another key instead of blocking
        on a single one. Transient timeouts get a short retry.
        """
        for attempt in range(max_retries):
            try:
                return self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            except Exception as e:
                error_str = str(e).lower()
                if ("429" in error_str or "rate" in error_str
                        or "limit" in error_str or "quota" in error_str
                        or "too many" in error_str):
                    raise RateLimitError(f"Groq rate limit hit: {e}")
                if "timeout" in error_str and attempt < max_retries - 1:
                    time.sleep(5)
                    continue
                raise e
        # Should not reach here (loop returns or raises), but be safe.
        raise RuntimeError("Groq call failed after retries")

    def _extract_json(self, text: str) -> dict:
        """Robustly extract a JSON object from an AI response.

        Handles markdown code fences, preamble / trailing text, and stray
        single-quoted keys or string values.
        """
        import re

        text = (text or "").strip()
        # Strip markdown code fences.
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
        text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE)
        text = text.strip()

        # Grab the first {...} block (tolerates extra text around it).
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            raise ValueError(f"No JSON object found in response: {text[:200]}")
        json_str = match.group(0)

        # Repair common single-quote mistakes on keys / string values.
        json_str = re.sub(r"'([^']*)':", r'"\1":', json_str)
        json_str = re.sub(r":\s*'([^']*)'", r': "\1"', json_str)

        return json.loads(json_str)

    def analyze_jd(self, job_title: str, jd_text: str, required_skills: list) -> str:
        """Analyze a Job Description and return a detailed plain-text evaluation."""
        if not self._available or not self.client:
            return ""
        skills_str = ", ".join(required_skills) if required_skills else "Not specified"
        prompt = f"""You are an expert technical recruiter analyzing a Job Description.

JOB TITLE: {job_title}
REQUIRED SKILLS: {skills_str}
JOB DESCRIPTION:
{jd_text[:4000] if jd_text else 'No description provided.'}

Provide a structured analysis covering:
1. Role Overview — What is this role about?
2. Key Technical Skills Required — List and explain each skill
3. Suitability Assessment — What type of candidate fits best?
4. Strengths of this JD — What makes it attractive?
5. Gaps or Improvements — What is missing or unclear in the JD?
6. Keywords & Themes — Core technical themes and concepts

Be specific, technical, and thorough. Plain text format only."""
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are an expert technical recruiter."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
                max_tokens=2000,
            )
            return (response.choices[0].message.content or "").strip()
        except Exception:
            return ""


    def _wrap_result(self, success: bool, **kwargs) -> dict:
        """Return consistent status dict used by admin connection tests."""
        if success:
            return {"success": True, "model": kwargs.get("model", "auto-detected from your key")}
        return {"success": False, **kwargs}

    def test_connection(self) -> Union[dict, bool]:
        """Verify the API key with retries. Returns dict (detailed) or bool for backward compatibility.

        Behavior:
          - If SDK missing: return structured failure
          - If api_key empty: return structured failure
          - On success: return structured success
        """
        # 1) Missing SDK
        if not self._available:
            return self._wrap_result(False, error="Groq module not installed",
                                     solution="Run: pip install groq")

        # 2) Missing API key
        if not self.api_key:
            return self._wrap_result(False, error="API key not provided")

        # 3) Try listing models with retries
        last_exc = None
        for attempt in range(3):
            try:
                ok = len(self.available_models()) > 0
                if ok:
                    # Cache model selection
                    _ = self.model
                    return self._wrap_result(True, model=self._model or "auto-detected from your key")
                last_exc = RuntimeError("no models available for this key")
            except Exception as exc:
                last_exc = exc
                time.sleep(0.5)

        logger.error(f"Groq test_connection failed after retries: {last_exc}")
        return self._wrap_result(False, error=f"Connection failed: {last_exc}")

    

    # ── Internals ─────────────────────────────────────────────────
    def _build_prompt(self, student: dict,
                      project_text: str, job: dict) -> str:
        return f"""You are a senior technical recruitment expert and
engineering project evaluator. Perform a DEEP, COMPREHENSIVE analysis.

STUDENT INFORMATION
Name: {student.get('name', 'Unknown')}
Branch: {student.get('branch', 'Unknown')}
ATS Score: {student.get('ats_score', 0)}/100

COMPLETE PROJECT CONTENT
{project_text}

JOB REQUIREMENTS
Job Title: {job.get('job_title', 'Unknown')}
Company: {job.get('company_name', 'Unknown')}
Required Skills: {job.get('required_skills', [])}
Experience Required: {job.get('experience_required', 'Not specified')}
Full Job Description:
{str(job.get('full_jd_text', ''))[:2000]}

YOUR ANALYSIS TASK
Write a DETAILED evaluation covering ALL 6 sections below.
Minimum 500 words total. Ground everything in the project content.

Section 1 - PROJECT OVERVIEW (80-100 words):
Describe exactly what the student built. Purpose, functionality,
all components and technologies identified in the project.

Section 2 - TECHNICAL DEPTH (100-120 words):
Evaluate complexity and sophistication. What engineering concepts
are demonstrated? How advanced is the implementation?

Section 3 - SKILLS MATCHED (80-100 words):
Every skill from job requirements present in the project.
Quote specifically what you saw. Explain HOW each skill is shown.

Section 4 - SKILLS GAP (80-100 words):
Skills required for the job NOT present in the project.
For each gap explain why it matters. Suggest how to address it.

Section 5 - PROJECT STRENGTHS (60-80 words):
What is impressive or well-implemented. Be genuine.
Only mention strengths actually evidenced in the project content.

Section 6 - HIRING RECOMMENDATION (60-80 words):
Clear recommendation for or against hiring with justification.
State confidence level and what onboarding would be needed.

ACCURACY RULES:
- ONLY mention things ACTUALLY in the project content above
- Do NOT invent skills or components not present in the text
- If unsure, say "appears to show" not definitive statements
- If project content is limited, say so honestly

Return ONLY valid JSON. No markdown. Start with {{ end with }}.

{{
  "project_score": <integer 0-100>,
  "skills_matched": ["skill1", "skill2"],
  "skills_missing": ["skill3", "skill4"],
  "project_summary": "<Section 1 — minimum 80 words>",
  "technical_analysis": "<Section 2 — minimum 100 words>",
  "skills_matched_detail": "<Section 3 — minimum 80 words>",
  "skills_gap_detail": "<Section 4 — minimum 80 words>",
  "strengths": "<Section 5 — minimum 60 words>",
  "recommendation": "<Section 6 — minimum 60 words>",
  "content_quality": <integer 0-10>
}}"""

    def _parse_json(self, text: str) -> dict:
        """Strip markdown fences and parse; raises JSONDecodeError on bad JSON."""
        cleaned = text.replace("```json", "").replace("```", "").strip()
        # Some models add a preamble — grab the first {...} block.
        if not cleaned.startswith("{"):
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start != -1 and end != -1:
                cleaned = cleaned[start : end + 1]
        return self._normalise(json.loads(cleaned))

    def _retry_fix(self, bad_text: str) -> dict:
        try:
            fix_prompt = f"Fix this invalid JSON and return only valid JSON:\n{bad_text}"
            r2 = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": fix_prompt}],
                temperature=0,
                max_tokens=2000,
            )
            fixed = (r2.choices[0].message.content or "").strip()
            return self._parse_json(fixed)
        except Exception:
            return self._default_result()

    def _normalise(self, data: dict) -> dict:
        """Coerce the LLM output into the exact shape the scorer expects."""
        return {
            "project_score": int(float(data.get("project_score", 0) or 0)),
            "skills_matched": list(data.get("skills_matched", []) or []),
            "skills_missing": list(data.get("skills_missing", []) or []),
            "project_summary": str(data.get("project_summary", "") or ""),
            "recommendation": str(data.get("recommendation", "") or ""),
            "content_quality": int(float(data.get("content_quality", 0) or 0)),
        }

    def _default_result(self) -> dict:
        return {
            "project_score": 0,
            "skills_matched": [],
            "skills_missing": [],
            "project_summary": "Analysis failed",
            "recommendation": "Manual review required",
            "content_quality": 0,
        }
