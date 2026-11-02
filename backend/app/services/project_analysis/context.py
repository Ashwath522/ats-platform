"""Shared state passed through the analysis pipeline."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .extractors.base import Extracted, Fact
from .schemas import Evidence


@dataclass
class Ctx:
    project_id: int
    domain: str
    title: str
    description: str
    links: List[dict]
    challenge_code: str
    video_url: Optional[str]
    student_names: List[str] = field(default_factory=list)
    files: List[dict] = field(default_factory=list)               # {id, filename, ext, kind}
    extracted: List[Extracted] = field(default_factory=list)
    evidence: List[Evidence] = field(default_factory=list)
    keys: Dict[str, List[str]] = field(default_factory=dict)       # fact key → evidence ids
    blocks: List[dict] = field(default_factory=list)               # structured data from all files
    warnings: List[str] = field(default_factory=list)
    domain_data: Dict[str, Any] = field(default_factory=dict)
    findings: List[dict] = field(default_factory=list)             # {id, text, severity, kind, evidence_ids}
    video: Optional[Dict[str, Any]] = None
    ai_used: bool = False

    def add_evidence(self, fact: Fact, source_ref: str, source_type: Optional[str] = None) -> str:
        eid = f"ev{len(self.evidence) + 1}"
        self.evidence.append(Evidence(id=eid, source_type=(source_type or fact.source_type), source_ref=source_ref[:120],
                                      locator=fact.locator, fact=fact.fact[:480], method=fact.method, confidence=fact.confidence))
        if fact.key:
            self.keys.setdefault(fact.key, []).append(eid)
        return eid

    def cite(self, *prefixes: str) -> List[str]:
        out: List[str] = []
        for k, ids in self.keys.items():
            if any(k == p or k.startswith(p) for p in prefixes):
                out.extend(ids)
        return list(dict.fromkeys(out))

    def finding(self, text: str, *, severity: str = "info", kind: str = "observation", cites: Optional[List[str]] = None,
                confidence: str = "high") -> str:
        """A rule-based observation over evidence. severity: ok | info | warn | issue | missing."""
        eid = self.add_evidence(Fact(fact=text, method="rule", confidence=confidence, source_type="analysis", key=f"finding:{kind}"), self.domain)
        self.findings.append({"id": eid, "text": text, "severity": severity, "kind": kind, "evidence_ids": list(cites or [])})
        return eid

    def of_type(self, *types: str) -> List[dict]:
        return [b for b in self.blocks if b.get("type") in types]

    def has_file_kind(self, *kinds: str) -> bool:
        return any(f["kind"] in kinds for f in self.files)
