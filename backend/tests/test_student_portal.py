"""Student portal v2 API (/api/student/*) + practice interviews (/api/interview/practice/*)."""
import io
import json

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.auth import create_access_token
from app.db import (
    AnalysisCache, Application, CandidateProfile, CandidateUser, CompanyProfile, DecisionAuditLog, InterviewSession, Job,
    NewsletterSubscriber, Offer, RecruiterUser, Resume, SavedJob, ScheduledInterview, StudentProject, engine, utc_now,
)
from app.main import app
from app.resume_utils import vector_store
from app.services import llm_stream
from app.services.embeddings import EmbeddingModel

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64

RESUME = """Priya Sharma  priya@example.com  +91 98765 43210  linkedin.com/in/priya
Summary: Mechanical engineering student passionate about product design.
Education: B.E. Mechanical Engineering, 2023 - 2027, CGPA 8.6
Skills: SolidWorks, AutoCAD, ANSYS, MATLAB, GD&T, CATIA
Projects
- Designed a two-stage spur gearbox in SolidWorks and validated it with ANSYS FEA; reduced weight by 18%.
- Fabricated a CNC fixture that improved machining accuracy by 0.05 mm across 120 parts.
Experience: Internship at an automotive supplier, developed and tested jigs.
Certifications: CSWA (SolidWorks), NPTEL Machine Design
Achievements: Finalist, national design competition 2025
"""


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(llm_stream, "configured_providers", lambda: [])
    with TestClient(app) as c:
        yield c


def H(email="stu@example.com", role="candidate"):
    return {"Authorization": f"Bearer {create_access_token(username=email, role=role)}"}


def _student(email="stu@example.com", branch="mechanical", skills=("SolidWorks", "ANSYS"), with_resume=False, **extra):
    with Session(engine) as s:
        u = CandidateUser(username=email, password_hash="x")
        s.add(u)
        s.commit()
        s.refresh(u)
        p = CandidateProfile(candidate_id=u.id, branch=branch, skills_json=json.dumps(list(skills)), full_name="Priya Sharma",
                             contact_email=email, location_text="Bangalore, Karnataka", **extra)
        if with_resume:
            emb = EmbeddingModel.get().embed_text(RESUME)
            vector_store.add_document("resumes", f"doc-{email}", RESUME, {"filename": "cv.pdf"}, emb)
            r = Resume(filename="Priya_Resume.pdf", file_path="/tmp/x.pdf", vector_doc_id=f"doc-{email}", content_hash=f"h-{email}")
            s.add(r)
            s.commit()
            s.refresh(r)
            p.resume_id = r.id
        s.add(p)
        s.commit()
        return u.id


def _recruiter(username="rec@corp.com", company="Acme Engineering"):
    with Session(engine) as s:
        r = RecruiterUser(username=username, password_hash="x")
        s.add(r)
        s.commit()
        s.refresh(r)
        s.add(CompanyProfile(owner_recruiter_id=r.id, name=company))
        s.commit()
        return r.id


def _job(rid, title="Mechanical Design Intern", branch="mechanical", reqs="SolidWorks, ANSYS, GD&T, CAD", status="open", **kw):
    with Session(engine) as s:
        j = Job(recruiter_id=rid, title=title, description=f"{title} role. {reqs}", requirements=reqs, branch=branch,
                status=status, location_text=kw.pop("location_text", "Bangalore, India"), **kw)
        s.add(j)
        s.commit()
        s.refresh(j)
        return j.id


# ── auth ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("method,url", [
    ("get", "/api/student/resume/insights"), ("get", "/api/student/projects"), ("get", "/api/student/opportunities"),
    ("get", "/api/student/saved-jobs"), ("get", "/api/student/dashboard"), ("get", "/api/student/applications/overview"),
    ("get", "/api/student/export"), ("get", "/api/student/companies"), ("get", "/api/interview/practice/history"),
])
def test_requires_candidate_token(client, method, url):
    assert getattr(client, method)(url).status_code == 401
    assert getattr(client, method)(url, headers=H("rec@corp.com", "recruiter")).status_code == 403


# ── resume insights ──────────────────────────────────────────────────────────

def test_insights_without_resume_returns_suggested_skills(client):
    _student(skills=("SolidWorks",))
    r = client.get("/api/student/resume/insights", headers=H())
    assert r.status_code == 200
    body = r.json()
    assert body["has_resume"] is False and body["score"] is None
    assert len(body["bars"]) == 5
    assert body["suggested_skills"] and "SolidWorks" not in body["suggested_skills"]


def test_insights_with_resume_deterministic_and_cached(client):
    _student(with_resume=True)
    r1 = client.get("/api/student/resume/insights", headers=H()).json()
    assert r1["has_resume"] and 0 < r1["score"] <= 100
    assert {b["key"] for b in r1["bars"]} == {"content", "skills", "projects", "certifications", "format"}
    assert r1["suggestions"] and all(s["title"] for s in r1["suggestions"])
    assert r1["resume"]["filename"] == "Priya_Resume.pdf"
    assert r1["cached"] is False
    r2 = client.get("/api/student/resume/insights", headers=H()).json()
    assert r2["cached"] is True and r2["score"] == r1["score"]
    with Session(engine) as s:
        assert s.exec(select(AnalysisCache).where(AnalysisCache.cache_key.contains("student_insights"))).first()


def test_insights_llm_enrichment(client, monkeypatch):
    _student(with_resume=True)
    monkeypatch.setattr(llm_stream, "configured_providers", lambda: ["fake"])

    async def fake_json(*a, **k):
        return {"suggestions": [{"title": "Quantify your gearbox results", "detail": "Mention torque and efficiency."}]}

    monkeypatch.setattr(llm_stream, "complete_json", fake_json)
    body = client.get("/api/student/resume/insights?refresh=true", headers=H()).json()
    assert body["ai_enriched"] is True
    assert body["suggestions"][0]["title"] == "Quantify your gearbox results"


# ── projects ─────────────────────────────────────────────────────────────────

def test_project_crud_ownership_and_validation(client):
    _student()
    _student("other@example.com")
    r = client.post("/api/student/projects", headers=H(), json={"title": "Spur Gearbox", "description": "Two-stage gearbox", "category": "academic",
                                                               "tags": ["SolidWorks", "solidworks", "FEA"], "team_size": 3, "month": "Apr 2026"})
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["status"] == "draft" and p["tags"] == ["SolidWorks", "FEA"]
    pid = p["id"]
    assert client.post("/api/student/projects", headers=H(), json={"title": "X1", "category": "bogus"}).status_code == 422
    assert client.post("/api/student/projects", headers=H(), json={"title": "Linky", "links": [{"url": "javascript:alert(1)"}]}).status_code == 422
    # other student cannot see / edit / delete
    assert client.get(f"/api/student/projects/{pid}", headers=H("other@example.com")).status_code == 404
    assert client.put(f"/api/student/projects/{pid}", headers=H("other@example.com"), json={"title": "hack"}).status_code == 404
    assert client.delete(f"/api/student/projects/{pid}", headers=H("other@example.com")).status_code == 404
    lst = client.get("/api/student/projects", headers=H()).json()
    assert lst["stats"]["total"] == 1 and lst["stats"]["academic"] == 1 and lst["stats"]["team"] == 1
    assert client.get("/api/student/projects", headers=H("other@example.com")).json()["stats"]["total"] == 0
    r = client.put(f"/api/student/projects/{pid}", headers=H(), json={"featured": True, "category": "personal"})
    assert r.json()["featured"] is True and r.json()["category"] == "personal"
    assert client.delete(f"/api/student/projects/{pid}", headers=H()).json()["deleted"] is True
    assert client.get(f"/api/student/projects/{pid}", headers=H()).status_code == 404


def test_project_uploads_and_submit_flow(client):
    _student()
    pid = client.post("/api/student/projects", headers=H(), json={"title": "Robotic Arm"}).json()["id"]
    # submit requires description + evidence
    assert client.post(f"/api/student/projects/{pid}/submit", headers=H()).status_code == 400
    client.put(f"/api/student/projects/{pid}", headers=H(), json={"description": "Pick and place arm built with Arduino and servo motors."})
    assert client.post(f"/api/student/projects/{pid}/submit", headers=H()).status_code == 400
    # image
    r = client.post(f"/api/student/projects/{pid}/image", headers=H(), files={"file": ("arm.png", PNG, "image/png")})
    assert r.status_code == 200, r.text
    assert r.json()["image_url"].startswith("/media/projects/")
    # attachment: valid zip, bad magic, bad extension
    zip_bytes = b"PK\x03\x04" + b"\x00" * 40
    r = client.post(f"/api/student/projects/{pid}/attachment", headers=H(), files={"file": ("cad.zip", zip_bytes, "application/zip")})
    assert r.status_code == 200, r.text
    assert r.json()["file_name"] == "cad.zip"
    assert client.post(f"/api/student/projects/{pid}/attachment", headers=H(), files={"file": ("cad.zip", b"not a zip at all", "application/zip")}).status_code == 400
    assert client.post(f"/api/student/projects/{pid}/attachment", headers=H(), files={"file": ("run.exe", b"MZ\x00", "application/octet-stream")}).status_code == 400
    stl = b"solid part\nendsolid part\n"
    assert client.post(f"/api/student/projects/{pid}/attachment", headers=H(), files={"file": ("part.stl", stl, "model/stl")}).status_code == 200
    # submit → under_review, can't resubmit, status endpoint
    r = client.post(f"/api/student/projects/{pid}/submit", headers=H())
    assert r.status_code == 200 and r.json()["status"] == "under_review"
    assert client.post(f"/api/student/projects/{pid}/submit", headers=H()).status_code == 409
    assert client.get(f"/api/student/projects/{pid}/status", headers=H()).json()["status"] == "under_review"
    # admin verifies later; editing content resets it to draft
    with Session(engine) as s:
        p = s.get(StudentProject, pid)
        p.status = "verified"
        s.add(p)
        s.commit()
    r = client.put(f"/api/student/projects/{pid}", headers=H(), json={"title": "Robotic Arm v2"})
    assert r.json()["status"] == "draft"


# ── opportunities & saved jobs ───────────────────────────────────────────────

def test_opportunities_filters_match_and_company(client):
    _student(skills=("SolidWorks", "ANSYS", "GD&T"))
    rid = _recruiter()
    j1 = _job(rid, job_type="internship", remote_type="onsite")
    _job(rid, "Embedded Intern", "ece", "Embedded C, Arduino", job_type="internship", remote_type="remote", location_text="Pune, India")
    _job(rid, "Process Engineer", "chemical", "Aspen Plus, HAZOP", job_type="full-time", remote_type="hybrid", salary_max=900000, location_text="Hyderabad, India")
    _job(rid, "Closed Role", status="closed")
    r = client.get("/api/student/opportunities", headers=H()).json()
    assert r["total"] == 3 and r["counts"]["internship"] == 2 and r["counts"]["remote"] == 1
    top = r["items"][0]
    assert top["id"] == j1 and top["company"] == "Acme Engineering" and top["match"] >= 70
    assert client.get("/api/student/opportunities?type=remote", headers=H()).json()["total"] == 1
    assert client.get("/api/student/opportunities?remote=true", headers=H()).json()["total"] == 1
    assert client.get("/api/student/opportunities?q=aspen", headers=H()).json()["items"][0]["title"] == "Process Engineer"
    assert client.get("/api/student/opportunities?location=Pune", headers=H()).json()["total"] == 1
    assert client.get("/api/student/opportunities?branch=ECE", headers=H()).json()["total"] == 1
    assert client.get("/api/student/opportunities?salary_min=800000", headers=H()).json()["total"] == 1
    near = client.get("/api/student/opportunities?near=1", headers=H()).json()
    assert {i["title"] for i in near["items"]} == {"Mechanical Design Intern", "Embedded Intern"}  # Bangalore + remote
    assert client.get("/api/student/opportunities?sort=salary", headers=H()).json()["items"][0]["title"] == "Process Engineer"
    paged = client.get("/api/student/opportunities?page_size=2&page=2", headers=H()).json()
    assert len(paged["items"]) == 1 and paged["pages"] == 2
    assert client.get("/api/student/opportunities?sort=bogus", headers=H()).status_code == 422
    d = client.get(f"/api/student/opportunities/{j1}", headers=H()).json()
    assert "GD&T" in d["skills_have"] and d["description"]


def test_company_name_fallbacks_and_applied_ats(client):
    cid = _student()
    with Session(engine) as s:
        r = RecruiterUser(username="solo@corp.com", password_hash="x")
        s.add(r)
        s.commit()
        s.refresh(r)
        rid = r.id
    jid = _job(rid)
    with Session(engine) as s:
        s.add(Application(candidate_id=cid, job_id=jid, ats_score=64))
        s.commit()
    item = client.get("/api/student/opportunities", headers=H()).json()["items"][0]
    assert item["company"] == "Company" and item["applied"] is True and item["match"] == 64 and item["match_source"] == "ats"


def test_saved_jobs(client):
    _student()
    rid = _recruiter()
    jid = _job(rid)
    closed = _job(rid, "Old", status="closed")
    assert client.post("/api/student/saved-jobs", headers=H(), json={"job_id": jid}).status_code == 201
    assert client.post("/api/student/saved-jobs", headers=H(), json={"job_id": jid}).status_code == 201  # idempotent
    assert client.post("/api/student/saved-jobs", headers=H(), json={"job_id": closed}).status_code == 404
    lst = client.get("/api/student/saved-jobs", headers=H()).json()
    assert lst["total"] == 1 and lst["items"][0]["company"] == "Acme Engineering"
    assert client.get("/api/student/opportunities?saved_only=true", headers=H()).json()["total"] == 1
    assert client.delete(f"/api/student/saved-jobs/{jid}", headers=H()).json()["saved"] is False
    assert client.get("/api/student/saved-jobs", headers=H()).json()["total"] == 0


def test_companies_and_dashboard(client):
    _student(with_resume=True)
    rid = _recruiter()
    _job(rid)
    _job(rid, "CAE Trainee", reqs="ANSYS, FEA")
    comp = client.get("/api/student/companies", headers=H()).json()["companies"]
    assert comp[0]["name"] == "Acme Engineering" and len(comp[0]["jobs"]) == 2
    d = client.get("/api/student/dashboard", headers=H()).json()
    assert len(d["recommended"]) == 2 and d["progress"]["resume_uploaded"] is True
    assert "percent" in d["completion"]


# ── applications overview & offers ───────────────────────────────────────────

def _apps_fixture():
    cid = _student()
    rid = _recruiter()
    ids = {}
    with Session(engine) as s:
        for key, status, extra in [
            ("review", "ats_check", {}), ("short", "shortlisted", {"candidate_status": "interview", "interview_status": "unlocked", "project_score": 70}),
            ("sched", "shortlisted", {"project_score": 60}), ("rej", "rejected", {}), ("offer", "shortlisted", {"project_score": 80}),
        ]:
            j = Job(recruiter_id=rid, title=f"Role {key}", description="d", requirements="SolidWorks", branch="mechanical")
            s.add(j)
            s.commit()
            s.refresh(j)
            a = Application(candidate_id=cid, job_id=j.id, status=status, ats_score=70, **extra)
            s.add(a)
            s.commit()
            s.refresh(a)
            ids[key] = a
        s.add(ScheduledInterview(application_id=ids["sched"].id, job_id=ids["sched"].job_id, candidate_id=cid, recruiter_id=rid,
                                 round_name="Technical Interview", starts_at=utc_now().replace(microsecond=0) + __import__("datetime").timedelta(days=3)))
        o = Offer(application_id=ids["offer"].id, job_id=ids["offer"].job_id, candidate_id=cid, recruiter_id=rid, ctc="₹6.5 LPA", joining_date="2026-11-15")
        s.add(o)
        s.commit()
        s.refresh(o)
        return cid, {k: v.id for k, v in ids.items()}, o.id


def test_applications_overview_statuses_and_next_steps(client):
    _cid, ids, _oid = _apps_fixture()
    body = client.get("/api/student/applications/overview", headers=H()).json()
    by = {a["id"]: a for a in body["applications"]}
    assert by[ids["review"]]["status"] == "under_review" and by[ids["review"]]["next_step"]["kind"] == "project"
    assert by[ids["short"]]["status"] == "shortlisted" and by[ids["short"]]["next_step"]["kind"] == "ai_interview"
    assert by[ids["sched"]]["status"] == "interview_scheduled" and by[ids["sched"]]["next_step"]["label"] == "Technical Interview"
    assert by[ids["rej"]]["status"] == "rejected"
    assert by[ids["offer"]]["status"] == "offer_received" and by[ids["offer"]]["offer"]["ctc"] == "₹6.5 LPA"
    k = body["kpis"]
    assert k == {"total": 5, "shortlisted": 1, "interview_scheduled": 1, "under_review": 1, "rejected": 1, "offer_received": 1}
    assert body["upcoming_interviews"][0]["company"] == "Acme Engineering"
    # another student sees none of it
    _student("other@example.com")
    assert client.get("/api/student/applications/overview", headers=H("other@example.com")).json()["kpis"]["total"] == 0


def test_offer_respond(client, monkeypatch):
    sent = []
    import app.services.email_delivery as ed

    monkeypatch.setattr(ed, "queue_email", lambda to, subject, text, html=None, category=None: sent.append((to, subject)))
    _cid, ids, oid = _apps_fixture()
    _student("other@example.com")
    assert client.post(f"/api/student/offers/{oid}/respond", headers=H("other@example.com"), json={"decision": "accept"}).status_code == 404
    assert client.post(f"/api/student/offers/{oid}/respond", headers=H(), json={"decision": "maybe"}).status_code == 422
    r = client.post(f"/api/student/offers/{oid}/respond", headers=H(), json={"decision": "accept"})
    assert r.status_code == 200 and r.json()["status"] == "accepted"
    assert sent and sent[0][0] == "rec@corp.com" and "accepted" in sent[0][1].lower()
    with Session(engine) as s:
        assert s.get(Offer, oid).responded_at is not None
        assert s.get(Application, ids["offer"]).candidate_status == "final_result"
    assert client.post(f"/api/student/offers/{oid}/respond", headers=H(), json={"decision": "decline"}).status_code == 409


# ── newsletter / export / delete ─────────────────────────────────────────────

def test_newsletter(client):
    _student()
    assert client.post("/api/student/newsletter", headers=H(), json={"email": "nope"}).status_code == 422
    assert client.post("/api/student/newsletter", headers=H(), json={"email": "Me@Example.com"}).json() == {"subscribed": True, "already": False}
    assert client.post("/api/student/newsletter", headers=H(), json={"email": "me@example.com"}).json()["already"] is True
    with Session(engine) as s:
        assert len(s.exec(select(NewsletterSubscriber)).all()) == 1


def test_export_contains_own_data_only(client):
    cid, ids, _ = _apps_fixture()
    client.post("/api/student/projects", headers=H(), json={"title": "My Project"})
    r = client.get("/api/student/export", headers=H())
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = r.json()
    assert data["account"]["username"] == "stu@example.com"
    assert len(data["applications"]) == 5 and data["projects"][0]["title"] == "My Project"
    assert data["offers"][0]["ctc"] == "₹6.5 LPA"


def test_delete_account(client):
    cid, ids, oid = _apps_fixture()
    client.post("/api/student/projects", headers=H(), json={"title": "My Project"})
    with Session(engine) as s:
        s.add(SavedJob(candidate_id=cid, job_id=s.get(Application, ids["review"]).job_id))
        s.add(DecisionAuditLog(event_type="ats_score", application_id=ids["review"], candidate_id=cid))
        s.commit()
    _student("other@example.com")
    assert client.request("DELETE", "/api/student/account", headers=H(), json={"confirm": "delete"}).status_code == 400
    r = client.request("DELETE", "/api/student/account", headers=H(), json={"confirm": "DELETE"})
    assert r.status_code == 200 and r.json()["deleted"] is True
    with Session(engine) as s:
        assert s.get(CandidateUser, cid) is None
        assert not s.exec(select(Application).where(Application.candidate_id == cid)).all()
        assert not s.exec(select(StudentProject).where(StudentProject.candidate_id == cid)).all()
        assert not s.exec(select(SavedJob).where(SavedJob.candidate_id == cid)).all()
        assert not s.exec(select(Offer).where(Offer.candidate_id == cid)).all()
        assert not s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == cid)).all()
        assert s.exec(select(DecisionAuditLog).where(DecisionAuditLog.event_type == "candidate_account_deletion")).first()
        assert s.exec(select(CandidateUser).where(CandidateUser.username == "other@example.com")).first()
    assert client.get("/api/student/projects", headers=H()).status_code == 404


# ── practice interviews ──────────────────────────────────────────────────────

def _turn(client, sid, answer, email="stu@example.com"):
    r = client.post(f"/api/interview/sessions/{sid}/turn", json={"answer": answer}, headers=H(email))
    assert r.status_code == 200, r.text
    ev = [json.loads(x) for x in r.text.splitlines() if x.strip()]
    return ev[0], "".join(e["v"] for e in ev if e["t"] == "d"), next(e for e in ev if e["t"] == "end")


def test_practice_session_full_flow(client):
    cid = _student(branch="ece")
    with Session(engine) as s:
        rid = RecruiterUser(username="r@x.com", password_hash="x")
        s.add(rid)
        s.commit()
        s.refresh(rid)
        j = Job(recruiter_id=rid.id, title="T", description="d")
        s.add(j)
        s.commit()
        s.refresh(j)
        a = Application(candidate_id=cid, job_id=j.id, status="ats_check")
        s.add(a)
        s.commit()
        s.refresh(a)
        app_id = a.id
    assert client.post("/api/interview/practice/session", headers=H(), json={"kind": "bogus"}).status_code == 422
    seeds = ["Explain the difference between a latch and a flip-flop in digital design.", "How does an ADC sample a signal?"]
    r = client.post("/api/interview/practice/session", headers=H(), json={"kind": "technical", "topic": "Digital Electronics", "questions": seeds})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["practice"] is True and body["greeting"].startswith("Hi Priya, I'm Aria")
    assert "private" in body["greeting"]
    sid = body["session_id"]
    # other candidate cannot drive it
    _student("other@example.com")
    assert client.post(f"/api/interview/sessions/{sid}/turn", json={"answer": "hi"}, headers=H("other@example.com")).status_code == 404
    good = ("In my lab project the problem was signal noise, so I designed a low-pass filter and implemented debouncing in firmware; "
            "we reduced false triggers by 90 percent, though the trade-off was 5 ms extra latency, and I learned to validate with a scope.")
    for _ in range(12):
        meta, text, end = _turn(client, sid, good)
        if end["done"]:
            break
    assert end["done"] is True
    assert "hiring team" not in text.lower()
    fin = client.post(f"/api/interview/sessions/{sid}/finish", headers=H(), json={"ended_reason": "completed"})
    assert fin.status_code == 200, fin.text
    ev = fin.json()["evaluation"]
    assert fin.json()["practice"] is True and 0 < ev["overall_score"] <= 100
    assert set(ev["dimension_scores"]) >= {"technical_depth", "communication"}
    with Session(engine) as s:
        a = s.get(Application, app_id)
        assert a.interview_status == "locked" and a.interview_eval_score is None
        sess = s.get(InterviewSession, sid)
        assert sess.mode == "practice" and sess.application_id is None and sess.status == "completed"
    hist = client.get("/api/interview/practice/history", headers=H()).json()["sessions"]
    assert hist[0]["id"] == sid and hist[0]["topic"] == "Digital Electronics" and hist[0]["overall_score"] == ev["overall_score"]
    assert client.get("/api/interview/practice/history", headers=H("other@example.com")).json()["sessions"] == []
    det = client.get(f"/api/interview/practice/sessions/{sid}", headers=H()).json()
    assert det["qa"] and det["evaluation"]["overall_score"] == ev["overall_score"]
    assert client.get(f"/api/interview/practice/sessions/{sid}", headers=H("other@example.com")).status_code == 404
    # finishing twice returns the stored result
    again = client.post(f"/api/interview/sessions/{sid}/finish", headers=H(), json={}).json()
    assert again["already"] is True and again["evaluation"]["overall_score"] == ev["overall_score"]


def test_practice_new_session_abandons_previous(client):
    _student()
    s1 = client.post("/api/interview/practice/session", headers=H(), json={"kind": "hr"}).json()["session_id"]
    s2 = client.post("/api/interview/practice/session", headers=H(), json={"kind": "mock", "topic": "Mock", "company": "Acme"}).json()
    assert "Acme" in s2["greeting"]
    with Session(engine) as s:
        assert s.get(InterviewSession, s1).status == "abandoned"


def test_resume_file_own_only(client, tmp_path):
    from app.resume_utils import RESUME_DIR
    import os
    os.makedirs(RESUME_DIR, exist_ok=True)
    _student(with_resume=True)
    assert client.get("/api/student/resume/file", headers=H()).status_code == 404  # path outside resume dir
    path = os.path.join(RESUME_DIR, "x_cv.pdf")
    open(path, "wb").write(b"%PDF-1.4 test")
    with Session(engine) as s:
        r = s.exec(select(Resume)).first()
        r.file_path = path
        s.add(r)
        s.commit()
    res = client.get("/api/student/resume/file", headers=H())
    assert res.status_code == 200 and res.content.startswith(b"%PDF")
    _student("other@example.com")
    assert client.get("/api/student/resume/file", headers=H("other@example.com")).status_code == 404
