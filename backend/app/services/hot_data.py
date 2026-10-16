"""Cached read-mostly data shared by the hot pages.

Everything here is *read-only*: cached ORM rows are detached copies - never
``session.add()`` them or mutate them; load a fresh row for writes.

* ``open_jobs()``            - the public job board (status=open, newest first)
* ``company_directory()``    - recruiter -> (company name, logo), company id -> name
* ``company_of(job)``        - (name, logo url) for a job, same rules as before
* ``visible_external_jobs()``- live listings from official job APIs
* ``promoted_skills()``      - DiscoveredSkill terms seen in >= 3 resumes (branch vocab)
* ``job_skills_cached(job)`` - memoised skill extraction per job version
* ``platform_settings()``    - admin System Settings (announcement, flags)

Each cache is cleared automatically when its tables are written (see
services/cache.py), so recruiters see their edits immediately.
"""
from __future__ import annotations

import os
from datetime import timedelta
from typing import Dict, List, Optional, Tuple

from sqlalchemy import literal, null, or_, union_all
from sqlmodel import Session, select

from ..db import Company, CompanyProfile, Job, engine, utc_now
from .cache import TTLCache, install

install(engine)

_TTL = float(os.environ.get("HOT_CACHE_TTL_SECONDS", "60"))

open_jobs_cache = TTLCache("open_jobs", ttl=_TTL, tables={"job"})
company_cache = TTLCache("company_directory", ttl=max(_TTL, 300), tables={"companyprofile", "company"})
external_cache = TTLCache("external_jobs", ttl=max(_TTL, 120), tables={"externaljob"})
vocab_cache = TTLCache("promoted_skills", ttl=max(_TTL, 300), tables={"discoveredskill"})
job_skill_cache = TTLCache("job_skills", ttl=max(_TTL, 600), tables={"job", "discoveredskill"}, max_entries=5000)
recruiter_jobs_cache = TTLCache("recruiter_jobs", ttl=_TTL, tables={"job"}, max_entries=2000)
company_page_cache = TTLCache("company_page", ttl=max(_TTL, 120), max_entries=2000,
                              tables={"companyprofile", "recruiterrequest", "job", "teammember", "recruiteruser", "recruiterprofile"})
settings_cache = TTLCache("platform_settings", ttl=_TTL, tables={"platformsetting"})

MAX_OPEN_JOBS = 1000
MAX_EXTERNAL = 2000


def _media(path: Optional[str]) -> Optional[str]:
    return f"/media/{path}" if path else None


def open_jobs() -> List[Job]:
    def load():
        with Session(engine) as s:
            return list(s.exec(select(Job).where(Job.status == "open").order_by(Job.created_at.desc()).limit(MAX_OPEN_JOBS)).all())
    return open_jobs_cache.get_or_set("open", load)


all_jobs_cache = TTLCache("all_jobs", ttl=_TTL, tables={"job"})


def all_jobs() -> List[Job]:
    """Every job row (admin dashboards). Read-only, cached, cleared on job writes."""
    def load():
        with Session(engine) as s:
            return list(s.exec(select(Job).limit(20000)).all())
    return all_jobs_cache.get_or_set("all", load)


def recruiter_jobs(rid: int) -> List[Job]:
    """A recruiter's jobs, newest first (read-only, cleared on any job write)."""
    def load():
        with Session(engine) as s:
            return list(s.exec(select(Job).where(Job.recruiter_id == rid).order_by(Job.created_at.desc())).all())
    return recruiter_jobs_cache.get_or_set(rid, load)


def company_directory() -> Tuple[Dict[int, tuple], Dict[int, str]]:
    """(recruiter_id -> (name, logo_url), company_id -> name) in ONE query."""
    def load():
        cp = select(literal("p").label("k"), CompanyProfile.owner_recruiter_id.label("i"),
                    CompanyProfile.name.label("n"), CompanyProfile.logo_path.label("l"))
        co = select(literal("c").label("k"), Company.id.label("i"), Company.name.label("n"), null().label("l"))
        by_rec, by_co = {}, {}
        with Session(engine) as s:
            for k, i, n, l in s.exec(union_all(cp, co)).all():
                if k == "p":
                    by_rec[i] = (n, _media(l))
                else:
                    by_co[i] = n or ""
        return by_rec, by_co
    return company_cache.get_or_set("all", load)


def company_of(job) -> tuple:
    """(company name, logo url) for a job - company row name wins, then the
    recruiter's company profile, else "Company" (unchanged rules)."""
    if not job:
        return "Company", None
    by_rec, by_co = company_directory()
    rp = by_rec.get(job.recruiter_id)
    logo = rp[1] if rp else None
    if job.company_id and by_co.get(job.company_id):
        return by_co[job.company_id], logo
    if rp and rp[0]:
        return rp[0], logo
    return "Company", logo


def visible_external_jobs():
    from ..db import ExternalJob
    from . import live_sync

    def load():
        cutoff = utc_now() - timedelta(days=live_sync.MAX_AGE_DAYS)
        with Session(engine) as s:
            return list(s.exec(select(ExternalJob)
                               .where(ExternalJob.status == "active")
                               .where(or_(ExternalJob.posted_at == None, ExternalJob.posted_at >= cutoff))  # noqa: E711
                               .order_by(ExternalJob.posted_at.desc()).limit(MAX_EXTERNAL)).all())
    return external_cache.get_or_set("visible", load)


def promoted_skills() -> List[tuple]:
    """[(term, branch)] for DiscoveredSkill rows seen in >= 3 resumes."""
    def load():
        from ..db import DiscoveredSkill
        try:
            with Session(engine) as s:
                return [(t, b) for t, b in s.exec(select(DiscoveredSkill.term, DiscoveredSkill.branch)
                                                    .where(DiscoveredSkill.occurrence_count >= 3)).all()]
        except Exception:
            return []
    return vocab_cache.get_or_set("promoted", load)


def job_skills_cached(job, compute) -> List[str]:
    key = (job.id, job.updated_at, hash(job.requirements or ""), hash(job.description or ""), job.branch)
    hit = job_skill_cache.get(key)
    if hit is not None:
        return list(hit)
    gen = job_skill_cache._gen
    value = compute(job)
    job_skill_cache.set(key, tuple(value), gen)
    return list(value)


def platform_settings(loader):
    return dict(settings_cache.get_or_set("settings", loader))
