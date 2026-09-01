"""
Tests for scoring.py - deliberately independent of the embedding model and
chromadb, since those need real network access. These test the pure logic:
cosine similarity math, keyword extraction/matching, calibration, and experience fit.
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.scoring import (
    cosine_similarity,
    estimate_experience_years,
    score_resume_against_jd,
    _extract_skills_present,
    _calibrate_score,
    _experience_fit_score,
    _extract_jd_tech_tokens,
)
from app.services.skills_vocab import KNOWN_SKILLS


def test_cosine_similarity_identical_vectors():
    v = [1.0, 0.0, 0.0]
    assert abs(cosine_similarity(v, v) - 1.0) < 1e-9


def test_cosine_similarity_orthogonal_vectors():
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    assert abs(cosine_similarity(a, b) - 0.0) < 1e-9


def test_cosine_similarity_zero_vector_returns_zero():
    a = [0.0, 0.0]
    b = [1.0, 1.0]
    assert cosine_similarity(a, b) == 0.0


def test_extract_skills_present_basic_match():
    text = "I have 5 years of experience with Python and React."
    found = _extract_skills_present(text)
    assert "Python" in found
    assert "React" in found


def test_extract_skills_present_is_word_boundary_safe():
    # "Java" should not match inside "JavaScript"
    text = "I know JavaScript well."
    found = _extract_skills_present(text)
    assert "JavaScript" in found
    assert "Java" not in found


def test_extract_skills_present_case_insensitive():
    text = "experienced with PYTHON and kubernetes"
    found = _extract_skills_present(text)
    assert "Python" in found
    assert "Kubernetes" in found


def test_score_resume_against_jd_perfect_match():
    """Perfect match: identical embeddings + all skills present → ats_score == 100."""
    resume_text = "Expert in Python, Docker, Kubernetes, AWS."
    jd_text = "Looking for someone skilled in Python, Docker, Kubernetes, AWS."
    identical_embedding = [1.0, 0.0, 0.0]
    result = score_resume_against_jd(resume_text, jd_text, identical_embedding, identical_embedding)

    assert result["ats_score"] == 100
    assert result["semantic_similarity"] == 1.0
    assert result["keyword_coverage"] is not None
    assert result["keyword_coverage"] >= 0.9  # near-perfect (may have slight raw-token drag)
    assert result["missing_skills"] == []
    assert set(result["matched_skills"]) == {"AWS", "Docker", "Kubernetes", "Python"}


def test_score_resume_against_jd_missing_skills():
    resume_text = "Experience with Python."
    jd_text = "Need Python, Docker, and Kubernetes."
    resume_embedding = [1.0, 0.0]
    jd_embedding = [1.0, 0.0]
    result = score_resume_against_jd(resume_text, jd_text, resume_embedding, jd_embedding)

    assert "Docker" in result["missing_skills"]
    assert "Kubernetes" in result["missing_skills"]
    assert "Python" in result["matched_skills"]
    assert 0 < result["keyword_coverage"] < 1


def test_score_resume_against_jd_no_skills_in_jd_gives_null_coverage():
    # If the JD mentions no known skills at all, keyword_coverage must be None
    resume_text = "General experience."
    jd_text = "We are a fun team looking for a great teammate."
    resume_embedding = [1.0, 0.0]
    jd_embedding = [1.0, 0.0]
    result = score_resume_against_jd(resume_text, jd_text, resume_embedding, jd_embedding)
    assert result["keyword_coverage"] is None
    assert result["jd_has_recognized_skills"] is False
    # Falls back to semantic similarity alone (1.0 here) — calibrated to 100
    assert result["ats_score"] == 100


def test_score_resume_against_jd_score_is_bounded_0_to_100():
    resume_embedding = [1.0, 0.0]
    jd_embedding = [-1.0, 0.0]  # opposite direction → negative cosine similarity
    result = score_resume_against_jd("nothing relevant", "Python Docker", resume_embedding, jd_embedding)
    assert 0 <= result["ats_score"] <= 100


def test_estimate_experience_years():
    assert estimate_experience_years("Python developer with 3+ years of experience and 2 yrs exp in React") == 3.0
    assert estimate_experience_years("Final-year student with internship projects") == 0.0


def test_known_skills_are_deduplicated():
    assert len(KNOWN_SKILLS) == len(set(KNOWN_SKILLS))


def test_extract_skills_present_covers_non_tech_domains():
    text = """
    Mechanical design intern with SolidWorks, GD&T, ANSYS FEA, CNC Machining,
    and DFM exposure. Built PCB Design prototypes using Embedded C and SPI,
    supported STAAD Pro structural analysis, and reviewed Power Systems relay settings.
    """
    found = set(_extract_skills_present(text))
    assert {"SolidWorks", "GD&T", "FEA (Finite Element Analysis)", "CNC Machining"} <= found
    assert {"PCB Design", "Embedded C", "Communication Protocols"} <= found
    assert {"STAAD Pro", "Structural Analysis", "Power Systems"} <= found


# ---------------------------------------------------------------------------
# New calibration tests
# ---------------------------------------------------------------------------

def test_calibrate_score_perfect_is_100():
    assert _calibrate_score(1.0) == 100.0


def test_calibrate_score_zero_is_zero():
    assert _calibrate_score(0.0) == 0.0


def test_calibrate_score_strong_match_lands_in_75_to_90():
    """A raw combined score of 0.70–0.80 should calibrate to the 75–90 range."""
    s70 = _calibrate_score(0.70)
    s80 = _calibrate_score(0.80)
    assert 75.0 <= s70 <= 80.0, f"Expected 70% raw → 75–80, got {s70}"
    assert 82.0 <= s80 <= 90.0, f"Expected 80% raw → 82–90, got {s80}"


def test_calibrate_score_weak_match_below_55():
    """A weak raw score (< 0.45) should calibrate below 55."""
    s = _calibrate_score(0.35)
    assert s < 55.0, f"Expected weak raw 0.35 → <55, got {s}"


def test_calibrate_score_is_monotone():
    """Higher raw → higher calibrated."""
    raw_vals = [0.0, 0.2, 0.4, 0.6, 0.7, 0.85, 1.0]
    calibrated = [_calibrate_score(r) for r in raw_vals]
    for i in range(len(calibrated) - 1):
        assert calibrated[i] <= calibrated[i + 1], (
            f"Non-monotone at {raw_vals[i]}: {calibrated[i]} > {calibrated[i+1]}"
        )


def test_score_strong_candidate_lands_in_competitive_range():
    """
    Simulate a strong candidate: identical embeddings + 80% skill coverage.
    Score should land in 75–95 (competitive with commercial tools).
    """
    # JD has Python, Docker, Kubernetes, AWS, React; resume has 4/5
    resume_text = "Expert in Python, Docker, Kubernetes, AWS."
    jd_text = "Need Python, Docker, Kubernetes, AWS, and React experience."
    identical_embedding = [1.0, 0.0, 0.0]
    result = score_resume_against_jd(resume_text, jd_text, identical_embedding, identical_embedding)
    assert 70 <= result["ats_score"] <= 100, (
        f"Expected strong candidate score 70–100, got {result['ats_score']}"
    )


def test_experience_fit_no_requirement():
    """If JD doesn't state years, experience fit should be 1.0."""
    score = _experience_fit_score("I have 2 years of experience.", "Looking for a Python developer.")
    assert score == 1.0


def test_experience_fit_meets_requirement():
    score = _experience_fit_score(
        "5 years of experience in Python and ML.",
        "Requires 3 years of experience in machine learning."
    )
    assert score == 1.0


def test_experience_fit_partial_credit():
    score = _experience_fit_score(
        "1 year of experience in Python.",
        "Requires 3 years of experience."
    )
    assert 0.3 <= score < 1.0


def test_jd_tech_token_extraction():
    """Extracts CamelCase and ALL-CAPS tokens from JD text."""
    jd = "Experience with GraphQL, REST APIs, CI/CD, and TypeScript. Must know Next.js."
    tokens = _extract_jd_tech_tokens(jd)
    # Should catch REST, CI/CD, TypeScript, GraphQL
    assert any("rest" in t or "api" in t for t in tokens)
