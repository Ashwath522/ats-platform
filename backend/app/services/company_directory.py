"""Company directory: real core-engineering employers + demo companies.

* ``index()``             - cached directory (rows + lookup maps), seeded on demand
* ``slug_for_job(job)``    - which directory company an internal Job belongs to
* ``slug_for_external(e)`` - same for a live ExternalJob (SmartRecruiters id / name)
* ``company_roles(slug)``  - the company's REAL open internal jobs + live listings
* ``role_counts()``        - {slug: {"jobs": n, "internships": m}} for the grid
* ``follow_feed(s, cid)``  - bell items "New role at <company>: <title>"
* ``notify_new_internal_job(job)`` / ``notify_new_external_jobs(rows)`` - at most
  one email per followed company per student per day (respects the student's
  Settings -> Notifications switches)

Matching never guesses across companies: SmartRecruiters ids and exact
normalised names (official name + names used by live sources) only.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import timedelta
from types import SimpleNamespace
from typing import Dict, Iterable, List, Optional

from sqlmodel import Session, select

from ..db import CompanyDirectory, CompanyFollow, CompanyProfile, PlatformSetting, engine, utc_now
from . import company_seed
from .cache import TTLCache, install

install(engine)
log = logging.getLogger("ats-platform.company_directory")

dir_cache = TTLCache("company_directory_v2", ttl=300, tables={"companydirectory", "companyprofile", "platformsetting"})
counts_cache = TTLCache("company_role_counts", ttl=60,
                        tables={"companydirectory", "companyprofile", "job", "externaljob", "company"})

SEED_KEY = "company_directory_seed_version"
FAVICON = "https://www.google.com/s2/favicons?domain={domain}&sz=128"
MAX_FEED = 10
EMAIL_CATEGORY = "company_follow"

_DROP = {"ltd", "limited", "pvt", "private", "inc", "plc", "group", "india", "co", "company", "corporation", "corp",
         "llc", "llp", "gmbh", "ag", "se", "sa", "the", "and", "of", "mfg"}


def norm_name(value: Optional[str]) -> str:
    s = (value or "").lower().replace("&", " and ").replace("·", " ")
    toks = [t for t in re.split(r"[^a-z0-9]+", s) if t and t not in _DROP]
    return " ".join(toks)


def _jl(raw, default):
    try:
        v = json.loads(raw) if raw else default
        return v if v is not None else default
    except (TypeError, ValueError):
        return default


def _iso(d):
    return d.replace(microsecond=0).isoformat() + "Z" if d else None


# ── seeding ──────────────────────────────────────────────────────────────────

def _apply_seed(row: CompanyDirectory, c: dict) -> None:
    row.name = c["name"]
    row.domain = c.get("domain")
    row.website = c.get("website")
    row.careers_url = c.get("careers_url")
    row.industry = c.get("industry")
    row.branches_json = json.dumps(c.get("branches") or [])
    row.hq = c.get("hq")
    row.india_locations_json = json.dumps(c.get("india") or [])
    row.about = c.get("about")
    row.employee_band = c.get("employee_band")
    row.founded = c.get("founded")
    row.smartrecruiters_id = c.get("smartrecruiters_id")
    row.live_source_names_json = json.dumps(c.get("live_names") or [])
    row.is_demo = False
    row.updated_at = utc_now()


def ensure_seeded(s: Session) -> bool:
    """Upsert the real-company seed when the stored seed version differs or a
    seed row is missing. Returns True when anything was written."""
    marker = s.get(PlatformSetting, SEED_KEY)
    have = {r.slug: r for r in s.exec(select(CompanyDirectory).where(CompanyDirectory.is_demo == False)).all()}  # noqa: E712
    if marker and marker.value_json == json.dumps(company_seed.SEED_VERSION) and all(c["slug"] in have for c in company_seed.COMPANIES):
        return False
    for c in company_seed.COMPANIES:
        row = have.get(c["slug"])
        if row is None:
            row = s.exec(select(CompanyDirectory).where(CompanyDirectory.slug == c["slug"])).first() or CompanyDirectory(slug=c["slug"], name=c["name"])
        _apply_seed(row, c)
        s.add(row)
    if marker:
        marker.value_json = json.dumps(company_seed.SEED_VERSION)
        marker.updated_at = utc_now()
    else:
        marker = PlatformSetting(key=SEED_KEY, value_json=json.dumps(company_seed.SEED_VERSION))
    s.add(marker)
    s.commit()
    return True


# ── index ────────────────────────────────────────────────────────────────────

def public_row(r: CompanyDirectory, logo_path: Optional[str] = None) -> dict:
    return {
        "slug": r.slug, "name": r.name, "domain": r.domain, "website": r.website, "careers_url": r.careers_url,
        "industry": r.industry, "branches": _jl(r.branches_json, []), "hq": r.hq,
        "india_locations": _jl(r.india_locations_json, []), "about": r.about, "employee_band": r.employee_band,
        "founded": r.founded, "is_demo": bool(r.is_demo), "smartrecruiters_id": r.smartrecruiters_id,
        "live_source_names": _jl(r.live_source_names_json, []),
        "logo_url": f"/media/{logo_path}" if logo_path else None,
        "favicon_url": FAVICON.format(domain=r.domain) if r.domain else None,
    }


def index() -> SimpleNamespace:
    """Cached directory. Read-only; cleared on any directory/profile write."""
    def load():
        with Session(engine) as s:
            try:
                ensure_seeded(s)
            except Exception:  # pragma: no cover - never break a page over seeding
                log.exception("[DIRECTORY] seeding failed")
                s.rollback()
            rows = s.exec(select(CompanyDirectory).order_by(CompanyDirectory.is_demo, CompanyDirectory.name)).all()
            profiles = s.exec(select(CompanyProfile.id, CompanyProfile.owner_recruiter_id, CompanyProfile.name, CompanyProfile.logo_path)).all()
        prof_by_id = {pid: (owner, name, logo) for pid, owner, name, logo in profiles}
        by_slug: Dict[str, dict] = {}
        name_to_slug: Dict[str, str] = {}
        sr_to_slug: Dict[str, str] = {}
        rec_to_slug: Dict[int, str] = {}
        demo_recruiters = set()
        for r in rows:
            logo = prof_by_id.get(r.company_profile_id, (None, None, None))[2] if r.company_profile_id else None
            d = public_row(r, logo)
            by_slug[r.slug] = d
            for n in [r.name] + d["live_source_names"]:
                k = norm_name(n)
                if k:
                    name_to_slug.setdefault(k, r.slug)
            if r.smartrecruiters_id:
                sr_to_slug[r.smartrecruiters_id.lower()] = r.slug
            if r.company_profile_id and r.company_profile_id in prof_by_id:
                owner = prof_by_id[r.company_profile_id][0]
                rec_to_slug[owner] = r.slug
                if r.is_demo:
                    demo_recruiters.add(owner)
        # A recruiter company profile whose name is a directory company's name
        # (e.g. an approved Bosch recruiter) is linked to that portfolio. Demo
        # entries are only ever linked explicitly.
        for pid, (owner, name, _logo) in prof_by_id.items():
            if owner in rec_to_slug:
                continue
            slug = name_to_slug.get(norm_name(name))
            if slug and not by_slug[slug]["is_demo"]:
                rec_to_slug[owner] = slug
        return SimpleNamespace(rows=list(by_slug.values()), by_slug=by_slug, name_to_slug=name_to_slug,
                               sr_to_slug=sr_to_slug, rec_to_slug=rec_to_slug, demo_recruiters=demo_recruiters,
                               demo_slugs={k for k, v in by_slug.items() if v["is_demo"]})
    return dir_cache.get_or_set("index", load)


def slug_for_job(job, ix: Optional[SimpleNamespace] = None) -> Optional[str]:
    if job is None:
        return None
    ix = ix or index()
    slug = ix.rec_to_slug.get(job.recruiter_id)
    if slug:
        return slug
    from .hot_data import company_of
    return ix.name_to_slug.get(norm_name(company_of(job)[0]))


def slug_for_external(e, ix: Optional[SimpleNamespace] = None) -> Optional[str]:
    if e is None:
        return None
    ix = ix or index()
    if e.source == "smartrecruiters" and e.company_slug:
        slug = ix.sr_to_slug.get(e.company_slug.lower())
        if slug:
            return slug
    slug = ix.name_to_slug.get(norm_name(e.company_name))
    if slug and slug in ix.demo_slugs:
        return None   # live listings never map onto fictional demo companies
    return slug


def card_meta(slug: Optional[str], ix: Optional[SimpleNamespace] = None) -> dict:
    """Fields added to every opportunity card so the UI can show the company's
    site icon, a Demo tag and a link to its portfolio."""
    ix = ix or index()
    c = ix.by_slug.get(slug) if slug else None
    if not c:
        return {"company_slug": None, "company_domain": None, "company_demo": False}
    return {"company_slug": c["slug"], "company_domain": c["domain"], "company_demo": c["is_demo"]}


def is_demo_recruiter(recruiter_id: Optional[int]) -> bool:
    return bool(recruiter_id is not None and recruiter_id in index().demo_recruiters)


def is_demo_company_name(name: Optional[str]) -> bool:
    from .demo_company_data import DEMO_PREFIX
    return bool(name and name.startswith(DEMO_PREFIX.strip()))


# ── roles ────────────────────────────────────────────────────────────────────

def _visible_external():
    from ..api.live_data import best_per_key
    from .hot_data import visible_external_jobs
    return best_per_key(visible_external_jobs())


def company_roles(slug: str):
    """(internal open Jobs, live ExternalJobs) for one company, newest first."""
    from .hot_data import open_jobs
    ix = index()
    internal = [j for j in open_jobs() if slug_for_job(j, ix) == slug]
    external = [e for e in _visible_external() if slug_for_external(e, ix) == slug]
    return internal, external


def role_counts() -> Dict[str, dict]:
    def load():
        from .hot_data import open_jobs
        ix = index()
        out: Dict[str, dict] = {}
        for j in open_jobs():
            slug = slug_for_job(j, ix)
            if slug:
                c = out.setdefault(slug, {"jobs": 0, "internships": 0})
                c["internships" if (j.job_type or "") == "internship" else "jobs"] += 1
        for e in _visible_external():
            slug = slug_for_external(e, ix)
            if slug:
                c = out.setdefault(slug, {"jobs": 0, "internships": 0})
                c["internships" if (e.job_type or "") == "internship" else "jobs"] += 1
        return out
    return counts_cache.get_or_set("counts", load)


# ── follow feed (bell) ───────────────────────────────────────────────────────

def follow_feed(s: Session, cid: int, limit: int = MAX_FEED, follows: Optional[list] = None) -> List[dict]:
    """`follows` = [(slug, followed_at)] when the caller already loaded them."""
    if follows is None:
        follows = s.exec(select(CompanyFollow.company_slug, CompanyFollow.created_at).where(CompanyFollow.candidate_id == cid)).all()
    if not follows:
        return []
    since = {slug: at for slug, at in follows}
    from .hot_data import open_jobs
    ix = index()
    items = []
    for j in open_jobs():
        slug = slug_for_job(j, ix)
        if slug in since and j.created_at and j.created_at > since[slug]:
            items.append((j.created_at, slug, j.title, str(j.id)))
    for e in _visible_external():
        slug = slug_for_external(e, ix)
        at = e.first_seen_at
        if slug in since and at and at > since[slug]:
            items.append((at, slug, e.title, f"ext-{e.id}"))
    items.sort(key=lambda t: t[0], reverse=True)
    out = []
    for at, slug, title, key in items[:limit]:
        name = ix.by_slug.get(slug, {}).get("name", slug)
        out.append({"title": f"New role at {name}: {title}", "at": _iso(at),
                    "link": f"/candidate/companies/{slug}?job={key}", "kind": "company_job", "company_slug": slug})
    return out


# ── email notifications ──────────────────────────────────────────────────────

def _wants_job_emails(notifications_json: Optional[str]) -> bool:
    prefs = _jl(notifications_json, {}) or {}
    return prefs.get("email", True) is not False and prefs.get("job_alerts", True) is not False


def _notify(slug: str, titles: List[str]) -> int:
    """Queue at most one email per follower per company per 24 h. Returns emails queued."""
    from ..db import CandidateProfile, CandidateUser, EmailLog
    from . import email_templates
    from .email_delivery import queue_email

    ix = index()
    company = ix.by_slug.get(slug)
    if not company or not titles:
        return 0
    category = f"{EMAIL_CATEGORY}:{slug}"[:80]
    day_ago = utc_now() - timedelta(hours=24)
    sent = 0
    with Session(engine) as s:
        rows = s.exec(select(CompanyFollow, CandidateUser, CandidateProfile)
                      .join(CandidateUser, CandidateUser.id == CompanyFollow.candidate_id)
                      .outerjoin(CandidateProfile, CandidateProfile.candidate_id == CompanyFollow.candidate_id)
                      .where(CompanyFollow.company_slug == slug, CompanyFollow.notify_email == True)).all()  # noqa: E712
        for follow, user, profile in rows:
            if (user.status or "active") == "suspended":
                continue
            if profile is not None and not _wants_job_emails(profile.notifications_json):
                continue
            to = (profile.contact_email if profile and profile.contact_email else None) or user.username
            if not to or "@" not in to:
                continue
            recent = s.exec(select(EmailLog.id).where(EmailLog.to_email == to, EmailLog.category == category,
                                                     EmailLog.created_at > day_ago)).first()
            if recent:
                continue
            name = profile.full_name if profile else None
            subject, text, html = email_templates.company_follow_new_roles(name, company["name"], titles, slug)
            queue_email(to, subject, text, html=html, category=category)
            sent += 1
    return sent


def notify_new_internal_job(job) -> int:
    """Call after an internal job is created as / changed to 'open'."""
    try:
        if job is None or job.status != "open":
            return 0
        slug = slug_for_job(job)
        return _notify(slug, [job.title]) if slug else 0
    except Exception:  # never fail the recruiter's request over a notification
        log.exception("[DIRECTORY] follow notification failed")
        return 0


def notify_new_external_jobs(rows: Iterable) -> int:
    """Call after live sync added ExternalJob rows."""
    try:
        ix = index()
        by: Dict[str, List[str]] = {}
        for e in rows:
            if getattr(e, "status", "active") != "active":
                continue
            slug = slug_for_external(e, ix)
            if slug:
                by.setdefault(slug, []).append(e.title)
        return sum(_notify(slug, titles) for slug, titles in by.items())
    except Exception:
        log.exception("[DIRECTORY] live follow notification failed")
        return 0
