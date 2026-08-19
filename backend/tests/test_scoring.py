"""
Tests for scoring.py - deliberately independent of the embedding model and
chromadb, since those need real network access. These test the pure logic:
cosine similarity math and keyword extraction/matching.
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.scoring import cosine_similarity, estimate_experience_years, score_resume_against_jd, _extract_skills_present
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
    resume_text = "Expert in Python, Docker, Kubernetes, AWS."
    jd_text = "Looking for someone skilled in Python, Docker, Kubernetes, AWS."
    identical_embedding = [1.0, 0.0, 0.0]
    result = score_resume_against_jd(resume_text, jd_text, identical_embedding, identical_embedding)

    assert result["ats_score"] == 100
    assert result["semantic_similarity"] == 1.0
    assert result["keyword_coverage"] == 1.0
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


def test_score_resume_against_jd_no_skills_in_jd_gives_full_keyword_coverage():
    # If the JD mentions no known skills at all, keyword_coverage defaults to 1.0
    # rather than penalizing the candidate for something the JD never asked for.
    resume_text = "General experience."
    jd_text = "We are a fun team looking for a great teammate."
    resume_embedding = [1.0, 0.0]
    jd_embedding = [1.0, 0.0]
    result = score_resume_against_jd(resume_text, jd_text, resume_embedding, jd_embedding)
    assert result["keyword_coverage"] == 1.0


def test_score_resume_against_jd_score_is_bounded_0_to_100():
    resume_embedding = [1.0, 0.0]
    jd_embedding = [-1.0, 0.0]  # opposite direction -> negative cosine similarity
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
