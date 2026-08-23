"""
Fast, LLM-free ATS scoring.

Two signals combined:
1. Semantic similarity  - cosine similarity between resume embedding and JD embedding
                           (captures meaning, not just exact words)
2. Keyword coverage      - which known skills appear in the JD but are missing from
                           the resume (this is the "what's missing" feedback)

Both run in milliseconds on CPU. No network/API calls, so this is safe to run on
every dashboard refresh or every candidate->company selection without latency issues.
An LLM is only worth calling later, optionally, to turn the missing-skill list into
prose suggestions - that step is NOT in this file, keep it separate and cache it.
"""
import re
import math
from typing import Dict, List

from .skills_vocab import KNOWN_SKILLS, SKILL_ALIASES, BRANCH_SKILLS


def _extract_skills_present(text: str, branch: Optional[str] = None) -> List[str]:
    """Which known skills literally appear in this text (case-insensitive, word-boundary safe)."""
    text_lower = text.lower()
    found = set()

    # Determine match list based on branch
    active_skills = list(KNOWN_SKILLS)
    if branch and branch in BRANCH_SKILLS:
        active_skills = list(BRANCH_SKILLS[branch])

    # Dynamic Vocabulary Promotion (seen in 3+ resumes)
    try:
        from ..db import engine, DiscoveredSkill
        from sqlmodel import Session, select
        with Session(engine) as session:
            promoted = session.exec(
                select(DiscoveredSkill)
                .where(DiscoveredSkill.occurrence_count >= 3)
            ).all()
            for ds in promoted:
                # If branch matches or skill is branch-agnostic (None) or match is global
                if not branch or not ds.branch or ds.branch == branch:
                    if ds.term not in active_skills:
                        active_skills.append(ds.term)
    except Exception:
        pass

    for skill in active_skills:
        pattern = r"(?<!\w)" + re.escape(skill.lower()) + r"(?!\w)"
        if re.search(pattern, text_lower):
            found.add(skill)

    # Filter aliases to match only canonical terms in the active branch
    active_set = set(active_skills)
    for alias, canonical in SKILL_ALIASES.items():
        if canonical in active_set:
            pattern = r"(?<!\w)" + re.escape(alias.lower()) + r"(?!\w)"
            if re.search(pattern, text_lower):
                found.add(canonical)

    return sorted(found)


def cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    if len(vec_a) != len(vec_b):
        return 0.0
    norm_a = math.sqrt(sum(x * x for x in vec_a))
    norm_b = math.sqrt(sum(x * x for x in vec_b))
    denom = norm_a * norm_b
    if denom == 0:
        return 0.0
    return float(sum(a * b for a, b in zip(vec_a, vec_b)) / denom)


def estimate_experience_years(text: str) -> float:
    matches = re.findall(r"(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp)", text, flags=re.IGNORECASE)
    if not matches:
        return 0.0
    return max(float(match) for match in matches)


def score_resume_against_jd(
    resume_text: str,
    jd_text: str,
    resume_embedding: List[float],
    jd_embedding: List[float],
    branch: Optional[str] = None,
) -> Dict:
    """
    Returns:
      {
        "ats_score": 0-100 int,
        "semantic_similarity": 0-1 float,
        "keyword_coverage": 0-1 float,
        "matched_skills": [...],
        "missing_skills": [...],   # present in JD, absent from resume - the "what's missing"
      }
    """
    semantic_sim = cosine_similarity(resume_embedding, jd_embedding)  # roughly 0..1 with normalized embeddings

    jd_skills = set(_extract_skills_present(jd_text, branch))
    resume_skills = set(_extract_skills_present(resume_text, branch))

    matched = sorted(jd_skills & resume_skills)
    missing = sorted(jd_skills - resume_skills)

    keyword_coverage = (len(matched) / len(jd_skills)) if jd_skills else 1.0

    # Blend: semantic similarity captures overall fit, keyword coverage captures
    # literal ATS-style keyword matching (what real ATS systems actually filter on).
    combined = (0.5 * semantic_sim) + (0.5 * keyword_coverage)
    ats_score = round(max(0.0, min(1.0, combined)) * 100)

    return {
        "ats_score": ats_score,
        "semantic_similarity": round(semantic_sim, 4),
        "keyword_coverage": round(keyword_coverage, 4),
        "experience_years": estimate_experience_years(resume_text),
        "matched_skills": matched,
        "missing_skills": missing,
    }
