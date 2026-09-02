import logging
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.llm_telemetry import trace_llm_call, telemetry_logger
from app.services.scorer import score_student_job


@pytest.fixture
def client():
    return TestClient(app)


def test_health_endpoint(client):
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["database"]["status"] == "connected"
    assert data["database"]["type"] == "sqlite"
    assert "ai_providers" in data
    assert "groq" in data["ai_providers"]
    assert "gemini" in data["ai_providers"]
    assert "ollama" in data["ai_providers"]


def test_structured_telemetry_tracer(caplog):
    caplog.set_level(logging.INFO, logger="ai_telemetry")
    
    with trace_llm_call("test_provider", "test_model_v1", "test_op", {"sample_key": "sample_val"}) as trace:
        trace["custom_metric"] = 42

    # Verify log output contains structured JSON
    records = [r.message for r in caplog.records if "[AI_TELEMETRY]" in r.message or "test_provider" in r.message]
    assert len(records) >= 1
    assert "test_provider" in records[-1]
    assert "test_model_v1" in records[-1]
    assert "latency_ms" in records[-1]


def test_graceful_degradation_when_ai_fails(monkeypatch):
    # Simulate both Groq and Gemini being unavailable / failing
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    student = {"name": "Jane Doe", "branch": "software", "ats_score": 75}
    job = {
        "job_title": "Software Developer",
        "full_jd_text": "Looking for a Python Developer with Git and API experience.",
        "extracted_keywords": ["python", "git", "api"],
    }
    project_texts = ["Built a Python REST API service using Git for version control."]

    result = score_student_job(student, project_texts, job)
    
    # Must not throw error and gracefully fall back to keyword + semantic
    assert result["api_used"] == "fallback"
    assert result["project_score"] > 0
    assert result["final_score"] > 0
    assert "fallback" in result["project_summary"].lower() or "keyword" in result["project_summary"].lower()


def test_offline_project_and_repo_evaluation(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://127.0.0.1:99999")  # Non-existent port to force offline

    from app.services.scorer import evaluate_profile_project, evaluate_repo_against_jd

    profile_eval = evaluate_profile_project("Fullstack app description", ["import fastapi\ndef main(): pass"])
    assert profile_eval["project_general_score"] > 0
    assert "Deterministic" in profile_eval["project_summary"] or "deterministic" in profile_eval["project_summary"]

    repo_eval = evaluate_repo_against_jd("Built React & FastAPI web application with SQLite database", "Need React and FastAPI backend engineer")
    assert repo_eval["repo_match_score"] > 0
    assert "Deterministic" in repo_eval["repo_match_reasoning"] or "deterministic" in repo_eval["repo_match_reasoning"]

