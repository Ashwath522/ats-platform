"""
backend/app/config.py
─────────────────────
System configuration with in-code fallback defaults.
Weights for composite score calculation:
  final_score = REPO_WEIGHT_ATS * ats_score + REPO_WEIGHT_PROJECT * project_score
"""
import os

# Configurable weights with in-code fallback defaults (0.4 / 0.6)
REPO_WEIGHT_ATS: float = float(os.environ.get("REPO_WEIGHT_ATS", os.environ.get("WEIGHT_ATS", "0.40")))
REPO_WEIGHT_PROJECT: float = float(os.environ.get("REPO_WEIGHT_PROJECT", os.environ.get("WEIGHT_PROJECT", "0.60")))

# Candidate status enum values
CANDIDATE_STATUS_APPLIED = "applied"
CANDIDATE_STATUS_SHORTLISTED = "shortlisted"
CANDIDATE_STATUS_NOT_SELECTED = "not_selected"
CANDIDATE_STATUS_INTERVIEW = "interview"
CANDIDATE_STATUS_FINAL_RESULT = "final_result"

VALID_CANDIDATE_STATUSES = {
    CANDIDATE_STATUS_APPLIED,
    CANDIDATE_STATUS_SHORTLISTED,
    CANDIDATE_STATUS_NOT_SELECTED,
    CANDIDATE_STATUS_INTERVIEW,
    CANDIDATE_STATUS_FINAL_RESULT,
}
