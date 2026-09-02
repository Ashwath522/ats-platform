import json
from app.db import Application, Job
from app.services.audit import generate_score_explanation


def test_generate_score_explanation_high_match():
    job = Job(title="Senior Backend Engineer", description="Python FastAPI PostgreSQL", recruiter_id=1)
    app = Application(
        candidate_id=1,
        job_id=1,
        ats_score=85,
        final_score=88.0,
        project_score=90.0,
        project_summary="Strong microservices architecture with pytest coverage.",
        matched_skills_json=json.dumps(["python", "fastapi", "postgresql"]),
        missing_skills_json=json.dumps(["kubernetes"]),
        interview_eval_score=88,
        interview_risk_score=10,
        interview_risk_level="low",
        interview_recommendation="High technical clarity.",
        status="automated_interview",
        interview_status="completed",
    )

    explanation = generate_score_explanation(app, job)

    assert explanation["application_id"] == app.id
    assert explanation["job_title"] == "Senior Backend Engineer"
    assert explanation["ats_score"] == 85
    assert explanation["summary_verdict"] == "Excellent Match"
    assert "85/100" in explanation["summary_text"]
    assert len(explanation["components"]) >= 3

    # Check component scores
    resume_comp = next(c for c in explanation["components"] if c["name"] == "Resume & Semantic Fit")
    assert resume_comp["score"] == 85

    project_comp = next(c for c in explanation["components"] if c["name"] == "Project & Code Verification")
    assert project_comp["score"] == 90

    interview_comp = next(c for c in explanation["components"] if c["name"] == "AI Video Interview")
    assert interview_comp["score"] == 88

    # Check recommendations
    assert any("kubernetes" in r.lower() for r in explanation["recommendations"])


def test_generate_score_explanation_pending_stages():
    job = Job(title="Junior Developer", description="React Node.js", recruiter_id=1)
    app = Application(
        candidate_id=2,
        job_id=2,
        ats_score=55,
        matched_skills_json=json.dumps(["react"]),
        missing_skills_json=json.dumps(["nodejs", "typescript"]),
        status="ats_check",
    )

    explanation = generate_score_explanation(app, job)
    assert explanation["summary_verdict"] == "Developing Match"
    assert len(explanation["matched_skills"]) == 1
    assert len(explanation["missing_skills"]) == 2

    # Project and interview should be pending
    project_comp = next(c for c in explanation["components"] if c["name"] == "Project & Code Verification")
    assert project_comp["score"] is None
    assert project_comp["status"] == "pending"
