"""Performance budget + logic-fix regression tests (perf / correctness pass).

* Query budgets: hot endpoints must stay within N SQL statements (counted with
  a SQLAlchemy event listener, app/perf.py). Every statement is a ~0.3-0.9 s
  round trip in production (Render Oregon -> Supabase Mumbai).
* Logic fixes: UTC timestamps carry 'Z', suspended students hidden from
  recruiter search, duplicate-apply guard, LLM score normalisation, ATS uses
  the job's requirements, accepted offers can't be silently edited, rejected
  applications show no upcoming interviews, notifications ordering, cache
  invalidation on writes, indexes are idempotent.
"""
import json
import threading
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app import perf
from app.auth import create_access_token, hash_password
from app.db import (
    Application, CandidateProfile, CandidateUser, CompanyProfile, DecisionAuditLog, InterviewSession, Job, Offer,
    RecruiterUser, ScheduledInterview, StudentProject, User, engine, utc_now,
)
from app.main import app

client = TestClient(app)


def H(sub, role):
    return {"Authorization": f"Bearer {create_access_token(sub, role)}"}


@pytest.fixture
def world():
    with Session(engine) as s:
        s.add(User(name="Admin", email="adm@corelink.test", role="admin", password_hash=hash_password("AdminPass123!"), email_verified=True))
        s.add(User(name="Rec", email="rec@acme.test", role="recruiter", password_hash=hash_password("Recruit@2026"), email_verified=True))
        rec = RecruiterUser(username="rec@acme.test", password_hash=hash_password("Recruit@2026"))
        s.add(rec)
        s.commit()
        s.refresh(rec)
        s.add(CompanyProfile(owner_recruiter_id=rec.id, name="Acme Engineering"))
        cands = []
        for i in range(6):
            u = CandidateUser(username=f"s{i}@student.test", password_hash=hash_password("Student@2026"))
            s.add(u)
            s.commit()
            s.refresh(u)
            s.add(CandidateProfile(candidate_id=u.id, full_name=f"Student {i}", branch="mechanical", college="NIT",
                                   skills_json=json.dumps(["SolidWorks", "ANSYS"]), contact_email=u.username,
                                   privacy_json=json.dumps({"visibility": "public"})))
            s.add(StudentProject(candidate_id=u.id, title=f"P{i}", status="verified"))
            cands.append(u)
        jobs = []
        for i in range(5):
            j = Job(recruiter_id=rec.id, title=f"Design Engineer {i}", description="CAD design of gearboxes",
                    requirements="SolidWorks, ANSYS, GD&T", branch="mechanical", status="open", location_text="Pune")
            s.add(j)
            jobs.append(j)
        s.commit()
        for j in jobs:
            s.refresh(j)
        apps = []
        for i, u in enumerate(cands):
            for j in jobs[:3]:
                a = Application(candidate_id=u.id, job_id=j.id, ats_score=60 + i, status="shortlisted" if i % 2 else "ats_check",
                                applied_at=utc_now() - timedelta(days=i), interview_status="completed" if i == 1 else "locked",
                                interview_transcript_json=json.dumps([{"role": "ai", "text": "Q"}]) if i == 1 else None)
                s.add(a)
                apps.append(a)
        s.commit()
        for a in apps:
            s.refresh(a)
        for a in apps[:4]:
            s.add(ScheduledInterview(application_id=a.id, job_id=a.job_id, candidate_id=a.candidate_id, recruiter_id=rec.id,
                                     starts_at=utc_now() + timedelta(days=2), round_name="Technical Round 1"))
            s.add(Offer(application_id=a.id, job_id=a.job_id, candidate_id=a.candidate_id, recruiter_id=rec.id, ctc="6 LPA", status="sent"))
            s.add(DecisionAuditLog(application_id=a.id, candidate_id=a.candidate_id, job_id=a.job_id, event_type="recruiter_decision"))
        s.add(InterviewSession(application_id=apps[3].id, candidate_id=apps[3].candidate_id, job_id=apps[3].job_id, status="completed",
                               completed_at=utc_now()))
        s.commit()
        ids = {"rid": rec.id, "cids": [u.id for u in cands], "jobs": [j.id for j in jobs], "apps": [a.id for a in apps]}
    ids["S"] = H("s0@student.test", "candidate")
    ids["R"] = H("rec@acme.test", "recruiter")
    ids["A"] = H("adm@corelink.test", "admin")
    return ids


def _count(method, url, **kw):
    with perf.count_queries() as b:
        r = client.request(method, url, **kw)
    assert r.status_code < 400, (url, r.status_code, r.text[:300])
    return b["count"], b["statements"]


# Budgets for the warm path (caches filled by a first call). Before this pass:
# profile 5, notifications 5-6 (+1 per event), dashboard 11, opportunities 11,
# recruiter overview 12, applications 11, candidates 10, admin overview 22,
# admin users 11 - plus 1 auth query on every request.
HOT = [
    ("S", "/api/candidate/profile", 1),
    ("S", "/api/notifications", 1),
    ("S", "/api/student/dashboard", 2),
    ("S", "/api/student/opportunities?sort=relevance&page=1&page_size=10", 3),
    ("S", "/api/student/applications/overview", 3),
    ("R", "/api/notifications", 2),
    ("R", "/api/recruiter/profile", 1),
    ("R", "/api/recruiter/hiring/company", 0),
    ("R", "/api/recruiter/portal/overview?days=30", 2),
    ("R", "/api/recruiter/portal/applications?sort=newest&page=1&page_size=10", 1),
    ("R", "/api/recruiter/portal/candidates?view=mine&sort=match&page=1&page_size=10", 1),
    ("R", "/api/recruiter/portal/jobs", 1),
    ("R", "/api/recruiter/portal/shortlisted?sort=match&page=1&page_size=10", 1),
    ("R", "/api/recruiter/hiring/interviews?limit=500", 2),
    ("R", "/api/recruiter/hiring/offers?limit=1000", 1),
    ("A", "/api/notifications", 1),
    ("A", "/api/admin/portal/overview", 3),
    ("A", "/api/admin/portal/users", 0),
    ("A", "/api/admin/portal/applications", 1),
]


@pytest.mark.parametrize("who,url,budget", HOT)
def test_hot_endpoint_query_budget(world, who, url, budget):
    client.get(url, headers=world[who])           # cold: fills principal / job / company caches
    n, stmts = _count("GET", url, headers=world[who])
    assert n <= budget, f"{url}: {n} queries > budget {budget}\n" + "\n".join(stmts)


def test_login_is_one_query_plus_background_stamp(world):
    n, stmts = _count("POST", "/api/candidate/auth/login", data={"username": "s0@student.test", "password": "Student@2026"})
    assert n <= 3, stmts  # SELECT; then (after the response) UPDATE last_login_at [+ rehash]
    n, stmts = _count("POST", "/api/auth/login", data={"email": "rec@acme.test", "password": "Recruit@2026"})
    assert n <= 3, stmts
    with Session(engine) as s:
        u = s.exec(select(CandidateUser).where(CandidateUser.username == "s0@student.test")).one()
        assert u.last_login_at is not None
        assert u.password_hash.startswith("$2b$10$")  # cost upgraded/downgraded to BCRYPT_ROUNDS
    assert client.post("/api/candidate/auth/login", data={"username": "s0@student.test", "password": "Student@2026"}).status_code == 200


def test_auth_cache_still_locks_out_suspended_accounts_immediately(world):
    assert client.get("/api/candidate/profile", headers=world["S"]).status_code == 200  # cached as active
    with Session(engine) as s:
        u = s.exec(select(CandidateUser).where(CandidateUser.username == "s0@student.test")).one()
        u.status = "suspended"
        s.add(u)
        s.commit()
    assert client.get("/api/candidate/profile", headers=world["S"]).status_code == 403
    assert client.get("/api/notifications", headers=world["S"]).status_code == 403


def test_caches_invalidate_on_writes(world):
    r = client.get("/api/recruiter/hiring/company", headers=world["R"]).json()
    assert r["name"] == "Acme Engineering"
    assert client.put("/api/recruiter/hiring/company", json={"name": "Acme Robotics"}, headers=world["R"]).status_code == 200
    assert client.get("/api/recruiter/hiring/company", headers=world["R"]).json()["name"] == "Acme Robotics"
    n_before = client.get("/api/recruiter/portal/jobs", headers=world["R"]).json()["counts"]["open"]
    with Session(engine) as s:
        s.add(Job(recruiter_id=world["rid"], title="New", description="x", status="open"))
        s.commit()
    assert client.get("/api/recruiter/portal/jobs", headers=world["R"]).json()["counts"]["open"] == n_before + 1


# ── logic fixes ──────────────────────────────────────────────────────────────

def test_interview_times_are_utc_with_z(world):
    ov = client.get("/api/student/applications/overview", headers=world["S"]).json()
    ups = ov["upcoming_interviews"]
    assert ups and all(u["starts_at"].endswith("Z") for u in ups)
    assert all(r["applied_at"].endswith("Z") for r in ov["applications"])
    sl = client.get("/api/recruiter/portal/applications?page_size=50", headers=world["R"]).json()
    assert all(i["applied_at"].endswith("Z") for i in sl["items"])
    feed = client.get("/api/notifications", headers=world["S"]).json()["items"]
    iv = [n for n in feed if n["kind"] == "interview"]
    assert iv and "IST" in iv[0]["title"] and iv[0]["starts_at"].endswith("Z")


def test_rejected_application_has_no_upcoming_interview(world):
    with Session(engine) as s:
        a = s.get(Application, world["apps"][0])
        a.status = "rejected"
        s.add(a)
        s.commit()
        aid = a.id
    ov = client.get("/api/student/applications/overview", headers=world["S"]).json()
    assert all(u["application_id"] != aid for u in ov["upcoming_interviews"])
    row = next(r for r in ov["applications"] if r["id"] == aid)
    assert row["interviews"] == []


def test_notifications_newest_first_and_ai_completion_has_time(world):
    items = client.get("/api/notifications", headers=world["R"]).json()["items"]
    dated = [i["at"] for i in items if i["at"]]
    assert dated == sorted(dated, reverse=True)
    ai = [i for i in items if i["kind"] == "interview"]
    assert any(i["at"] for i in ai)  # was always None → sorted last


def test_recruiter_search_hides_suspended_non_applicants(world):
    with Session(engine) as s:
        u = CandidateUser(username="sus@student.test", password_hash="x", status="suspended")
        s.add(u)
        s.commit()
        s.refresh(u)
        s.add(CandidateProfile(candidate_id=u.id, full_name="Suspended Sam", privacy_json=json.dumps({"visibility": "public"})))
        s.commit()
    r = client.get("/api/recruiter/portal/candidates?view=search&page_size=100", headers=world["R"]).json()
    assert "Suspended Sam" not in [i["name"] for i in r["items"]]
    assert "Student 0" in [i["name"] for i in r["items"]]


def test_accepted_offer_terms_need_negotiation(world):
    with Session(engine) as s:
        o = s.exec(select(Offer)).first()
        o.status = "accepted"
        s.add(o)
        s.commit()
        oid = o.id
    url = f"/api/recruiter/hiring/offers/{oid}"
    assert client.patch(url, json={"ctc": "3 LPA"}, headers=world["R"]).status_code == 409
    r = client.patch(url, json={"ctc": "7 LPA", "status": "negotiation"}, headers=world["R"])
    assert r.status_code == 200 and r.json()["status"] == "negotiation"
    assert client.patch(url, json={"notes": "call on Monday"}, headers=world["R"]).status_code == 200


def test_llm_score_normalisation_and_combination():
    from app.api.candidate_jobs import combine_ats, normalize_llm_score

    assert normalize_llm_score(85) == 85
    assert normalize_llm_score("85") == 85
    assert normalize_llm_score("85%") == 85
    assert normalize_llm_score(0.85) == 85      # fraction, used to drag the score to ~42
    assert normalize_llm_score(150) == 100
    assert normalize_llm_score(-3) == 0
    assert normalize_llm_score("n/a") is None and normalize_llm_score(None) is None
    assert combine_ats(70, None) == 70
    assert combine_ats(70, 100) == 79


def _with_resume(cid, text):
    from app.db import Resume
    from app.resume_utils import vector_store
    from app.services.embeddings import EmbeddingModel

    vector_store.add_document("resumes", f"r-{cid}", text, {"candidate": cid}, EmbeddingModel.get().embed_text(text))
    with Session(engine) as s:
        r = Resume(filename="cv.txt", file_path="/tmp/none", vector_doc_id=f"r-{cid}", content_hash=f"h{cid}")
        s.add(r)
        s.commit()
        s.refresh(r)
        p = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == cid)).one()
        p.resume_id = r.id
        s.add(p)
        s.commit()


def test_apply_scores_against_requirements_and_blocks_duplicates(world):
    jid = world["jobs"][4]   # no applications yet
    cid = world["cids"][0]
    _with_resume(cid, "Mechanical engineer. Skills: SolidWorks, ANSYS, GD&T. Designed gearbox housings.")
    r = client.post(f"/api/candidate/jobs/{jid}/apply", headers=world["S"])
    assert r.status_code == 200, r.text
    body = r.json()
    # GD&T appears only in the job's requirements field, which is now part of the JD
    assert any("GD" in m for m in body["matched_skills"]) or "SolidWorks" in body["matched_skills"]
    assert client.post(f"/api/candidate/jobs/{jid}/apply", headers=world["S"]).status_code == 409
    with Session(engine) as s:
        assert len(s.exec(select(Application).where(Application.candidate_id == cid, Application.job_id == jid)).all()) == 1


def test_concurrent_double_click_apply_creates_one_application(world):
    jid = world["jobs"][3]
    cid = world["cids"][0]
    _with_resume(cid, "SolidWorks ANSYS engineer")
    codes = []

    def go():
        codes.append(TestClient(app).post(f"/api/candidate/jobs/{jid}/apply", headers=world["S"]).status_code)

    ts = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert codes.count(200) == 1 and all(c == 409 for c in codes if c != 200), codes
    with Session(engine) as s:
        assert len(s.exec(select(Application).where(Application.candidate_id == cid, Application.job_id == jid)).all()) == 1


def test_db_indexes_idempotent():
    from app.db_indexes import ensure_indexes, wanted_indexes

    ensure_indexes(engine)
    assert ensure_indexes(engine) == 0           # second run creates nothing
    with engine.connect() as c:
        from sqlalchemy import text
        names = {r[0] for r in c.execute(text("SELECT name FROM sqlite_master WHERE type='index'"))}
    assert {"ix_job_status_created", "ix_application_candidate_job", "ix_auditlog_candidate_created"} <= names
    assert len(wanted_indexes()) >= 20


def test_gzip_for_large_json(world):
    r = client.get("/api/recruiter/portal/applications?page_size=50", headers={**world["R"], "Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip"
