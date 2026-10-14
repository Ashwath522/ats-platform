"""Registry of live data providers (official APIs only — no scraping)."""
from __future__ import annotations

from typing import Dict, List

from .adzuna import Adzuna
from .arxiv import Arxiv
from .base import Provider
from .greenhouse import Greenhouse
from .jooble import Jooble
from .lever import Lever
from .smartrecruiters import SmartRecruiters
from .youtube import YouTube

PROVIDERS: Dict[str, Provider] = {p.name: p for p in (
    SmartRecruiters(), Adzuna(), Jooble(), Greenhouse(), Lever(), Arxiv(), YouTube(),
)}
JOB_SOURCES: List[str] = [n for n, p in PROVIDERS.items() if p.kind == "jobs"]
RESOURCE_SOURCES: List[str] = [n for n, p in PROVIDERS.items() if p.kind == "resources"]

# Official employer boards outrank aggregators when the same job appears twice.
SOURCE_PRIORITY = {"smartrecruiters": 0, "greenhouse": 0, "lever": 0, "adzuna": 1, "jooble": 2}


def get(name: str) -> Provider:
    return PROVIDERS[name]
