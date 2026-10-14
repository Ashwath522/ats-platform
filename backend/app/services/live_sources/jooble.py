"""Jooble official REST API (free key: https://jooble.org/api/about).

POST https://jooble.org/api/{key}  {"keywords": "...", "location": "India", "page": 1}
Response: {"totalCount": N, "jobs": [{id, title, location, snippet, salary, source,
type, link, company, updated}]}. ``link`` points at jooble.org which forwards to the
original listing — that is the only link we expose.
"""
from __future__ import annotations

import re
from typing import Optional

import httpx

from .adzuna import QUERIES
from .base import FetchResult, Provider, RawJob, env, https_on_domain, norm_job_type, parse_dt, safe_error, strip_tags

API = "https://jooble.org/api"
DOMAINS = ("jooble.org",)


def _salary(text: str):
    """'₹4,00,000 - ₹6,00,000' / '400000-600000 INR' → (lo, hi); per-month values are ignored."""
    if not text or re.search(r"month|hour|day|week", text, re.I):
        return None, None
    nums = [float(n.replace(",", "")) for n in re.findall(r"\d[\d,]{4,}", text)]
    nums = [n for n in nums if 50000 <= n <= 1e8]
    if not nums:
        return None, None
    return min(nums), max(nums)


def parse_job(item: dict, hint: Optional[str] = None) -> Optional[RawJob]:
    url = https_on_domain(item.get("link"), DOMAINS)
    if not url or item.get("id") in (None, ""):
        return None
    lo, hi = _salary(str(item.get("salary") or ""))
    loc = strip_tags(item.get("location")) or "India"
    return RawJob(
        source="jooble",
        external_id=str(item.get("id")),
        title=strip_tags(item.get("title")),
        company_name=strip_tags(item.get("company")) or "Company",
        description_text=strip_tags(item.get("snippet"))[:8000],
        location_text=loc,
        city=loc.split(",")[0].strip() or None,
        country="IN",
        job_type=norm_job_type(item.get("type")),
        apply_url=url,
        posting_url=url,
        salary_min=lo,
        salary_max=hi,
        posted_at=parse_dt(item.get("updated")),
        version=str(item.get("updated") or ""),
        branch_hint=hint,
    )


class Jooble(Provider):
    domains = DOMAINS
    name = "jooble"
    kind = "jobs"
    label = "Jooble"
    key_env = ("JOOBLE_API_KEY",)

    def source_label(self, company: str) -> str:
        return f"{company} · via Jooble" if company else "Jooble"

    async def fetch(self, client: httpx.AsyncClient, settings: dict) -> FetchResult:
        result = FetchResult(complete_scopes=None)
        ok = 0
        key = env("JOOBLE_API_KEY")
        for query, hint in QUERIES:
            try:
                r = await client.post(f"{API}/{key}", json={"keywords": query, "location": "India", "page": 1})
                result.requests += 1
                r.raise_for_status()
                for item in (r.json().get("jobs") or []):
                    job = parse_job(item, hint)
                    if job:
                        result.items.append(job)
                ok += 1
            except Exception as exc:
                # never echo the URL: it contains the key
                result.errors.append(f"{query}: {safe_error(exc)}")
        if ok == 0:
            raise RuntimeError("; ".join(result.errors)[:500] or "no results")
        result.complete = ok == len(QUERIES)
        return result
