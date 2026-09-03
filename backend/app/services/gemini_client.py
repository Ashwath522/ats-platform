from typing import Union
from typing import Optional
"""
ai/gemini_client.py
───────────────────
Google Gemini client. Provides the same analyze_project() contract as
GroqClient (so they're interchangeable in the scorer) plus image
analysis for the vision parser.
"""

import json
import io
import time
import logging

import os
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-1.5-flash")
GEMINI_MODEL_PREFERENCES = [
    "gemini-1.5-pro",
    "gemini-1.5-flash",
]

# Server logger
logger = logging.getLogger("corelink")
handler = logging.FileHandler("server.log")
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
if not logger.handlers:
    logger.addHandler(handler)
logger.setLevel(logging.INFO)


class RateLimitError(Exception):
    """Raised when Gemini API returns rate limit / quota error."""
    pass


class GeminiClient:
    """Gemini LLM + Vision client.

    Like GroqClient, the generation model is discovered dynamically from the
    live API instead of being hardcoded, so a valid key keeps working even
    after Google retires a specific model name. A model may be pinned via the
    GEMINI_MODEL env var, but that is optional.
    """

    def __init__(self, api_key: str, model: Optional[str] = None):
        raw_key = (api_key or "").strip()
        if "," in raw_key:
            raw_key = raw_key.split(",")[0].strip()
        self.api_key = raw_key
        self._model_name = (model or GEMINI_MODEL or "").strip() or None
        self._model = None  # the GenerativeModel, built lazily

        # Safe import + init
        self._available = False
        self._import_error = None
        self._init_error = None
        try:
            import google.generativeai as genai  # type: ignore
            try:
                genai.configure(api_key=self.api_key)
                self._genai = genai
                self._available = True
            except Exception as exc:
                self._genai = None
                self._init_error = str(exc)
                logger.warning(f"Gemini client init failed: {exc}")
        except Exception as exc:
            self._genai = None
            self._import_error = str(exc)
            logger.warning(f"Gemini import failed: {exc}")

    # ── Model discovery ───────────────────────────────────────────
    def available_models(self) -> list[str]:
        """Return model names that support text generation for this key."""
        if not self._available or not self._genai:
            raise RuntimeError("Gemini SDK not available")
        names = []
        for m in self._genai.list_models():
            methods = getattr(m, "supported_generation_methods", []) or []
            if "generateContent" in methods:
                # Normalise 'models/gemini-1.5-flash' → 'gemini-1.5-flash'.
                names.append(getattr(m, "name", "").split("/")[-1])
        return [n for n in names if n]

    def _resolve_model_name(self) -> str:
        if self._model_name:
            return self._model_name
        try:
            names = self.available_models()
        except Exception:
            names = []
        for pref in GEMINI_MODEL_PREFERENCES:
            if pref in names:
                self._model_name = pref
                return self._model_name
        self._model_name = names[0] if names else "gemini-1.5-flash"
        return self._model_name

    @property
    def model(self):
        """A GenerativeModel built from the resolved (dynamic) model name."""
        if self._model is None:
            self._model = self._genai.GenerativeModel(self._resolve_model_name())
        return self._model

    # ── Text scoring (mirrors GroqClient) ─────────────────────────
    def analyze_project(self, student: dict, project_text: str, job: dict) -> Optional[dict]:
        """Score one student's combined project text against one job.

        Returns the parsed result dict on success, or ``None`` on a hard
        API failure (SDK missing, quota / rate-limit exhausted, network).
        Returning ``None`` lets the scorer fall back to keyword + semantic
        scoring and report an honest ``api_used`` instead of a misleading
        ``project_score`` of 0.
        """
        if not self._available or not self._genai:
            return None

        # Cap project_text to 4000 chars so Gemini has full token headroom for the 500+ word JSON output
        safe_project_text = (project_text or "")[:4000]

        prompt = (
            "You are a JSON-only API. You output only valid JSON objects. "
            "Never add explanations, markdown, or text outside the JSON.\n\n"
            + self._build_prompt(student, safe_project_text, job)
        )

        from .llm_telemetry import trace_llm_call

        # Call with rate-limit-aware retry. If the API never responds
        # (quota exhausted / network), let it raise → scorer falls back.
        try:
            with trace_llm_call("gemini", self._resolve_model_name(), "analyze_project", {"prompt_len": len(prompt)}) as trace:
                response = self._call_with_retry(prompt)
                trace["response_len"] = len(response.text or "") if hasattr(response, "text") else 0
        except RateLimitError:
            # Propagate so the scorer's KeyRotator can rotate to another key
            # on a 429 / quota hit. Swallowing this (returning None) would
            # break multi-key rotation — the scorer would never see the 429.
            raise
        except Exception as exc:
            logger.warning(f"Gemini analyze_project failed (no response): {exc}")
            return None

        try:
            text = (response.text or "")
        except Exception as exc:
            logger.warning(f"Gemini response had no text: {exc}")
            return None

        try:
            result = self._extract_json(text)
        except Exception as exc:
            # Log the actual response so the failure is debuggable.
            logger.warning(f"[GEMINI JSON PARSE ERROR] {exc}")
            logger.warning(f"[GEMINI RAW RESPONSE] {text[:500]}")
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
                r2 = self._call_with_retry(retry_prompt)
                result = self._extract_json(r2.text or "")
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

    def _call_with_retry(self, prompt, max_retries: int = 3):
        """Generate content.

        On a rate-limit / quota error, raise ``RateLimitError`` right away so
        the key rotator can switch to another key instead of blocking on a
        single one. Transient timeouts get a short retry.
        """
        config = None
        if self._genai:
            try:
                config = self._genai.types.GenerationConfig(
                    max_output_tokens=4096,
                    temperature=0.1,
                )
            except Exception:
                config = {'max_output_tokens': 4096, 'temperature': 0.1}

        for attempt in range(max_retries):
            try:
                return self.model.generate_content(
                    prompt,
                    generation_config=config,
                    request_options={"timeout": 15.0}
                )
            except Exception as e:
                error_str = str(e).lower()
                if ('429' in error_str or 'quota' in error_str
                        or 'rate' in error_str or 'limit' in error_str
                        or 'exhausted' in error_str or 'resource' in error_str):
                    raise RateLimitError(f"Gemini rate limit hit: {e}")
                if 'timeout' in error_str and attempt < max_retries - 1:
                    time.sleep(5)
                    continue
                raise e
        # Should not reach here (loop returns or raises), but be safe.
        raise RuntimeError("Gemini call failed after retries")

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

        # Try parsing full text first if it starts with { and ends with }
        if text.startswith("{") and text.endswith("}"):
            try:
                return json.loads(text)
            except Exception:
                pass

        # Grab the first {...} block (tolerates extra text around it).
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            # Try to fix unclosed trailing JSON
            first_brace = text.find("{")
            if first_brace != -1:
                candidate = text[first_brace:]
                # Check for truncated string and close it
                if candidate.count('"') % 2 != 0:
                    candidate += '"'
                # Close any open arrays and objects
                open_brackets = candidate.count('[') - candidate.count(']')
                open_braces = candidate.count('{') - candidate.count('}')
                candidate += (']' * max(0, open_brackets)) + ('}' * max(0, open_braces))
                try:
                    return json.loads(candidate)
                except Exception:
                    pass
            raise ValueError(f"No JSON object found in response: {text[:200]}")
        json_str = match.group(0)

        # Repair common single-quote mistakes on keys / string values.
        json_str = re.sub(r"'([^']*)':", r'"\1":', json_str)
        json_str = re.sub(r":\s*'([^']*)'", r': "\1"', json_str)

        return json.loads(json_str)

    def analyze_jd(self, job_title: str, jd_text: str, required_skills: list) -> str:
        """Analyze a Job Description and return a detailed plain-text evaluation."""
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
            response = self.model.generate_content(prompt)
            return (response.text or "").strip()
        except Exception:
            return ""


    # ── Vision ────────────────────────────────────────────────────
    def analyze_image(self, image_bytes: bytes) -> str:
        """Describe an engineering image. Returns plain text."""
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes))
        prompt = (
            "You are an engineering project analyzer.\n"
            "Analyze this image and describe:\n"
            "1. Project type and engineering domain\n"
            "2. All visible components and technologies\n"
            "3. What the project does\n"
            "4. Technical keywords and skills demonstrated\n"
            "5. Complexity level (Basic/Intermediate/Advanced)\n"
            "Be specific and technical. Plain text only."
        )
        response = self.model.generate_content([prompt, img])
        return (response.text or "").strip()

    def test_connection(self) -> bool:
        """Verify the API key WITHOUT binding to a specific model.

        We only list the models the key can access — a valid key returns a
        non-empty list of generateContent-capable models. This avoids false
        "connection failed" errors from a hardcoded/retired model name.
        """
        # Missing SDK
        if not self._available:
            return {"success": False, "error": "Gemini module not installed",
                    "solution": "Run: pip install google-generativeai"}

        # Missing API key
        if not self.api_key:
            return {"success": False, "error": "API key not provided"}

        # Try with retries
        last_exc = None
        for attempt in range(3):
            try:
                ok = len(self.available_models()) > 0
                if ok:
                    return {"success": True, "model": self._resolve_model_name()}
                last_exc = RuntimeError("no models available for this key")
            except Exception as exc:
                last_exc = exc
                time.sleep(0.5)
        logger.error(f"Gemini test_connection failed after retries: {last_exc}")
        return {"success": False, "error": f"Connection failed: {last_exc}"}

    # ── Internals (shared shape with GroqClient) ──────────────────
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

Section 7 - RISK NOTES (40-60 words):
Assess reliability of the evidence. Note any thin evidence, missing files (like missing code but having a report), or mismatches between claims and actual proof in the text.

ACCURACY RULES:
- ONLY mention things ACTUALLY in the project content above
- MUST cite concrete signals directly from the parsed files (e.g. specific modules, tech stack, architectures, methods, diagrams). Do not just trust descriptions.
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
  "risk_notes": "<Section 7 — minimum 40 words>",
  "content_quality": <integer 0-10>
}}"""

    def _parse_json(self, text: str) -> dict:
        cleaned = text.replace("```json", "").replace("```", "").strip()
        if not cleaned.startswith("{"):
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start != -1 and end != -1:
                cleaned = cleaned[start : end + 1]
        return self._normalise(json.loads(cleaned))

    def _retry_fix(self, bad_text: str) -> dict:
        try:
            fix_prompt = f"Fix this invalid JSON and return only valid JSON:\n{bad_text}"
            r2 = self.model.generate_content(fix_prompt)
            fixed = (r2.text or "").strip()
            return self._parse_json(fixed)
        except Exception:
            return self._default_result()

    def _normalise(self, data: dict) -> dict:
        return {
            "project_score": int(float(data.get("project_score", 0) or 0)),
            "skills_matched": list(data.get("skills_matched", []) or []),
            "skills_missing": list(data.get("skills_missing", []) or []),
            "project_summary": str(data.get("project_summary", "") or ""),
            "recommendation": str(data.get("recommendation", "") or ""),
            "risk_notes": str(data.get("risk_notes", "") or ""),
            "content_quality": int(float(data.get("content_quality", 0) or 0)),
        }

    def _default_result(self) -> dict:
        return {
            "project_score": 0,
            "skills_matched": [],
            "skills_missing": [],
            "project_summary": "Analysis failed",
            "recommendation": "Manual review required",
            "risk_notes": "Analysis failed",
            "content_quality": 0,
        }

    def generate_project_summary(self, content: str, description: str = "") -> str:
        """
        Generate a concise technical summary of an engineering project portfolio or repo.
        Falls back cleanly to local excerpt if LLM generation fails or is unconfigured.
        """
        if not content and not description:
            return "No project documentation provided."

        prompt = (
            "You are a senior engineering technical reviewer. Summarize this candidate's project "
            "portfolio concisely in 2-3 paragraphs. Highlight the core domain, technologies/frameworks used, "
            "architecture, and engineering complexity.\n\n"
            f"Candidate Description: {description}\n\n"
            f"Project Code & Content Excerpt:\n{content[:12000]}\n\n"
            "Summary:"
        )

        try:
            if getattr(self, "_available", False) and self.api_key:
                resp = self.model.generate_content(prompt, request_options={"timeout": 5.0})
                if resp and resp.text and resp.text.strip():
                    return resp.text.strip()
        except Exception as e:
            logger.warning(f"[GEMINI] generate_project_summary LLM failed: {e}")

        # Deterministic fallback summary
        desc_part = f"Description: {description.strip()}." if description.strip() else ""
        content_snippet = " ".join((content or "").split()[:100])
        snippet_part = f" Technical content highlights: {content_snippet}..." if content_snippet else ""
        return (f"{desc_part}{snippet_part} (Evaluated via local extraction fallback)").strip()

