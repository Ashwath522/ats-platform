"""
Fast, LLM-free ATS scoring.

Three signals combined:
1. Semantic similarity  - cosine similarity between resume embedding and JD embedding
                           (captures meaning, not just exact words)
2. Skill coverage       - which known skills appear in the JD but are missing from
                           the resume + skills extracted from raw JD text itself
3. Experience fit       - light score for year-of-experience requirement vs. resume years

All run in milliseconds on CPU. No network/API calls, so this is safe to run on
every dashboard refresh without latency issues. An LLM is only worth calling later,
optionally, to turn the missing-skill list into prose suggestions.

Formula: 0.70 * semantic + 0.25 * skill_coverage + 0.05 * exp_fit
Score calibration: strong raw combined scores are nudged toward the 75–90 range
that commercial ATS tools typically report, while keeping perfect matches at 100.
"""
import re
import math
from typing import Dict, List, Optional, Set

from .skills_vocab import KNOWN_SKILLS, SKILL_ALIASES, BRANCH_SKILLS


# ---------------------------------------------------------------------------
# Skill extraction helpers
# ---------------------------------------------------------------------------

def _extract_skills_present(text: str, branch: Optional[str] = None) -> List[str]:
    """Which known skills literally appear in this text (case-insensitive, word-boundary safe)."""
    text_lower = text.lower()
    found: Set[str] = set()

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


def _extract_jd_tech_tokens(jd_text: str, min_len: int = 3) -> Set[str]:
    """
    Extract likely technical terms from raw JD text beyond the fixed skills vocab.
    Uses a heuristic: tokens that are CamelCase, ALL_CAPS, or hyphenated/dotted
    identifiers that appear in technical JDs (e.g. gRPC, CI/CD, REST, OAuth2).

    Returns a set of lowercase strings for fast lookup. These are used as an
    *additional* signal for skill coverage — if a term appears in the JD but not
    the resume, it counts as a weak missing skill.
    """
    # Find tokens that look technical: CamelCase, ALL-CAPS, slash-separated, dot-versioned
    camel_case = re.findall(r'\b[A-Z][a-z]+[A-Z][a-zA-Z]*\b', jd_text)  # CamelCase
    all_caps = re.findall(r'\b[A-Z]{2,10}\b', jd_text)                    # REST, SQL, API
    slash_sep = re.findall(r'\b[A-Za-z]+/[A-Za-z]+\b', jd_text)          # CI/CD, gRPC
    dotted = re.findall(r'\b[A-Za-z][A-Za-z0-9]*\.[Jjvj][Ssx]\b', jd_text)  # Next.js, Vue.js

    raw = set(camel_case + all_caps + slash_sep + dotted)

    # Exclude very common English stop-words masquerading as caps
    stopwords = {
        "The", "We", "You", "Our", "If", "In", "On", "Is", "At", "As", "To",
        "A", "An", "AND", "OR", "FOR", "TO", "OF", "IN", "WITH", "THE",
        "WILL", "CAN", "BE", "NEW", "GET", "SET", "USE", "ONE", "MUST",
        "YOU", "ALL", "ANY", "FROM", "BY", "UP", "NOT", "ARE", "HAS",
    }

    return {t.lower() for t in raw if t not in stopwords and len(t) >= min_len}


# ---------------------------------------------------------------------------
# Similarity math
# ---------------------------------------------------------------------------

def cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    if len(vec_a) != len(vec_b):
        return 0.0
    norm_a = math.sqrt(sum(x * x for x in vec_a))
    norm_b = math.sqrt(sum(x * x for x in vec_b))
    denom = norm_a * norm_b
    if denom == 0:
        return 0.0
    return float(sum(a * b for a, b in zip(vec_a, vec_b)) / denom)


# ---------------------------------------------------------------------------
# Experience helpers
# ---------------------------------------------------------------------------

def estimate_experience_years(text: str) -> float:
    matches = re.findall(r"(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp)", text, flags=re.IGNORECASE)
    if not matches:
        return 0.0
    return max(float(m) for m in matches)


def _experience_fit_score(resume_text: str, jd_text: str) -> float:
    """
    Returns 0.0–1.0 for how well the resume's years of experience satisfy the JD.
    - 1.0 if JD doesn't mention a years requirement or candidate meets/exceeds it
    - Partial credit if candidate is close (within 2 years)
    - 0.3 minimum so this signal doesn't dominate for fresh roles
    """
    jd_years = estimate_experience_years(jd_text)
    if jd_years == 0.0:
        return 1.0  # No requirement stated — full credit

    resume_years = estimate_experience_years(resume_text)
    if resume_years >= jd_years:
        return 1.0
    if resume_years == 0.0:
        return 0.3  # Unknown — give some credit

    # Partial credit: score = max(0.3, 1 - gap/requirement)
    gap = jd_years - resume_years
    return max(0.3, 1.0 - gap / jd_years)


# ---------------------------------------------------------------------------
# Score calibration
# ---------------------------------------------------------------------------

def _calibrate_score(raw: float) -> float:
    """
    Map raw [0, 1] combined score to a calibrated [0, 100] that feels competitive
    compared to commercial ATS tools:

    - Perfect raw (1.0)  → 100
    - Strong (≥ 0.70)    → 78–95 range
    - Medium (0.45–0.70) → 55–78 range
    - Weak (< 0.45)      → 0–55 range

    Uses a piecewise linear approach for interpretability (no hidden sigmoid).
    The breakpoints were chosen so that a solid skills match + good semantic
    similarity (~0.65–0.80 raw) lands in the 75–90 range that commercial tools
    typically report for strong candidates.
    """
    r = max(0.0, min(1.0, raw))

    if r == 1.0:
        return 100.0

    # Breakpoints: (raw, calibrated)
    breakpoints = [
        (0.00, 0.0),
        (0.30, 20.0),
        (0.45, 42.0),
        (0.60, 62.0),
        (0.70, 75.0),
        (0.80, 85.0),
        (0.90, 93.0),
        (1.00, 100.0),
    ]

    for i in range(len(breakpoints) - 1):
        r0, c0 = breakpoints[i]
        r1, c1 = breakpoints[i + 1]
        if r0 <= r <= r1:
            t = (r - r0) / (r1 - r0)
            return c0 + t * (c1 - c0)

    return r * 100.0


# ---------------------------------------------------------------------------
# Main scoring entry point
# ---------------------------------------------------------------------------

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
        "keyword_coverage": 0-1 float or null (see jd_has_recognized_skills),
        "matched_skills": [...],
        "missing_skills": [...],   # present in JD, absent from resume
        "jd_has_recognized_skills": bool,
        "experience_years": float,
      }
    """
    semantic_sim = cosine_similarity(resume_embedding, jd_embedding)

    # Fixed-vocab skill extraction
    jd_skills = set(_extract_skills_present(jd_text, branch))
    resume_skills = set(_extract_skills_present(resume_text, branch))

    # Additional JD terms from raw text (e.g. CamelCase, ALL_CAPS tokens)
    jd_raw_tokens = _extract_jd_tech_tokens(jd_text)

    # Build an extended JD skill set that includes raw tokens mapped to vocab
    # (those that exactly match a known skill's canonical lower form already
    # covered; raw tokens add a "soft" penalty for uncovered tech terms)
    resume_text_lower = resume_text.lower()
    raw_missing = {
        tok for tok in jd_raw_tokens
        if tok not in resume_text_lower
        and len(tok) >= 3
    }
    # Only count raw tokens that aren't already covered by vocab extraction
    vocab_lower = {s.lower() for s in jd_skills | resume_skills}
    raw_missing -= vocab_lower

    matched = sorted(jd_skills & resume_skills)
    missing_vocab = sorted(jd_skills - resume_skills)

    jd_has_recognized_skills = len(jd_skills) > 0

    if jd_has_recognized_skills:
        vocab_coverage = len(matched) / len(jd_skills)

        # Soft penalty for uncovered raw-text terms (limited impact: max 15% drag)
        n_raw = len(jd_raw_tokens)
        if n_raw > 0:
            raw_coverage = max(0.0, 1.0 - len(raw_missing) / n_raw)
            # Blend: 85% vocab coverage + 15% raw-text coverage
            keyword_coverage = 0.85 * vocab_coverage + 0.15 * raw_coverage
        else:
            keyword_coverage = vocab_coverage

        # Experience fit (small contribution when easily detectable)
        exp_fit = _experience_fit_score(resume_text, jd_text)

        # Formula: 0.55 semantic + 0.40 skill_coverage + 0.05 experience_fit
        raw_combined = (0.55 * semantic_sim) + (0.40 * keyword_coverage) + (0.05 * exp_fit)
    else:
        # Can't claim "0 missing skills" — fall back to semantic similarity alone
        keyword_coverage = None
        raw_combined = semantic_sim

    calibrated = _calibrate_score(raw_combined)
    ats_score = round(calibrated)

    return {
        "ats_score": ats_score,
        "semantic_similarity": round(semantic_sim, 4),
        "keyword_coverage": round(keyword_coverage, 4) if keyword_coverage is not None else None,
        "jd_has_recognized_skills": jd_has_recognized_skills,
        "experience_years": estimate_experience_years(resume_text),
        "matched_skills": matched,
        "missing_skills": missing_vocab,  # vocab-level missing (shown to user)
    }
