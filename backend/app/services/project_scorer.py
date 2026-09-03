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
    Always returns a dictionary with project_score, final_score, and reasoning.
    Never raises an exception — uses deterministic fallback on any failure.
    """
    try:
        # 1. Resolve project text
        text_to_evaluate = project_text or getattr(application, "project_summary", "") or ""
        if not text_to_evaluate:
            text_to_evaluate = getattr(application, "project_fit", "") or "No project portfolio uploaded."

        jd_text = getattr(job, "description", "") or ""

        # 2. Keyword matching
        try:
            jd_kws = extract_keywords(jd_text)
            proj_kws = extract_keywords(text_to_evaluate)
            kw_match = match_keywords(proj_kws, jd_kws)
            keyword_score = float(kw_match.get("score", 0.0))
            matched_skills = kw_match.get("matched", [])
            missing_skills = kw_match.get("missing", [])
        except Exception as kw_err:
            logger.warning(f"[PROJECT_SCORER] Keyword matching error: {kw_err}")
            keyword_score = 50.0
            matched_skills = []
            missing_skills = []

        # 3. Semantic similarity
        try:
            emb_model = EmbeddingModel.get()
            proj_vec = emb_model.embed_text(text_to_evaluate[:4000])
            jd_vec = emb_model.embed_text(jd_text[:4000])
            semantic_score = round(cosine_similarity(proj_vec, jd_vec) * 100.0, 1)
            semantic_score = max(0.0, min(100.0, semantic_score))
        except Exception as sem_err:
            logger.warning(f"[PROJECT_SCORER] Semantic similarity error: {sem_err}")
            semantic_score = keyword_score

        # 4. LLM reasoning (Gemini / Groq if configured, else fallback)
        llm_score = None
        reasoning = ""
        method = "deterministic_fallback"

        gemini_key = os.environ.get("GEMINI_API_KEY", "")
        if gemini_key:
            try:
                from .gemini_client import GeminiClient
                g_client = GeminiClient(gemini_key)
                prompt = (
                    f"Evaluate this candidate project against the job requirements.\n\n"
                    f"Job Description:\n{jd_text[:3000]}\n\n"
                    f"Candidate Project Summary & Code Excerpt:\n{text_to_evaluate[:4000]}\n\n"
                    "Output a JSON object with keys: 'project_score' (integer 0-100), "
                    "'reasoning' (string 2-3 sentences), 'skills_matched' (list), 'skills_missing' (list)."
                )
                if getattr(g_client, "_available", False) and g_client.api_key:
                    resp = g_client.model.generate_content(prompt)
                    if resp and resp.text:
                        parsed = g_client._parse_json(resp.text)
                        llm_score = float(parsed.get("project_score", 0))
                        reasoning = parsed.get("reasoning", "")
                        if parsed.get("skills_matched"):
                            matched_skills = list(set(matched_skills + parsed["skills_matched"]))
                        method = "gemini"
            except Exception as llm_err:
                logger.warning(f"[PROJECT_SCORER] Gemini scoring failed: {llm_err}")

        # 5. Composite Project Score
        if llm_score is not None and llm_score > 0:
            # Blend LLM with keyword/semantic
            project_score = round((0.50 * llm_score) + (0.30 * keyword_score) + (0.20 * semantic_score), 1)
        else:
            # Deterministic fallback path
            project_score = round((0.60 * keyword_score) + (0.40 * semantic_score), 1)

        if not reasoning:
            reasoning = (
                f"Automated evaluation based on keyword overlap ({keyword_score}%) and "
                f"semantic alignment ({semantic_score}%). Matched: {', '.join(matched_skills[:5]) or 'General fit'}."
            )

        project_score = max(0.0, min(100.0, project_score))

        # 6. Composite final_score
        ats_score = float(getattr(application, "ats_score", 0) or 0)
        final_score = round((REPO_WEIGHT_ATS * ats_score) + (REPO_WEIGHT_PROJECT * project_score), 1)
        final_score = max(0.0, min(100.0, final_score))

        return {
            "project_score": project_score,
            "final_score": final_score,
            "project_summary": text_to_evaluate,
            "reasoning": reasoning,
            "skills_matched": matched_skills,
            "skills_missing": missing_skills,
            "method": method,
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
