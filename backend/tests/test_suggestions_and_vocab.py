import os
import sys
import pytest
from sqlmodel import Session, select

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db import engine, init_db, DiscoveredSkill
from app.services.vocab_learning import learn_skills_from_resume, extract_discovered_skills
from app.services.scoring import score_resume_against_jd
from app.services.deep_analysis import parse_suggestions_json, run_resume_suggestions


def test_extract_discovered_skills_filters_known_and_common():
    text = "We use Python, Altium Designer, and a newly invented tool called SuperCADTool. Project management was done."
    # Python is in KNOWN_SKILLS (Software)
    # Altium Designer is in KNOWN_SKILLS (ECE)
    # Project is a common word
    # SuperCADTool is capitalized and not in static vocab or common words
    candidates = extract_discovered_skills(text)
    assert "SuperCADTool" in candidates
    assert "Python" not in candidates
    assert "Altium Designer" not in candidates
    assert "Project" not in candidates


def test_dynamic_vocabulary_promotion():
    init_db()

    # Clear discovered skills
    with Session(engine) as session:
        session.exec(select(DiscoveredSkill)).all()
        for ds in session.exec(select(DiscoveredSkill)).all():
            session.delete(ds)
        session.commit()

    resume_text = "I have expertise in the SuperCADTool system."
    jd_text = "Looking for a candidate with SuperCADTool."

    # 1. Run scoring before promotion. SuperCADTool should NOT be matched or missing
    res_embed = [0.1] * 384
    jd_embed = [0.1] * 384
    score_before = score_resume_against_jd(resume_text, jd_text, res_embed, jd_embed, branch="mechanical")
    assert "SuperCADTool" not in score_before["matched_skills"]
    assert "SuperCADTool" not in score_before["missing_skills"]

    # 2. Add resume processing once -> count = 1
    learn_skills_from_resume(resume_text, branch="mechanical")
    with Session(engine) as session:
        ds = session.exec(select(DiscoveredSkill).where(DiscoveredSkill.term == "SuperCADTool")).first()
        assert ds is not None
        assert ds.occurrence_count == 1

    # Scoring should still not match it (threshold is 3)
    score_middle = score_resume_against_jd(resume_text, jd_text, res_embed, jd_embed, branch="mechanical")
    assert "SuperCADTool" not in score_middle["matched_skills"]

    # 3. Add resume processing two more times -> count = 3
    learn_skills_from_resume(resume_text, branch="mechanical")
    learn_skills_from_resume(resume_text, branch="mechanical")

    with Session(engine) as session:
        ds = session.exec(select(DiscoveredSkill).where(DiscoveredSkill.term == "SuperCADTool")).first()
        assert ds.occurrence_count == 3

    # 4. Score again after promotion -> SuperCADTool should be in matched_skills!
    score_after = score_resume_against_jd(resume_text, jd_text, res_embed, jd_embed, branch="mechanical")
    assert "SuperCADTool" in score_after["matched_skills"]


def test_parse_suggestions_json():
    raw_json = """```json
    {
      "suggestions": [
        "Include Altium Designer experience.",
        "Add a project showcasing PLC Programming."
      ]
    }
    ```"""
    parsed = parse_suggestions_json(raw_json)
    assert parsed["llm_configured"] is True
    assert len(parsed["suggestions"]) == 2
    assert "Altium Designer" in parsed["suggestions"][0]


def test_run_suggestions_not_configured(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    result = run_resume_suggestions("resume text", "jd text", ["PLC Programming"])
    assert result["llm_configured"] is False
    assert result["suggestions"] == []
