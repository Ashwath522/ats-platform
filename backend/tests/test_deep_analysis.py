import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.deep_analysis import DEFAULT_NOT_CONFIGURED, parse_analysis_json, run_deep_analysis
from app.services.role_templates import list_branches, list_roles


def test_parse_analysis_json_strips_markdown_fence():
    raw = """```json
{
  "grammar_score": 82,
  "grammar_issues": [{"issue": "Verb tense shifts", "suggestion": "Use consistent past tense."}],
  "technical_depth_score": 74,
  "technical_depth_notes": "Shows tools and project substance.",
  "experience_score": 68,
  "experience_notes": "Some quantified impact is present.",
  "overall_summary": "Good fit with room to make outcomes clearer."
}
```"""
    parsed = parse_analysis_json(raw)
    assert parsed["llm_configured"] is True
    assert parsed["grammar_score"] == 82
    assert parsed["grammar_issues"][0]["suggestion"] == "Use consistent past tense."


def test_run_deep_analysis_not_configured(monkeypatch):
    # Ensure neither Gemini nor Ollama is considered configured
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("LLM_PROVIDER", "none")
    result = run_deep_analysis("resume", "job")
    assert result == DEFAULT_NOT_CONFIGURED


def test_branch_role_templates_are_scoped():
    branch_ids = {branch["id"] for branch in list_branches()}
    assert {"software", "mechanical", "civil", "ece", "eee", "aerospace"} <= branch_ids
    mechanical_roles = list_roles("mechanical")
    assert mechanical_roles
    assert all(role["branch"] == "mechanical" for role in mechanical_roles)
    assert any(role["id"] == "mechanical-design-engineer" for role in mechanical_roles)
