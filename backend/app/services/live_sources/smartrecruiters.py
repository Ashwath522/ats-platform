"""SmartRecruiters public Posting API (no key; the documented, public
career-site API that companies expose for their own job boards).

List:   GET https://api.smartrecruiters.com/v1/companies/{id}/postings?country=in&limit=100&offset=N
Detail: GET {ref}   (= .../postings/{postingId}) → applyUrl, postingUrl, jobAd.sections, active
"""
from __future__ import annotations

import asyncio
from typing import List, Optional

import httpx

from .base import FetchResult, Provider, RawJob, clean_html, https_on_domain, norm_job_type, parse_dt, safe_error

API = "https://api.smartrecruiters.com/v1/companies"
DOMAINS = ("smartrecruiters.com",)
PAGE = 100
CAP_PER_COMPANY = 400
DEFAULT_COMPANIES = ["BoschGroup", "Wabtec", "Continental"]

_EXP = {
    "internship": "fresher", "entry_level": "fresher", "associate": "0-2",
    "mid_senior_level": "2-5", "director": "5+", "executive": "5+",
}


def _remote(loc: dict) -> str:
    if loc.get("remote"):
        return "remote"
    if loc.get("hybrid"):
        return "hybrid"
    return "onsite"


def _location_text(loc: dict) -> str:
    parts = [str(loc.get(k) or "").strip() for k in ("city", "region")]
    parts = [p.title() if p.islower() else p for p in parts if p]
    country = (loc.get("country") or "").lower()
    parts.append("India" if country == "in" else country.upper())
    return ", ".join(p for p in parts if p)


def parse_posting(item: dict, company_id: str) -> RawJob:
    loc = item.get("location") or {}
    company = item.get("company") or {}
    exp = (item.get("experienceLevel") or {}).get("id")
    jtype = norm_job_type((item.get("typeOfEmployment") or {}).get("label"))
    if exp == "internship":
        jtype = "internship"
    city = (loc.get("city") or "").strip()
    return RawJob(
        source="smartrecruiters",
        external_id=str(item.get("id")),
        title=(item.get("name") or "").strip(),
        company_name=(company.get("name") or company_id).strip(),
        company_slug=company_id,
        location_text=_location_text(loc),
        city=city.title() if city.islower() else city or None,
        country=(loc.get("country") or "").upper() or None,
        remote_type=_remote(loc),
        job_type=jtype,
        experience_level=_EXP.get(exp or ""),
        posted_at=parse_dt(item.get("releasedDate")),
        version=str(item.get("releasedDate") or ""),
        detail_ref=item.get("ref") or f"{API}/{company_id}/postings/{item.get('id')}",
        posting_url=https_on_domain(item.get("postingUrl"), DOMAINS),
        apply_url=https_on_domain(item.get("applyUrl"), DOMAINS) or "",
        has_detail=False,
    )


def apply_detail(job: RawJob, d: dict) -> RawJob:
    sections = ((d.get("jobAd") or {}).get("sections") or {})
    parts: List[str] = []
    for key in ("jobDescription", "qualifications", "additionalInformation", "companyDescription"):
        sec = sections.get(key) or {}
        text = clean_html(sec.get("text"))
        if text:
            title = (sec.get("title") or "").strip()
            parts.append(f"{title}\n{text}" if title else text)
    job.description_text = clean_html("\n\n".join(parts).replace("\n", "<br>"))
    job.apply_url = https_on_domain(d.get("applyUrl"), DOMAINS) or job.apply_url
    job.posting_url = https_on_domain(d.get("postingUrl"), DOMAINS) or job.posting_url
    if d.get("active") is False:
        job.active = False
    if d.get("releasedDate"):
        job.posted_at = parse_dt(d.get("releasedDate")) or job.posted_at
    job.has_detail = True
    return job


class SmartRecruiters(Provider):
    domains = DOMAINS
    name = "smartrecruiters"
    kind = "jobs"
    label = "SmartRecruiters"

    def companies(self, settings: dict) -> List[str]:
        ids = settings.get("smartrecruiters_companies")
        if ids is None:
            ids = DEFAULT_COMPANIES
        return [str(i).strip() for i in ids if str(i).strip()][:25]

    def configured(self, settings: dict) -> bool:
        return bool(self.companies(settings))

    def not_configured_reason(self, settings: dict) -> Optional[str]:
        return None if self.companies(settings) else "not configured (no company ids)"

    def source_label(self, company: str) -> str:
        return f"{company} careers · SmartRecruiters" if company else "SmartRecruiters"

    async def fetch_company(self, client: httpx.AsyncClient, company_id: str, result: FetchResult, cap: int = CAP_PER_COMPANY) -> int:
        """Append the company's India postings to result; returns totalFound.
        Adds the company to complete_scopes when every posting was listed."""
        offset, total, seen = 0, None, 0
        while offset < cap:
            r = await client.get(f"{API}/{company_id}/postings", params={"country": "in", "limit": PAGE, "offset": offset})
            result.requests += 1
            r.raise_for_status()
            data = r.json()
            total = int(data.get("totalFound") or 0)
            content = data.get("content") or []
            for item in content:
                if seen >= cap:
                    break
                result.items.append(parse_posting(item, company_id))
                seen += 1
            offset += PAGE
            if not content or offset >= total:
                break
        if total is not None and seen >= total:
            result.complete_scopes.add(company_id)
        return total or 0

    def scopes(self, settings: dict) -> List[str]:
        return self.companies(settings)

    async def fetch_scope(self, client: httpx.AsyncClient, settings: dict, scope: str) -> FetchResult:
        """One company's postings (the sync publishes them before fetching the next company)."""
        result = FetchResult(complete_scopes=set())
        await self.fetch_company(client, scope, result)
        return result

    async def fetch(self, client: httpx.AsyncClient, settings: dict) -> FetchResult:
        result = FetchResult(complete_scopes=set())
        sem = asyncio.Semaphore(2)

        async def one(cid: str):
            async with sem:
                try:
                    await self.fetch_company(client, cid, result)
                except Exception as exc:  # one company failing never stops the others
                    result.errors.append(f"{cid}: {safe_error(exc)}")

        await asyncio.gather(*(one(c) for c in self.companies(settings)))
        if result.errors and not result.items:
            raise RuntimeError("; ".join(result.errors)[:500])
        return result

    async def enrich(self, client: httpx.AsyncClient, job: RawJob) -> RawJob:
        url = job.detail_ref or ""
        if not url.startswith(API + "/"):
            url = f"{API}/{job.company_slug}/postings/{job.external_id}"
        r = await client.get(url)
        if r.status_code in (404, 410):
            job.active = False
            job.has_detail = True
            return job
        r.raise_for_status()
        return apply_detail(job, r.json())

    async def test(self, client: httpx.AsyncClient, company_id: str) -> dict:
        result = FetchResult(complete_scopes=set())
        total = await self.fetch_company(client, company_id, result, cap=PAGE)
        return {"count": total, "sample": [j.title for j in result.items[:5]],
                "company": result.items[0].company_name if result.items else company_id}
