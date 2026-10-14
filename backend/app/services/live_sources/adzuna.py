"""Adzuna official Jobs API (free key: https://developer.adzuna.com).

GET https://api.adzuna.com/v1/api/jobs/in/search/{page}?app_id=&app_key=&what=&max_days_old=30
Response: {"count": N, "results": [{id, title, description, created, redirect_url,
company{display_name}, location{display_name, area[]}, salary_min, salary_max,
salary_is_predicted, contract_time, contract_type, category{tag,label}}]}
The listing's ``redirect_url`` (adzuna.in) is the only link we expose.
"""
from __future__ import annotations

from typing import List, Optional, Tuple

import httpx

from .base import FetchResult, Provider, RawJob, env, https_on_domain, norm_job_type, parse_dt, safe_error, strip_tags

API = "https://api.adzuna.com/v1/api/jobs/in/search"
DOMAINS = ("adzuna.in", "adzuna.com")

# (query, branch hint) — one request each per sync keeps us far inside the free quota.
QUERIES: List[Tuple[str, str]] = [
    ("mechanical design engineer", "mechanical"),
    ("graduate engineer trainee civil", "civil"),
    ("embedded engineer", "ece"),
    ("electrical engineer", "eee"),
    ("process engineer chemical", "chemical"),
    ("automotive engineer", "automobile"),
    ("metallurgical engineer", "metallurgy"),
    ("aerospace engineer", "aerospace"),
]


def parse_result(item: dict, hint: Optional[str] = None) -> Optional[RawJob]:
    url = https_on_domain(item.get("redirect_url"), DOMAINS)
    if not url or not item.get("id"):
        return None
    loc = item.get("location") or {}
    area = loc.get("area") or []
    city = area[-1] if len(area) >= 3 else (loc.get("display_name") or "").split(",")[0].strip() or None
    predicted = str(item.get("salary_is_predicted") or "0") == "1"
    ct = " ".join(str(item.get(k) or "") for k in ("contract_time", "contract_type")).replace("_", " ")
    return RawJob(
        source="adzuna",
        external_id=str(item.get("id")),
        title=strip_tags(item.get("title")),
        company_name=strip_tags((item.get("company") or {}).get("display_name")) or "Company",
        description_text=strip_tags(item.get("description"))[:8000],
        location_text=loc.get("display_name") or ", ".join(reversed(area)) or "India",
        city=city,
        country="IN",
        job_type=norm_job_type(ct) if ct.strip() else None,
        apply_url=url,
        posting_url=url,
        # Adzuna marks model-estimated salaries; only show real ones.
        salary_min=None if predicted else item.get("salary_min"),
        salary_max=None if predicted else item.get("salary_max"),
        posted_at=parse_dt(item.get("created")),
        version=str(item.get("created") or ""),
        branch_hint=hint,
    )


class Adzuna(Provider):
    domains = DOMAINS
    name = "adzuna"
    kind = "jobs"
    label = "Adzuna"
    key_env = ("ADZUNA_APP_ID", "ADZUNA_APP_KEY")

    def source_label(self, company: str) -> str:
        return f"{company} · via Adzuna" if company else "Adzuna"

    async def fetch(self, client: httpx.AsyncClient, settings: dict) -> FetchResult:
        result = FetchResult(complete_scopes=None)
        ok = 0
        for query, hint in QUERIES:
            params = {
                "app_id": env("ADZUNA_APP_ID"), "app_key": env("ADZUNA_APP_KEY"), "what": query,
                "max_days_old": 30, "results_per_page": 50, "sort_by": "date", "content-type": "application/json",
            }
            try:
                r = await client.get(f"{API}/1", params=params)
                result.requests += 1
                r.raise_for_status()
                for item in (r.json().get("results") or []):
                    job = parse_result(item, hint)
                    if job:
                        result.items.append(job)
                ok += 1
            except Exception as exc:
                result.errors.append(f"{query}: {safe_error(exc)}")
        if ok == 0:
            raise RuntimeError("; ".join(result.errors)[:500] or "no results")
        # A partially failed run is not a "successful sync" for expiry purposes.
        result.complete = ok == len(QUERIES)
        return result
