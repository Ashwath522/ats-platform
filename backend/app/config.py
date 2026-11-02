"""
backend/app/config.py
─────────────────────
System configuration with in-code fallback defaults.
Weights for composite score calculation:
  final_score = REPO_WEIGHT_ATS * ats_score + REPO_WEIGHT_PROJECT * project_score
"""
import math
import os


def _weight(name: str, fallback: str) -> float:
    """Read a score weight and reject values that make the formula ambiguous."""
    raw = os.environ.get(name, fallback)
    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"{name} must be a finite number between 0 and 1") from exc
    if not math.isfinite(value) or not 0.0 <= value <= 1.0:
        raise RuntimeError(f"{name} must be a finite number between 0 and 1")
    return value

# Configurable weights with in-code fallback defaults (0.4 / 0.6)
REPO_WEIGHT_ATS: float = _weight("REPO_WEIGHT_ATS", os.environ.get("WEIGHT_ATS", "0.40"))
REPO_WEIGHT_PROJECT: float = _weight("REPO_WEIGHT_PROJECT", os.environ.get("WEIGHT_PROJECT", "0.60"))
if not math.isclose(REPO_WEIGHT_ATS + REPO_WEIGHT_PROJECT, 1.0, abs_tol=1e-9):
    raise RuntimeError("REPO_WEIGHT_ATS and REPO_WEIGHT_PROJECT must sum to 1.0")

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
CANDIDATE_STATUS_ENUM = VALID_CANDIDATE_STATUSES
