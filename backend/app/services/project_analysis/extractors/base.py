"""Common result type for all file extractors."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class Fact:
    fact: str
    locator: Optional[Dict[str, Any]] = None
    method: str = "parsed"
    confidence: str = "high"
    source_type: str = "file"
    key: Optional[str] = None          # stable handle analysers use to cite this fact


@dataclass
class Extracted:
    """What one file yielded: human-readable facts + structured data for analysers."""
    kind: str                           # e.g. "arduino", "kicad_net", "pdf", "unsupported"
    facts: List[Fact] = field(default_factory=list)
    data: Dict[str, Any] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    text: str = ""                      # plain text for claim extraction (documents only), capped

    def add(self, fact: str, **kw) -> Fact:
        f = Fact(fact=fact[:480], **kw)
        self.facts.append(f)
        return f


def clip(items, n=12) -> str:
    items = [str(i) for i in items if str(i).strip()]
    more = len(items) - n
    return ", ".join(items[:n]) + (f" (+{more} more)" if more > 0 else "")
