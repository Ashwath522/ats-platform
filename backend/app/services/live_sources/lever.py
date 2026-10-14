"""Lever Postings API (public, no key) for configured company sites.

GET https://api.lever.co/v0/postings/{company}?mode=json
→ [{id, text, categories{location, commitment, team}, country, workplaceType,
    descriptionPlain, description, lists[], additionalPlain, hostedUrl, applyUrl, createdAt}]
Only India-based postings are kept. Disabled when no companies are configured.
"""
from __future__ import annotations

import asyncio
from typing import List, Optional

import httpx

from .base import FetchResult, Provider, RawJob, clean_html, https_on_domain, looks_indian, norm_job_type, parse_dt, safe_error

API = "https://api.lever.co/v0/postings"
DOMAINS = ("lever.co",)


def parse_posting(item: dict, company: str) -> Optional[RawJob]:
    cats = item.get("categories") or {}
    loc = (cats.get("location") or "").strip()
    if (item.get("country") or "").upper() != "IN" and not looks_indian(loc, *(cats.get("allLocations") or [])):
        return None
    url = https_on_domain(item.get("hostedUrl"), DOMAINS)
    if not url or not item.get("id"):
        return None
    lists = "".join(f"<h3>{l.get('text', '')}</h3><ul>{l.get('content', '')}</ul>" for l in (item.get("lists") or []))
    desc = clean_html((item.get("description") or "") + lists + (item.get("additional") or "")) or clean_html(item.get("descriptionPlain"))
    wt = (item.get("workplaceType") or "").lower()
    return RawJob(
        source="lever", external_id=f"{company}:{item['id']}", title=(item.get("text") or "").strip(),
        company_name=company.replace("-", " ").title(), company_slug=company, description_text=desc,
        location_text=loc or "India", city=loc.split(",")[0].strip() or None, country="IN",
        remote_type={"remote": "remote", "hybrid": "hybrid"}.get(wt, "onsite"),
        job_type=norm_job_type(cats.get("commitment")),
        apply_url=https_on_domain(item.get("applyUrl"), DOMAINS) or url, posting_url=url,
        posted_at=parse_dt(item.get("createdAt")), version=str(item.get("createdAt") or ""),
    )


class Lever(Provider):
    domains = DOMAINS
    name = "lever"
    kind = "jobs"
    label = "Lever"

    def boards(self, settings: dict) -> List[str]:
        return [str(b).strip() for b in (settings.get("lever_boards") or []) if str(b).strip()][:25]

    def configured(self, settings: dict) -> bool:
        return bool(self.boards(settings))

    def not_configured_reason(self, settings: dict) -> Optional[str]:
        return None if self.boards(settings) else "not configured (no company sites)"

    def source_label(self, company: str) -> str:
        return f"{company} careers · Lever" if company else "Lever"

    async def fetch_board(self, client: httpx.AsyncClient, company: str, result: FetchResult) -> int:
        r = await client.get(f"{API}/{company}", params={"mode": "json"})
        result.requests += 1
        r.raise_for_status()
        rows = r.json() or []
        for item in rows:
            job = parse_posting(item, company)
            if job:
                result.items.append(job)
        result.complete_scopes.add(company)
        return len(rows)

    async def fetch(self, client: httpx.AsyncClient, settings: dict) -> FetchResult:
        result = FetchResult(complete_scopes=set())
        sem = asyncio.Semaphore(2)

        async def one(c):
            async with sem:
                try:
                    await self.fetch_board(client, c, result)
                except Exception as exc:
                    result.errors.append(f"{c}: {safe_error(exc)}")

        await asyncio.gather(*(one(c) for c in self.boards(settings)))
        if result.errors and not result.complete_scopes:
            raise RuntimeError("; ".join(result.errors)[:500])
        return result

    async def test(self, client: httpx.AsyncClient, company: str) -> dict:
        result = FetchResult(complete_scopes=set())
        total = await self.fetch_board(client, company, result)
        return {"count": len(result.items), "total_all_countries": total, "sample": [j.title for j in result.items[:5]], "company": company}
