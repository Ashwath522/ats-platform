from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict

class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str; source_type: str; source_ref: str; locator: Optional[object] = None; fact: str = Field(max_length=500); method: str; confidence: str; origin: str = "server"; confirmed: bool = False
class Claim(BaseModel):
    id: str; text: str; origin: str; status: str; evidence_ids: list[str] = []; reasoning: str = ""
class StageStatus(BaseModel):
    name: str; state: str = "pending"; started_at: Optional[datetime] = None; finished_at: Optional[datetime] = None; message: Optional[str] = None
class AnalysisResult(BaseModel):
    version: str = "pa:v1"; project_id: int; domain: str; stages: list[StageStatus] = []; evidence: list[Evidence] = []; claims: list[Claim] = []; summary: Optional[str] = None; scores: dict = {}; warnings: list[str] = []; domain_data: Optional[dict] = None; created_at: datetime

class VideoSegment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    start: str; end: str; visible: list[str] = []; actions: list[str] = []; inputs: list[str] = []; outputs: list[str] = []; spoken_summary: str = ""
class VideoObservation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    duration_s: float = 0; segments: list[VideoSegment] = []; challenge_code_seen_or_heard: str = "unclear"; challenge_code_value: Optional[str] = None; limitations: list[str] = []

def enforce_claim_evidence(claims, evidence):
    valid = {e.id for e in evidence if getattr(e, "origin", "server") == "server"}
    for c in claims:
        if c.status in {"verified", "partially_verified"} and not set(c.evidence_ids).intersection(valid):
            c.status = "unverified"
    return claims
