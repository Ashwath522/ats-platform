"""Greenhouse Job Board API (public, no key) for configured board tokens.

GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
→ {"jobs": [{id, title, updated_at, first_published, location{name}, absolute_url,
   content (HTML, entity-escaped), departments[], offices[]}], "meta": {"total": N}}
Only India-based postings are kept. Disabled when no boards are configured.
"""
from __future__ import annotations

import asyncio
from typing import List, Optional

import httpx

from .base import FetchResult, Provider, RawJob, clean_html, https_on_domain, looks_indian, parse_dt, safe_error

API = "https://boards-api.greenhouse.io/v1/boards"
DOMAINS = ("greenhouse.io",)


def parse_job(item: dict, token: str, company: Optional[str] = None) -> Optional[RawJob]:
    loc = ((item.get("location") or {}).get("name") or "").strip()
    offices = " ".join((o.get("name") or "") + " " + (o.get("location") or "") for o in (item.get("offices") or []))
    if not looks_indian(loc, offices):
        return None
    jid = str(item.get("id") or "")
    if not jid:
        return None
    # absolute_url may be a custom careers domain; the canonical board URL always works.
    url = https_on_domain(item.get("absolute_url"), DOMAINS) or f"https://boards.greenhouse.io/{token}/jobs/{jid}"
    remote = "remote" if "remote" in loc.lower() else ("hybrid" if "hybrid" in loc.lower() else "onsite")
    name = company or (item.get("company_name") or token.replace("-", " ").title())
    return RawJob(
        source="greenhouse", external_id=f"{token}:{jid}", title=(item.get("title") or "").strip(),
        company_name=name, company_slug=token, description_text=clean_html(item.get("content")),
        location_text=loc or "India", city=loc.split(",")[0].strip() or None, country="IN", remote_type=remote,
        apply_url=url, posting_url=url, posted_at=parse_dt(item.get("first_published") or item.get("updated_at")),
        version=str(item.get("updated_at") or ""),
    )


class Greenhouse(Provider):
    domains = DOMAINS
    name = "greenhouse"
    kind = "jobs"
    label = "Greenhouse"

    def boards(self, settings: dict) -> List[str]:
        return [str(b).strip() for b in (settings.get("greenhouse_boards") or []) if str(b).strip()][:25]

    def configured(self, settings: dict) -> bool:
        return bool(self.boards(settings))

    def not_configured_reason(self, settings: dict) -> Optional[str]:
        return None if self.boards(settings) else "not configured (no board tokens)"

    def source_label(self, company: str) -> str:
        return f"{company} careers · Greenhouse" if company else "Greenhouse"

    async def fetch_board(self, client: httpx.AsyncClient, token: str, result: FetchResult) -> int:
        r = await client.get(f"{API}/{token}/jobs", params={"content": "true"})
        result.requests += 1
        r.raise_for_status()
        jobs = r.json().get("jobs") or []
        for item in jobs:
            job = parse_job(item, token)
            if job:
                result.items.append(job)
        result.complete_scopes.add(token)
        return len(jobs)

    async def fetch(self, client: httpx.AsyncClient, settings: dict) -> FetchResult:
        result = FetchResult(complete_scopes=set())
        sem = asyncio.Semaphore(2)

        async def one(t):
            async with sem:
                try:
                    await self.fetch_board(client, t, result)
                except Exception as exc:
                    result.errors.append(f"{t}: {safe_error(exc)}")

        await asyncio.gather(*(one(t) for t in self.boards(settings)))
        if result.errors and not result.complete_scopes:
            raise RuntimeError("; ".join(result.errors)[:500])
        return result

    async def test(self, client: httpx.AsyncClient, token: str) -> dict:
        result = FetchResult(complete_scopes=set())
        total = await self.fetch_board(client, token, result)
        return {"count": len(result.items), "total_all_countries": total, "sample": [j.title for j in result.items[:5]], "company": token}
