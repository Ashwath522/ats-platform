"""Shared, typed contract for every stage of project analysis.

Rules enforced here (not left to any AI model):
- An Evidence fact always comes from a file, the video, the transcript, a
  rule over those, or the student's own words (method "student_claim").
- Only server-parsed (or server-confirmed) evidence with high confidence can
  make a claim "verified" — see ``enforce_claims``.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Confidence = Literal["high", "medium", "low"]
Method = Literal["parsed", "rule", "ocr", "vision_model", "transcript", "student_claim", "api"]
ClaimStatus = Literal["verified", "partially_verified", "unverified", "contradicted", "not_checked"]
StageState = Literal["pending", "running", "done", "skipped", "failed"]

STAGES = ["validate_files", "extract_files", "analyse_domain", "analyse_video", "verify_claims", "build_report"]
STAGE_LABELS = {
    "validate_files": "Checking files",
    "extract_files": "Reading files",
    "analyse_domain": "Engineering analysis",
    "analyse_video": "Demo video",
    "verify_claims": "Checking claims",
    "build_report": "Building report",
}


class Evidence(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    source_type: Literal["file", "video", "repo", "description", "analysis"]
    source_ref: str                      # file name, "mm:ss", repo path, ...
    locator: Optional[Dict[str, Any]] = None
    fact: str = Field(max_length=500)
    method: Method
    confidence: Confidence
    origin: Literal["server", "client"] = "server"
    confirmed: bool = True

    @property
    def strong(self) -> bool:
        return self.confidence == "high" and (self.origin == "server" or self.confirmed) and self.method in {"parsed", "rule", "api"}


class Claim(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    text: str = Field(max_length=300)
    origin: str = "description"
    type: str = "feature"
    status: ClaimStatus = "not_checked"
    evidence_ids: List[str] = []
    reasoning: str = Field("", max_length=400)


class StageStatus(BaseModel):
    name: str
    label: str = ""
    state: StageState = "pending"
    message: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None


class VideoSegment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    start: str = "00:00"
    end: str = ""
    visible: List[str] = []
    actions: List[str] = []
    inputs: List[str] = []
    outputs: List[str] = []
    spoken_summary: str = ""


class VideoObservation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    duration_s: float = 0
    segments: List[VideoSegment] = []
    challenge_code_seen_or_heard: str = "unclear"
    challenge_code_value: Optional[str] = None
    limitations: List[str] = []


class AnalysisResult(BaseModel):
    model_config = ConfigDict(extra="ignore")
    version: str = "pa:v2"
    project_id: int
    domain: str
    stages: List[StageStatus] = []
    evidence: List[Evidence] = []
    claims: List[Claim] = []
    domain_data: Dict[str, Any] = {}
    video: Optional[Dict[str, Any]] = None
    scores: Dict[str, Any] = {}
    report: Dict[str, Any] = {}
    warnings: List[str] = []
    ai_used: bool = False
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")


# ── Claim enforcement (always runs after any AI verification) ────────────────

IMPLEMENTATION_TYPES = {"component", "design", "performance", "result"}


def enforce_claims(claims: List[Claim], evidence: List[Evidence], contradictions: Optional[Dict[str, List[str]]] = None) -> List[Claim]:
    """Downgrade any claim status the evidence does not support.

    - unknown evidence ids are dropped; none left → unverified
    - verified needs ≥1 strong evidence (server-parsed, high confidence);
      otherwise it becomes partially_verified
    - video/vision/transcript-only evidence gives at most partially_verified
      for implementation claims (it can verify demonstrated behaviour)
    - contradicted needs a real conflicting evidence id
    """
    by_id = {e.id: e for e in evidence}
    contradictions = contradictions or {}
    for c in claims:
        c.evidence_ids = [i for i in dict.fromkeys(c.evidence_ids) if i in by_id]
        if c.status == "contradicted":
            conflict = [i for i in contradictions.get(c.id, []) if i in by_id] or [i for i in c.evidence_ids if by_id[i].source_type == "analysis"]
            if not conflict:
                c.status = "unverified" if not c.evidence_ids else "partially_verified"
            continue
        if c.status in {"verified", "partially_verified"} and not c.evidence_ids:
            c.status = "unverified"
            continue
        if c.status == "verified":
            ev = [by_id[i] for i in c.evidence_ids]
            strong = [e for e in ev if e.strong]
            video_ok = c.type == "feature" and any(e.source_type == "video" for e in ev)
            if not strong and not video_ok:
                c.status = "partially_verified"
            elif not strong and c.type in IMPLEMENTATION_TYPES:
                c.status = "partially_verified"
    return claims
