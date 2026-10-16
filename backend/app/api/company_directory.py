"""Company directory API (students) + demo-company admin tools.

Student (candidate token):
  GET    /api/student/company-directory                 list + filters + facets
  GET    /api/student/company-directory/suggest?q=       instant suggestions
  GET    /api/student/company-directory/following        followed companies (+ new roles since follow)
  GET    /api/student/company-directory/{slug}           portfolio with real open roles
  POST   /api/student/company-directory/{slug}/follow    {notify_email?}
  PATCH  /api/student/company-directory/{slug}/follow    {notify_email}
  DELETE /api/student/company-directory/{slug}/follow

Admin (admin token):
  GET    /api/admin/demo/companies    counts of demo data
  POST   /api/admin/demo/companies    create / refresh the 20 demo companies (logins returned ONCE)
  DELETE /api/admin/demo/companies    remove all demo data incl. applications
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import Session, select
from starlette.concurrency import run_in_threadpool

from ..auth import get_current_admin, get_current_candidate
from ..db import Application, CompanyFollow, engine, utc_now
from ..services import company_directory as cd
from ..services import demo_companies

router = APIRouter(tags=["company_directory"])

P = "/api/student/company-directory"
MAX_FOLLOWS = 100
BRANCHES = ("mechanical", "civil", "eee", "ece", "chemical", "aerospace", "automobile", "metallurgy")


def _slug_ok(slug: str) -> str:
    slug = (slug or "").strip().lower()
    if not slug or len(slug) > 80 or not all(ch.isalnum() or ch == "-" for ch in slug):
        raise HTTPException(status_code=404, detail="Company not found")
    return slug


def _company_or_404(slug: str) -> dict:
    c = cd.index().by_slug.get(_slug_ok(slug))
    if not c:
        raise HTTPException(status_code=404, detail="Company not found")
    return c


def _summary(c: dict, counts: dict, following: set) -> dict:
    n = counts.get(c["slug"], {"jobs": 0, "internships": 0})
    return {
        "slug": c["slug"], "name": c["name"], "domain": c["domain"], "favicon_url": c["favicon_url"], "logo_url": c["logo_url"],
        "industry": c["industry"], "branches": c["branches"], "hq": c["hq"], "india_locations": c["india_locations"],
        "is_demo": c["is_demo"], "open_roles": n["jobs"] + n["internships"], "open_jobs": n["jobs"],
        "open_internships": n["internships"], "following": c["slug"] in following,
    }


def _following(s: Session, cid: int) -> dict:
    return {slug: (at, notify) for slug, at, notify in s.exec(
        select(CompanyFollow.company_slug, CompanyFollow.created_at, CompanyFollow.notify_email)
        .where(CompanyFollow.candidate_id == cid)).all()}


def _matches_q(c: dict, q: str) -> bool:
    hay = " ".join([c["name"], c["industry"] or "", c["hq"] or "", " ".join(c["india_locations"]), " ".join(c["live_source_names"])]).lower()
    return all(t in hay for t in q.lower().split())


@router.get(P)
def list_companies(
    q: Optional[str] = Query(None, max_length=80),
    branch: Optional[str] = Query(None, max_length=20),
    industry: Optional[str] = Query(None, max_length=80),
    location: Optional[str] = Query(None, max_length=60),
    hiring: bool = Query(False, description="only companies with open roles now"),
    following_only: bool = Query(False),
    demo: str = Query("all", pattern="^(all|real|demo)$"),
    sort: str = Query("relevance", pattern="^(relevance|roles|name)$"),
    page: int = Query(1, ge=1, le=100),
    page_size: int = Query(24, ge=1, le=48),
    candidate: str = Depends(get_current_candidate),
):
    from .student_portal import _user

    if branch and branch not in BRANCHES:
        raise HTTPException(status_code=422, detail="Unknown branch")
    with Session(engine) as s:
        user = _user(s, candidate)
        following = _following(s, user.id)
    ix = cd.index()
    counts = cd.role_counts()
    rows = [_summary(c, counts, set(following)) for c in ix.rows]
    facets = {
        "industries": sorted({r["industry"] for r in rows if r["industry"]}),
        "locations": sorted({loc for r in rows for loc in r["india_locations"]}),
        "branches": [b for b in BRANCHES if any(b in r["branches"] for r in rows)],
    }
    if q and q.strip():
        rows = [r for r in rows if _matches_q(ix.by_slug[r["slug"]], q.strip())]
    if branch:
        rows = [r for r in rows if branch in r["branches"]]
    if industry:
        rows = [r for r in rows if (r["industry"] or "").lower() == industry.strip().lower()]
    if location:
        loc = location.strip().lower()
        rows = [r for r in rows if any(loc in x.lower() for x in r["india_locations"]) or loc in (r["hq"] or "").lower()]
    if hiring:
        rows = [r for r in rows if r["open_roles"] > 0]
    if following_only:
        rows = [r for r in rows if r["following"]]
    if demo == "real":
        rows = [r for r in rows if not r["is_demo"]]
    elif demo == "demo":
        rows = [r for r in rows if r["is_demo"]]
    if sort == "name":
        rows.sort(key=lambda r: r["name"].lower())
    elif sort == "roles":
        rows.sort(key=lambda r: (-r["open_roles"], r["is_demo"], r["name"].lower()))
    else:  # real companies first (hiring first), demo companies after
        rows.sort(key=lambda r: (r["is_demo"], r["open_roles"] == 0, r["name"].lower()))
    total = len(rows)
    start = (page - 1) * page_size
    return {"items": rows[start:start + page_size], "total": total, "page": page, "page_size": page_size,
            "pages": max(1, -(-total // page_size)), "facets": facets, "following_count": len(following)}


@router.get(f"{P}/suggest")
def suggest(q: str = Query("", max_length=80), limit: int = Query(8, ge=1, le=15),
            candidate: str = Depends(get_current_candidate)):
    qs = q.strip().lower()
    ix = cd.index()
    counts = cd.role_counts()
    if not qs:
        return {"items": []}
    scored = []
    for c in ix.rows:
        name = c["name"].lower().replace("demo · ", "")
        if name.startswith(qs) or any(w.startswith(qs) for w in name.split()):
            rank = 0
        elif _matches_q(c, qs):
            rank = 1
        else:
            continue
        scored.append((rank, c["is_demo"], c["name"].lower(), c))
    scored.sort(key=lambda t: t[:3])
    items = []
    for _r, _d, _n, c in scored[:limit]:
        n = counts.get(c["slug"], {"jobs": 0, "internships": 0})
        items.append({"slug": c["slug"], "name": c["name"], "industry": c["industry"], "domain": c["domain"],
                      "favicon_url": c["favicon_url"], "logo_url": c["logo_url"], "is_demo": c["is_demo"],
                      "open_roles": n["jobs"] + n["internships"]})
    return {"items": items}


@router.get(f"{P}/following")
def following(candidate: str = Depends(get_current_candidate)):
    from .student_portal import _user

    with Session(engine) as s:
        user = _user(s, candidate)
        follows = _following(s, user.id)
        feed = cd.follow_feed(s, user.id, limit=50)
    ix = cd.index()
    counts = cd.role_counts()
    new_by = {}
    for item in feed:
        new_by[item["company_slug"]] = new_by.get(item["company_slug"], 0) + 1
    items = []
    for slug, (at, notify) in sorted(follows.items(), key=lambda kv: kv[1][0], reverse=True):
        c = ix.by_slug.get(slug)
        if not c:
            continue
        row = _summary(c, counts, set(follows))
        row.update({"followed_at": cd._iso(at), "notify_email": bool(notify), "new_roles": new_by.get(slug, 0)})
        items.append(row)
    return {"items": items, "total": len(items), "recent": feed[:6]}


@router.get(f"{P}/{{slug}}")
def portfolio(slug: str, candidate: str = Depends(get_current_candidate)):
    from .live_data import external_card
    from .student_portal import _Companies, _core, _job_card, branch_id, job_skills, match_score, profile_skills
    from ..db import ExternalApplicationLog

    c = _company_or_404(slug)
    internal, external = cd.company_roles(c["slug"])
    with Session(engine) as s:
        core = _core(s, candidate, ext_saved=True)
        apps = {a.job_id: a for a in s.exec(select(Application).where(Application.candidate_id == core.user.id)).all()}
        follow = s.exec(select(CompanyFollow).where(CompanyFollow.candidate_id == core.user.id, CompanyFollow.company_slug == c["slug"])).first()
        followers = s.exec(select(func.count()).select_from(CompanyFollow).where(CompanyFollow.company_slug == c["slug"])).one()
        applied = {}
        if external:
            for ext_id, created in s.exec(select(ExternalApplicationLog.external_job_id, ExternalApplicationLog.created_at)
                                          .where(ExternalApplicationLog.candidate_id == core.user.id,
                                                 ExternalApplicationLog.action == "applied")).all():
                applied[ext_id] = created
    pskills = profile_skills(core.profile)
    pbranch = branch_id(core.profile.branch)
    companies = _Companies()
    cards = []
    for job in internal:
        card = _job_card(job, companies, match=match_score(job, job_skills(job), pskills, pbranch),
                         saved=job.id in core.saved, application=apps.get(job.id))
        card["external"] = False
        cards.append(card)
    for e in external:
        cards.append(external_card(e, pskills=pskills, pbranch=pbranch, saved=e.id in core.ext_saved, applied_at=applied.get(e.id)))
    cards.sort(key=lambda x: x.get("posted_at") or "", reverse=True)
    jobs = [x for x in cards if x.get("job_type") != "internship"]
    internships = [x for x in cards if x.get("job_type") == "internship"]
    return {
        **{k: v for k, v in c.items() if k != "smartrecruiters_id"},
        "open_roles": len(cards), "jobs": jobs[:100], "internships": internships[:100],
        "following": follow is not None, "notify_email": bool(follow.notify_email) if follow else True,
        "followed_at": cd._iso(follow.created_at) if follow else None, "followers": int(followers or 0),
        "sources": sorted({x.get("source_label") for x in cards if x.get("external") and x.get("source_label")}),
    }


class FollowBody(BaseModel):
    notify_email: Optional[bool] = None


@router.post(f"{P}/{{slug}}/follow", status_code=201)
def follow(slug: str, body: Optional[FollowBody] = None, candidate: str = Depends(get_current_candidate)):
    from .student_portal import _user

    c = _company_or_404(slug)
    notify = True if body is None or body.notify_email is None else bool(body.notify_email)
    with Session(engine) as s:
        user = _user(s, candidate)
        row = s.exec(select(CompanyFollow).where(CompanyFollow.candidate_id == user.id, CompanyFollow.company_slug == c["slug"])).first()
        if row is None:
            n = s.exec(select(func.count()).select_from(CompanyFollow).where(CompanyFollow.candidate_id == user.id)).one()
            if n >= MAX_FOLLOWS:
                raise HTTPException(status_code=400, detail=f"You can follow up to {MAX_FOLLOWS} companies")
            row = CompanyFollow(candidate_id=user.id, company_slug=c["slug"], notify_email=notify)
            s.add(row)
        elif body is not None and body.notify_email is not None:
            row.notify_email = notify
            s.add(row)
        s.commit()
        s.refresh(row)
        return {"following": True, "slug": c["slug"], "notify_email": row.notify_email, "followed_at": cd._iso(row.created_at)}


@router.patch(f"{P}/{{slug}}/follow")
def update_follow(slug: str, body: FollowBody, candidate: str = Depends(get_current_candidate)):
    from .student_portal import _user

    c = _company_or_404(slug)
    if body.notify_email is None:
        raise HTTPException(status_code=422, detail="notify_email is required")
    with Session(engine) as s:
        user = _user(s, candidate)
        row = s.exec(select(CompanyFollow).where(CompanyFollow.candidate_id == user.id, CompanyFollow.company_slug == c["slug"])).first()
        if row is None:
            raise HTTPException(status_code=404, detail="You are not following this company")
        row.notify_email = bool(body.notify_email)
        s.add(row)
        s.commit()
        return {"following": True, "slug": c["slug"], "notify_email": row.notify_email}


@router.delete(f"{P}/{{slug}}/follow")
def unfollow(slug: str, candidate: str = Depends(get_current_candidate)):
    from .student_portal import _user

    slug = _slug_ok(slug)
    with Session(engine) as s:
        user = _user(s, candidate)
        for row in s.exec(select(CompanyFollow).where(CompanyFollow.candidate_id == user.id, CompanyFollow.company_slug == slug)).all():
            s.delete(row)
        s.commit()
    return {"following": False, "slug": slug}


# ── admin: demo companies ────────────────────────────────────────────────────

def _audit(admin: str, action: str, details: dict) -> None:
    try:
        from ..services.audit import record_audit_event
        with Session(engine) as s:
            record_audit_event(s, event_type="admin_action", human_reviewer=admin, human_action=action,
                               raw_verdicts=details, human_confirmed_at=utc_now())
    except Exception:  # pragma: no cover
        pass


@router.get("/api/admin/demo/companies")
def demo_status(admin: str = Depends(get_current_admin)):
    return demo_companies.status()


@router.post("/api/admin/demo/companies")
async def demo_create(admin: str = Depends(get_current_admin)):
    result = await run_in_threadpool(demo_companies.create_or_refresh)
    _audit(admin, "demo_companies_create", {"companies": result["companies"], "accounts_created": result["accounts_created"]})
    result["note"] = ("Passwords are shown only once, for newly created accounts. They are not stored in plain text; "
                      "existing demo accounts keep their current password.")
    return result


@router.delete("/api/admin/demo/companies")
async def demo_delete(admin: str = Depends(get_current_admin)):
    result = await run_in_threadpool(demo_companies.remove_all)
    _audit(admin, "demo_companies_delete", {k: v for k, v in result.items() if k != "deleted"})
    return result
