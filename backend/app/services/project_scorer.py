"""
backend/app/services/project_scorer.py
──────────────────────────────────────
Evaluates a candidate's project/repo portfolio against a Job Description.
Combines:
  1. Keyword taxonomy matching (from keyword_extractor)
  2. Semantic embedding similarity (from embeddings)
  3. LLM reasoning (Gemini / Groq / fallback)
Guarantees a safe fallback path so batches never crash or raise exceptions.
Calculates composite final_score:
  final_score = REPO_WEIGHT_ATS * ats_score + REPO_WEIGHT_PROJECT * project_score
"""
import os
import logging
from typing import Optional, Dict, Any

from ..config import REPO_WEIGHT_ATS, REPO_WEIGHT_PROJECT
from .keyword_extractor import extract_keywords, match_keywords
from .embeddings import EmbeddingModel
from .scoring import cosine_similarity

logger = logging.getLogger("project_scorer")


def score_project(
    application: Any,
    job: Any,
    project_text: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Score a candidate's project portfolio against a job description.
    Delegates to the canonical score_student_job from scorer.py, guaranteeing
    exact methodological consistency between candidate and recruiter scoring paths.
    Never raises an exception — uses deterministic fallback on any failure.
    """
    try:
        from .scorer import score_student_job

        # 1. Resolve project text
        text_to_evaluate = project_text or getattr(application, "project_summary", "") or ""
        if not text_to_evaluate:
            text_to_evaluate = getattr(application, "project_fit", "") or "No project portfolio uploaded."

        jd_text = getattr(job, "description", "") or getattr(job, "full_jd_text", "") or ""
        job_title = getattr(job, "title", "") or ""
        branch = getattr(job, "branch", None)
        ats_score = float(getattr(application, "ats_score", 0) or 0)
        candidate_name = f"Candidate_{getattr(application, 'candidate_id', 'Unknown')}"

        student = {"name": candidate_name, "branch": branch, "ats_score": ats_score}
        job_dict = {"job_title": job_title, "full_jd_text": jd_text, "description": jd_text}

        # 2. Score using canonical pipeline (Groq -> Gemini -> local fallback)
        res = score_student_job(student, [text_to_evaluate], job_dict)

        reasoning = (
            res.get("ai_recommendation")
            or res.get("technical_analysis")
            or res.get("project_summary")
            or ""
        )
        if not reasoning:
            reasoning = f"Evaluated via {res.get('api_used', 'fallback')}."

        return {
            "project_score": res["project_score"],
            "final_score": res["final_score"],
            "project_summary": text_to_evaluate,
            "reasoning": reasoning,
            "skills_matched": res.get("skills_matched", []),
            "skills_missing": res.get("skills_missing", []),
            "method": res.get("api_used", "fallback"),
        }

    except Exception as fatal_err:
        logger.error(f"[PROJECT_SCORER] Fatal error caught in score_project: {fatal_err}")
        ats_fallback = float(getattr(application, "ats_score", 50) or 50)
        return {
            "project_score": 50.0,
            "final_score": round((REPO_WEIGHT_ATS * ats_fallback) + (REPO_WEIGHT_PROJECT * 50.0), 1),
            "project_summary": getattr(application, "project_summary", "") or "Evaluation fallback.",
            "reasoning": "Standard evaluation fallback applied.",
            "skills_matched": [],
            "skills_missing": [],
            "method": "emergency_fallback",
        }

