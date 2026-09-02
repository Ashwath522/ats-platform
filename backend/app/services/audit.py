import json
from datetime import datetime
from typing import Optional, Dict, Any, List
from sqlmodel import Session

from ..db import DecisionAuditLog, Application, Job, utc_now


def record_audit_event(
    session: Session,
    event_type: str,
    application_id: Optional[int] = None,
    candidate_id: Optional[int] = None,
    job_id: Optional[int] = None,
    ats_score: Optional[int] = None,
    baseline_ats_score: Optional[int] = None,
    semantic_similarity: Optional[float] = None,
    keyword_coverage: Optional[float] = None,
    matched_skills: Optional[List[str]] = None,
    missing_skills: Optional[List[str]] = None,
    project_score: Optional[float] = None,
    final_score: Optional[float] = None,
    risk_score: Optional[int] = None,
    risk_level: Optional[str] = None,
    llm_providers_consulted: Optional[List[str]] = None,
    raw_verdicts: Optional[Dict[str, Any]] = None,
    final_recommendation: Optional[str] = None,
    human_reviewer: Optional[str] = None,
    human_action: Optional[str] = None,
    human_confirmed_at: Optional[datetime] = None,
) -> DecisionAuditLog:
    """
    Writes an immutable, append-only record to DecisionAuditLog for compliance
    and complete auditability of automated & human hiring events.
    """
    entry = DecisionAuditLog(
        application_id=application_id,
        candidate_id=candidate_id,
        job_id=job_id,
        event_type=event_type,
        ats_score=ats_score,
        baseline_ats_score=baseline_ats_score,
        semantic_similarity=semantic_similarity,
        keyword_coverage=keyword_coverage,
        matched_skills_json=json.dumps(matched_skills if matched_skills is not None else []),
        missing_skills_json=json.dumps(missing_skills if missing_skills is not None else []),
        project_score=project_score,
        final_score=final_score,
        risk_score=risk_score,
        risk_level=risk_level,
        llm_providers_consulted=json.dumps(llm_providers_consulted) if llm_providers_consulted else None,
        raw_verdicts_json=json.dumps(raw_verdicts) if raw_verdicts else None,
        final_recommendation=final_recommendation,
        human_reviewer=human_reviewer,
        human_action=human_action,
        human_confirmed_at=human_confirmed_at,
        created_at=utc_now(),
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


def generate_score_explanation(application: Application, job: Optional[Job] = None) -> Dict[str, Any]:
    """
    Generates a clear, plain-language breakdown of what contributed to the candidate's
    scores (ATS match, skill matches/gaps, project verification, and interview status).
    Uses data already computed by the scorer without making any new LLM calls.
    """
    ats_score = application.ats_score or 0
    matched_skills = json.loads(application.matched_skills_json or "[]")
    missing_skills = json.loads(application.missing_skills_json or "[]")
    total_skills = len(matched_skills) + len(missing_skills)

    # Skill match ratio
    skill_coverage_pct = round((len(matched_skills) / total_skills) * 100) if total_skills > 0 else 0

    # Summary narrative
    if ats_score >= 80:
        summary_verdict = "Excellent Match"
        summary_text = (
            f"Your profile strongly aligns with the requirements for {job.title if job else 'this role'} "
            f"({ats_score}/100 overall match). You demonstrate solid coverage of key competencies."
        )
    elif ats_score >= 60:
        summary_verdict = "Good Potential Match"
        summary_text = (
            f"Your profile demonstrates relevant background for {job.title if job else 'this role'} "
            f"({ats_score}/100 match). Addressing the missing skill areas below can further strengthen your candidacy."
        )
    else:
        summary_verdict = "Developing Match"
        summary_text = (
            f"Your profile has foundational skills for {job.title if job else 'this role'} ({ats_score}/100 match), "
            "but there are several specialized requirements not yet reflected in your resume."
        )

    # Component breakdown
    components = []

    # 1. ATS Resume Match
    components.append({
        "name": "Resume & Semantic Fit",
        "score": ats_score,
        "weight_description": "Initial ATS screening based on semantic similarity and core skill coverage.",
        "details": f"Matched {len(matched_skills)} of {total_skills} recognized skills ({skill_coverage_pct}% skill coverage).",
        "status": "strong" if ats_score >= 70 else "moderate" if ats_score >= 50 else "needs_improvement",
    })

    # 2. Project / Repo Verification
    effective_project_score = application.project_score or application.repo_match_score
    if effective_project_score is not None:
        components.append({
            "name": "Project & Code Verification",
            "score": round(effective_project_score),
            "weight_description": "60% of composite evaluation when project evidence is submitted.",
            "details": application.project_summary or application.repo_match_reasoning or "Verified technical implementation depth.",
            "status": "strong" if effective_project_score >= 70 else "moderate" if effective_project_score >= 50 else "needs_improvement",
        })
    else:
        components.append({
            "name": "Project & Code Verification",
            "score": None,
            "weight_description": "Pending project repository or engineering report upload.",
            "details": "Upload your code repo or technical project to unlock project-level scoring.",
            "status": "pending",
        })

    # 3. AI Proctoring & Interview Evaluation
    if application.interview_eval_score is not None:
        components.append({
            "name": "AI Video Interview",
            "score": application.interview_eval_score,
            "weight_description": "Live problem-solving and communication evaluation.",
            "details": (
                f"Proctoring risk evaluated as {application.interview_risk_level or 'low'} "
                f"({application.interview_risk_score or 0}/100 risk score). {application.interview_recommendation or ''}"
            ),
            "status": "strong" if application.interview_eval_score >= 70 else "moderate",
        })
    else:
        components.append({
            "name": "AI Video Interview",
            "score": None,
            "weight_description": "Unlocked once project verification meets benchmark.",
            "details": "Interview is unlocked following project submission." if application.interview_status == "unlocked" else "Locked pending prior stages.",
            "status": application.interview_status or "locked",
        })

    # Actionable advice
    recommendations = []
    if missing_skills:
        recommendations.append(
            f"Highlight practical experience or certifications with: {', '.join(missing_skills[:4])}."
        )
    if effective_project_score is None:
        recommendations.append(
            "Upload a relevant GitHub repository or project archive showcasing real code and documentation."
        )
    elif effective_project_score < 70:
        recommendations.append(
            "Add detailed architecture documentation or unit tests to your project to demonstrate engineering rigor."
        )
    if not recommendations:
        recommendations.append("Your application profile is well-rounded and meets all benchmark criteria.")

    return {
        "application_id": application.id,
        "job_title": job.title if job else "Position",
        "ats_score": ats_score,
        "final_score": application.final_score or ats_score,
        "summary_verdict": summary_verdict,
        "summary_text": summary_text,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
        "components": components,
        "recommendations": recommendations,
        "human_review_status": "Human confirmation pending" if application.pending_human_review else "Confirmed",
        "human_reviewer": application.human_reviewer,
        "ai_recommendation": application.ai_recommendation,
    }
