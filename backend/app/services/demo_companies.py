"""Create / refresh / remove the 20 fictional DEMO companies.

``create_or_refresh()`` is idempotent:
* a recruiter account (User + legacy RecruiterUser) is created only when it does
  not exist - only then a strong random password is generated and returned
  (once; only its bcrypt hash is stored);
* the company profile, directory entry and 3-4 jobs are upserted every time
  (jobs matched by title), so refreshing never duplicates anything.

``remove_all()`` deletes every demo company with its recruiter, jobs and all
applications / interviews / offers / notes / saved jobs on those jobs.
"""
from __future__ import annotations

import json
import secrets
import string
from typing import Dict, List, Optional

from sqlalchemy import delete as sa_delete, or_
from sqlmodel import Session, select

from ..auth import hash_password
from ..db import (
    Application, CompanyDirectory, CompanyFollow, CompanyProfile, DecisionAuditLog, EmailToken, InterviewSession, Job,
    Offer, RecruiterNote, RecruiterPost, RecruiterProfile, RecruiterUser, SavedJob, ScheduledInterview, TeamMember,
    User, engine, utc_now,
)
from .demo_company_data import DEMO_COMPANIES, DEMO_EMAIL_DOMAIN, DEMO_PREFIX

DEMO_NOTE = "This is a fictional DEMO company created for testing CoreLink. It is not a real employer."


def demo_slug(key: str) -> str:
    return f"demo-{key}"


def demo_email(key: str) -> str:
    return f"recruiter@{key}.{DEMO_EMAIL_DOMAIN}"


def is_demo_email(email: Optional[str]) -> bool:
    return bool(email and email.lower().endswith(f".{DEMO_EMAIL_DOMAIN}"))


def strong_password(length: int = 18) -> str:
    """Random password with upper, lower, digit and symbol characters."""
    symbols = "@#%+=!?"
    alphabet = string.ascii_letters + string.digits + symbols
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.islower() for c in pw) and any(c.isupper() for c in pw)
                and any(c.isdigit() for c in pw) and any(c in symbols for c in pw)):
            return pw


def _job_description(company: dict, job: tuple) -> str:
    title, branch, job_type, city, lo, hi, exp, reqs, summary = job
    kind = "internship (6 months)" if job_type == "internship" else "full-time role"
    pay = (f"Stipend: ₹{lo:,}–₹{hi:,} per month." if job_type == "internship" else f"CTC: ₹{lo / 100000:.1f}–{hi / 100000:.1f} LPA.")
    return (
        f"[DEMO LISTING — fictional company for testing] {DEMO_PREFIX}{company['name']} is hiring for a {kind} in {city}.\n\n"
        f"What you will do\n{summary}\n\n"
        f"What we look for\n- B.E./B.Tech in a relevant core branch\n- Hands-on skills: {reqs}\n"
        f"- Clear communication and willingness to work on the shop floor / site when needed\n\n"
        f"{pay}\n\n{DEMO_NOTE}"
    )


def _company_profile_fields(cp: CompanyProfile, c: dict) -> None:
    cities = sorted({j[3] for j in c["jobs"]} | {c["hq"]})
    cp.name = f"{DEMO_PREFIX}{c['name']}"
    cp.tagline = f"{c['industry']} · fictional demo company"
    cp.industries_json = json.dumps([c["industry"]])
    cp.headquarters = f"{c['hq']}, India"
    cp.location_text = f"{c['hq']}, India"
    cp.website = None
    cp.about = f"{c['about']} {DEMO_NOTE}"
    cp.mission = c["mission"]
    cp.company_type = "Demo (fictional)"
    cp.locations_json = json.dumps([{"name": city, "address": f"{city}, India", "tag": "Office" if city != c["hq"] else "Headquarters",
                                     "main": city == c["hq"]} for city in cities])
    cp.hiring_focus_json = json.dumps(c["focus"])
    cp.updated_at = utc_now()


def _ensure_account(s: Session, c: dict) -> tuple:
    """(RecruiterUser, password or None) - password only when the account is new."""
    email = demo_email(c["key"])
    user = s.exec(select(User).where(User.email == email)).first()
    password = None
    if user is None:
        password = strong_password()
        user = User(name=f"Demo Recruiter · {c['name']}", email=email, role="recruiter",
                    password_hash=hash_password(password), email_verified=True, status="active")
        s.add(user)
        s.flush()
    elif user.role != "recruiter":
        raise ValueError(f"{email} exists with role {user.role}")
    ru = s.exec(select(RecruiterUser).where(RecruiterUser.username == email)).first()
    if ru is None:
        ru = RecruiterUser(username=email, password_hash=user.password_hash)
        s.add(ru)
        s.flush()
    return ru, password


def create_or_refresh() -> dict:
    out: List[dict] = []
    created_accounts = 0
    with Session(engine) as s:
        for c in DEMO_COMPANIES:
            ru, password = _ensure_account(s, c)
            if password:
                created_accounts += 1
            cp = s.exec(select(CompanyProfile).where(CompanyProfile.owner_recruiter_id == ru.id)).first()
            if cp is None:
                cp = CompanyProfile(owner_recruiter_id=ru.id)
            _company_profile_fields(cp, c)
            s.add(cp)
            s.flush()

            slug = demo_slug(c["key"])
            d = s.exec(select(CompanyDirectory).where(CompanyDirectory.slug == slug)).first() or CompanyDirectory(slug=slug, name="")
            d.name = f"{DEMO_PREFIX}{c['name']}"
            d.domain = None
            d.website = None
            d.industry = c["industry"]
            d.branches_json = json.dumps(sorted({j[1] for j in c["jobs"]} | set(c["branches"])))
            d.hq = f"{c['hq']}, India"
            d.india_locations_json = json.dumps(sorted({j[3] for j in c["jobs"]} | {c["hq"]}))
            d.about = f"{c['about']} {DEMO_NOTE}"
            d.is_demo = True
            d.company_profile_id = cp.id
            d.live_source_names_json = "[]"
            d.updated_at = utc_now()
            s.add(d)

            existing = {j.title: j for j in s.exec(select(Job).where(Job.recruiter_id == ru.id)).all()}
            for spec in c["jobs"]:
                title, branch, job_type, city, lo, hi, exp, reqs, _summary = spec
                job = existing.get(title) or Job(recruiter_id=ru.id, title=title, description="")
                job.description = _job_description(c, spec)
                job.branch = branch
                job.job_type = job_type
                job.location_text = f"{city}, India"
                job.salary_min, job.salary_max, job.currency = float(lo), float(hi), "INR"
                job.experience_level = exp
                job.requirements = reqs
                job.remote_type = "onsite"
                job.status = "open"
                job.openings = 2 if job_type == "internship" else 3
                job.eligibility = "B.E./B.Tech (final year or recent graduates). Demo listing for testing."
                job.updated_at = utc_now()
                s.add(job)
            s.flush()
            n_jobs = len(s.exec(select(Job.id).where(Job.recruiter_id == ru.id, Job.status == "open")).all())
            out.append({"company": d.name, "slug": slug, "email": ru.username, "password": password,
                        "created": password is not None, "jobs": n_jobs})
        s.commit()
    return {"companies": len(out), "accounts_created": created_accounts, "logins": out}


def _demo_recruiters(s: Session) -> Dict[int, str]:
    rows = s.exec(select(RecruiterUser).where(RecruiterUser.username.like(f"%.{DEMO_EMAIL_DOMAIN}"))).all()
    return {r.id: r.username for r in rows}


def status() -> dict:
    with Session(engine) as s:
        recs = _demo_recruiters(s)
        companies = len(s.exec(select(CompanyDirectory.id).where(CompanyDirectory.is_demo == True)).all())  # noqa: E712
        job_ids = list(s.exec(select(Job.id).where(Job.recruiter_id.in_(list(recs) or [-1]))).all())
        apps = len(s.exec(select(Application.id).where(Application.job_id.in_(job_ids or [-1]))).all())
        return {"companies": companies, "recruiters": len(recs), "jobs": len(job_ids), "applications": apps}


def remove_all() -> dict:
    with Session(engine) as s:
        recs = _demo_recruiters(s)
        rids = list(recs) or [-1]
        job_ids = list(s.exec(select(Job.id).where(Job.recruiter_id.in_(rids))).all()) or [-1]
        app_ids = list(s.exec(select(Application.id).where(Application.job_id.in_(job_ids))).all()) or [-1]
        counts = {"companies": 0, "recruiters": len(recs), "jobs": len([j for j in job_ids if j != -1]),
                  "applications": len([a for a in app_ids if a != -1])}
        # audit rows stay (append-only) but are detached from deleted records
        for row in s.exec(select(DecisionAuditLog).where(or_(DecisionAuditLog.job_id.in_(job_ids),
                                                             DecisionAuditLog.application_id.in_(app_ids)))).all():
            row.job_id = None
            row.application_id = None
            s.add(row)
        s.flush()
        try:
            from ..db import ProctorEvent, ProctorSnapshot
            sess_ids = list(s.exec(select(InterviewSession.id).where(or_(InterviewSession.application_id.in_(app_ids),
                                                                       InterviewSession.job_id.in_(job_ids)))).all()) or [-1]
            s.execute(sa_delete(ProctorEvent).where(ProctorEvent.session_id.in_(sess_ids)))
            s.execute(sa_delete(ProctorSnapshot).where(ProctorSnapshot.session_id.in_(sess_ids)))
        except ImportError:  # pragma: no cover
            pass
        s.execute(sa_delete(Offer).where(or_(Offer.job_id.in_(job_ids), Offer.application_id.in_(app_ids))))
        s.execute(sa_delete(ScheduledInterview).where(or_(ScheduledInterview.job_id.in_(job_ids), ScheduledInterview.application_id.in_(app_ids))))
        s.execute(sa_delete(InterviewSession).where(or_(InterviewSession.application_id.in_(app_ids), InterviewSession.job_id.in_(job_ids))))
        s.execute(sa_delete(RecruiterNote).where(or_(RecruiterNote.recruiter_id.in_(rids), RecruiterNote.application_id.in_(app_ids))))
        s.execute(sa_delete(SavedJob).where(SavedJob.job_id.in_(job_ids)))
        s.execute(sa_delete(Application).where(Application.id.in_(app_ids)))
        s.execute(sa_delete(Job).where(Job.id.in_(job_ids)))
        s.execute(sa_delete(TeamMember).where(TeamMember.owner_recruiter_id.in_(rids)))
        s.execute(sa_delete(RecruiterPost).where(RecruiterPost.recruiter_id.in_(rids)))
        s.execute(sa_delete(RecruiterProfile).where(RecruiterProfile.recruiter_id.in_(rids)))
        s.execute(sa_delete(CompanyProfile).where(CompanyProfile.owner_recruiter_id.in_(rids)))
        demo_slugs = list(s.exec(select(CompanyDirectory.slug).where(CompanyDirectory.is_demo == True)).all())  # noqa: E712
        counts["companies"] = len(demo_slugs)
        if demo_slugs:
            s.execute(sa_delete(CompanyFollow).where(CompanyFollow.company_slug.in_(demo_slugs)))
        s.execute(sa_delete(CompanyDirectory).where(CompanyDirectory.is_demo == True))  # noqa: E712
        emails = list(recs.values())
        if emails:
            s.execute(sa_delete(EmailToken).where(EmailToken.email.in_(emails)))
            s.execute(sa_delete(User).where(User.email.in_(emails), User.role == "recruiter"))
        s.execute(sa_delete(RecruiterUser).where(RecruiterUser.id.in_(rids)))
        s.commit()
    return {"deleted": True, **counts}
