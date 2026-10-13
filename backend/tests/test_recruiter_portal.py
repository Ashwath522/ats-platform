"""Tests for the v2 recruiter portal API (pages 13–17) — app/api/recruiter_portal.py
plus the additive v2 fields on app/api/recruiter_jobs.py."""
import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.auth import create_access_token, hash_password
from app.db import (
    Application, CandidateProfile, CandidateUser, DecisionAuditLog, Job, RecruiterNote,
    RecruiterUser, ScheduledInterview, StudentProject, User, engine, utc_now,
)
from app.main import app

BASE = "/api/recruiter/portal"


def _recruiter(session, email):
    session.add(User(name=email, email=email, role="recruiter", password_hash=hash_password("x" * 10), email_verified=True))
    r = RecruiterUser(username=email, password_hash="x")
    session.add(r)
    session.commit()
    session.refresh(r)
    return r


def _candidate(session, email, name, branch="mechanical", privacy=None, **kw):
    u = CandidateUser(username=email, password_hash="x")
    session.add(u)
    session.commit()
    session.refresh(u)
    session.add(CandidateProfile(candidate_id=u.id, full_name=name, branch=branch, college=kw.pop("college", "NIT Trichy"),
                                 skills_json=json.dumps(kw.pop("skills", ["SolidWorks", "ANSYS"])),
                                 privacy_json=json.dumps(privacy) if privacy is not None else None,
                                 contact_phone=kw.pop("phone", "+91 90000 00000"), cgpa=kw.pop("cgpa", 8.0), **kw))
    session.commit()
    return u


@pytest.fixture
def world():
    with Session(engine) as s:
        ra = _recruiter(s, "alice@acme.test")
        rb = _recruiter(s, "bob@other.test")
        c1 = _candidate(s, "c1@student.test", "Asha Private", privacy={"visibility": "private", "show_contact": False})
        c2 = _candidate(s, "c2@student.test", "Bala Public", branch="civil", privacy={"visibility": "public", "show_contact": False}, skills=["AutoCAD"])
        c3 = _candidate(s, "c3@student.test", "Chitra Hidden", privacy={"visibility": "private"})
        c4 = _candidate(s, "c4@student.test", "Dev Open", privacy={"visibility": "public", "show_contact": True})
        j1 = Job(recruiter_id=ra.id, title="Design Intern", description="CAD work", branch="mechanical", requirements="SolidWorks, ANSYS, GD&T",
                 status="open", job_type="internship", location_text="Pune, India")
        j2 = Job(recruiter_id=ra.id, title="Draft Role", description="tbd", branch="civil", status="draft", job_type="full-time")
        jb = Job(recruiter_id=rb.id, title="Bob Job", description="x", branch="civil", status="open")
        s.add_all([j1, j2, jb])
        s.commit()
        for j in (j1, j2, jb):
            s.refresh(j)
        a1 = Application(candidate_id=c1.id, job_id=j1.id, ats_score=80, status="ats_check")
        a2 = Application(candidate_id=c2.id, job_id=jb.id, ats_score=60, status="ats_check")
        a4 = Application(candidate_id=c4.id, job_id=j1.id, ats_score=70, status="shortlisted", applied_at=utc_now() - timedelta(days=2))
        s.add_all([a1, a2, a4])
        s.add(StudentProject(candidate_id=c1.id, title="Gearbox", status="verified"))
        s.commit()
        for x in (a1, a2, a4):
            s.refresh(x)
        ids = dict(ra=ra.id, rb=rb.id, c1=c1.id, c2=c2.id, c3=c3.id, c4=c4.id, j1=j1.id, j2=j2.id, jb=jb.id, a1=a1.id, a2=a2.id, a4=a4.id)
    client = TestClient(app)
    ids["A"] = {"Authorization": f"Bearer {create_access_token('alice@acme.test', 'recruiter')}"}
    ids["B"] = {"Authorization": f"Bearer {create_access_token('bob@other.test', 'recruiter')}"}
    ids["client"] = client
    return ids


# ── auth ─────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("path", ["/overview", "/jobs", "/candidates", "/applications", "/shortlisted", "/jobs/colleges"])
def test_requires_recruiter(world, path):
    c = world["client"]
    assert c.get(BASE + path).status_code == 401
    cand = {"Authorization": f"Bearer {create_access_token('c1@student.test', 'candidate')}"}
    assert c.get(BASE + path, headers=cand).status_code in (401, 403)


# ── overview ─────────────────────────────────────────────────────────────────
def test_overview_scoped_to_own_jobs(world):
    c = world["client"]
    r = c.get(BASE + "/overview?days=30", headers=world["A"])
    assert r.status_code == 200
    d = r.json()
    assert d["kpis"]["applications"]["value"] == 2  # a2 belongs to Bob
    assert d["kpis"]["total_candidates"]["value"] == 2
    assert d["kpis"]["shortlisted"]["value"] == 1
    assert len(d["trend"]) == 30 and d["trend_total"] == 2
    names = {x["candidate_name"] for x in d["top_candidates"]}
    assert names == {"Asha Private", "Dev Open"}
    assert d["top_skills"]["open_jobs"] == 1 and d["top_skills"]["skills"][0]["pct"] == 100
    assert any(b["branch"] == "mechanical" for b in d["branches"])
    assert [x["application_id"] for x in d["schedulable"]] == [world["a4"]]
    b = c.get(BASE + "/overview", headers=world["B"]).json()
    assert b["kpis"]["applications"]["value"] == 1
    assert c.get(BASE + "/overview?days=12", headers=world["A"]).status_code == 400


# ── jobs ─────────────────────────────────────────────────────────────────────
def test_jobs_list_counts_and_codes(world):
    d = world["client"].get(BASE + "/jobs", headers=world["A"]).json()
    assert {j["title"] for j in d["jobs"]} == {"Design Intern", "Draft Role"}
    j1 = next(j for j in d["jobs"] if j["id"] == world["j1"])
    assert j1["applications"] == 2 and j1["shortlisted"] == 1
    assert j1["code"].endswith(f"-INT-{world['j1']:03d}")
    assert d["counts"]["draft"] == 1 and d["counts"]["all"] == 2
    assert d["kpis"]["active_jobs"]["value"] == 1


def test_duplicate_bulk_status_and_ownership(world):
    c, A, B = world["client"], world["A"], world["B"]
    r = c.post(BASE + f"/jobs/{world['j1']}/duplicate", headers=A)
    assert r.status_code == 200 and r.json()["status"] == "draft"
    assert c.post(BASE + f"/jobs/{world['jb']}/duplicate", headers=A).status_code == 404
    r = c.post(BASE + "/jobs/bulk-status", json={"ids": [world["j1"], world["j2"]], "status": "archived"}, headers=A)
    assert r.status_code == 200 and r.json()["updated"] == 2
    assert c.post(BASE + "/jobs/bulk-status", json={"ids": [world["jb"]], "status": "closed"}, headers=A).status_code == 404
    assert c.post(BASE + "/jobs/bulk-status", json={"ids": [world["j1"]], "status": "bogus"}, headers=A).status_code == 400
    assert c.post(BASE + "/jobs/bulk-status", json={"ids": [], "status": "closed"}, headers=A).status_code == 422
    with Session(engine) as s:
        assert s.get(Job, world["jb"]).status == "open"
        assert s.get(Job, world["j1"]).status == "archived"


def test_delete_requires_no_applications(world):
    c, A = world["client"], world["A"]
    assert c.delete(BASE + f"/jobs/{world['j1']}", headers=A).status_code == 409
    assert c.delete(BASE + f"/jobs/{world['jb']}", headers=A).status_code == 404
    assert c.delete(BASE + f"/jobs/{world['j2']}", headers=A).json()["deleted"] is True


def test_target_colleges_and_recommended(world):
    c, A = world["client"], world["A"]
    r = c.post(BASE + f"/jobs/{world['j1']}/target-colleges", json={"college": "NIT Trichy"}, headers=A)
    assert r.json()["target_colleges"] == ["NIT Trichy"]
    r = c.post(BASE + f"/jobs/{world['j1']}/target-colleges", json={"college": "nit trichy"}, headers=A)
    assert r.json()["target_colleges"] == ["NIT Trichy"]  # deduped
    assert c.post(BASE + f"/jobs/{world['jb']}/target-colleges", json={"college": "X College"}, headers=A).status_code == 404
    assert c.post(BASE + f"/jobs/{world['j1']}/target-colleges", json={"college": ""}, headers=A).status_code == 422
    cols = c.get(BASE + "/jobs/colleges", headers=A).json()["colleges"]
    nit = next(x for x in cols if x["college"] == "NIT Trichy")
    # c1 and c3 are private → excluded from the aggregate; c4 public mechanical counted; c2 civil (draft job branch) counted.
    assert nit["candidates"] == 2 and nit["targeted"] is True


def test_recruiter_jobs_v2_fields(world):
    c, A = world["client"], world["A"]
    form = {"title": "Plant Engineer", "description": "Run the plant", "branch": "chemical", "job_type": "full-time",
            "experience_level": "0-2", "openings": "3", "eligibility": "B.Tech 2026, CGPA >= 7",
            "target_colleges": '["IIT Madras", "NIT Trichy", "IIT Madras"]', "status": "draft"}
    r = c.post("/api/recruiter/jobs", data=form, headers=A)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["job_type"] == "full-time" and j["openings"] == 3 and j["status"] == "draft"
    assert j["target_colleges"] == ["IIT Madras", "NIT Trichy"]
    assert c.post("/api/recruiter/jobs", data={**form, "job_type": "gig"}, headers=A).status_code == 400
    assert c.post("/api/recruiter/jobs", data={**form, "status": "archived"}, headers=A).status_code == 400
    assert c.post("/api/recruiter/jobs", data={**form, "openings": "0"}, headers=A).status_code == 400
    r = c.put(f"/api/recruiter/jobs/{j['id']}", data={"status": "paused", "target_colleges": "RVCE, PES University"}, headers=A)
    assert r.status_code == 200 and r.json()["status"] == "paused" and r.json()["target_colleges"] == ["RVCE", "PES University"]
    assert c.put(f"/api/recruiter/jobs/{j['id']}", data={"status": "bogus"}, headers=A).status_code == 400
    # Legacy list keeps working and includes the new fields.
    assert any(x["id"] == j["id"] and x["experience_level"] == "0-2" for x in c.get("/api/recruiter/jobs", headers=A).json())


# ── candidates + privacy ────────────────────────────────────────────────────
def test_candidates_mine_and_search_privacy(world):
    c, A, B = world["client"], world["A"], world["B"]
    mine = c.get(BASE + "/candidates", headers=A).json()
    assert {i["candidate_id"] for i in mine["items"]} == {world["c1"], world["c4"]}
    search = c.get(BASE + "/candidates?view=search&page_size=50", headers=A).json()
    ids = {i["candidate_id"] for i in search["items"]}
    assert world["c1"] in ids  # private but applied to A's job
    assert world["c2"] in ids and world["c4"] in ids
    assert world["c3"] not in ids  # private, never applied
    assert all("email" not in i and "phone" not in i for i in search["items"])
    # Bob: c1 is private and never applied to Bob → hidden.
    bob = {i["candidate_id"] for i in c.get(BASE + "/candidates?view=search&page_size=50", headers=B).json()["items"]}
    assert world["c1"] not in bob and world["c2"] in bob
    # Filters / sort / validation
    assert {i["candidate_id"] for i in c.get(BASE + "/candidates?view=search&branch=civil", headers=A).json()["items"]} == {world["c2"]}
    assert c.get(BASE + "/candidates?view=search&q=bala", headers=A).json()["total"] == 1
    assert c.get(BASE + "/candidates?view=nope", headers=A).status_code == 400
    assert c.get(BASE + "/candidates?sort=nope", headers=A).status_code == 400
    assert c.get(BASE + "/candidates?status=shortlisted", headers=A).json()["total"] == 1


def test_candidate_detail_contact_rules(world):
    c, A, B = world["client"], world["A"], world["B"]
    d1 = c.get(BASE + f"/candidates/{world['c1']}", headers=A).json()
    assert d1["email"] == "c1@student.test" and d1["contact_visible"] is True  # applied
    assert d1["verified"] is True and d1["applications"][0]["application_id"] == world["a1"]
    d2 = c.get(BASE + f"/candidates/{world['c2']}", headers=A).json()
    assert d2["email"] is None and d2["phone"] is None and d2["contact_visible"] is False
    assert {j["id"] for j in d2["invitable_jobs"]} == {world["j1"]}
    d4 = c.get(BASE + f"/candidates/{world['c4']}", headers=A).json()
    assert d4["email"] == "c4@student.test"
    assert c.get(BASE + f"/candidates/{world['c3']}", headers=A).status_code == 404
    assert c.get(BASE + f"/candidates/{world['c1']}", headers=B).status_code == 404
    assert c.get(BASE + "/candidates/99999", headers=A).status_code == 404
    assert "gender" not in d1


def test_resume_access(world):
    c, A = world["client"], world["A"]
    assert c.get(BASE + f"/candidates/{world['c2']}/resume", headers=A).status_code == 403  # never applied to A
    assert c.get(BASE + f"/candidates/{world['c1']}/resume", headers=A).status_code == 404  # applied, no resume


def test_compare(world):
    c, A = world["client"], world["A"]
    r = c.post(BASE + "/candidates/compare", json={"candidate_ids": [world["c1"], world["c4"]]}, headers=A)
    assert r.status_code == 200 and len(r.json()["candidates"]) == 2
    assert c.post(BASE + "/candidates/compare", json={"candidate_ids": [1, 2, 3, 4]}, headers=A).status_code == 422
    assert c.post(BASE + "/candidates/compare", json={"candidate_ids": [world["c3"]]}, headers=A).status_code == 404


def test_notes_crud_and_ownership(world):
    c, A, B = world["client"], world["A"], world["B"]
    r = c.post(BASE + f"/candidates/{world['c1']}/notes", json={"text": "Strong CAD skills"}, headers=A)
    assert r.status_code == 200
    nid = r.json()["id"]
    assert c.post(BASE + f"/candidates/{world['c1']}/notes", json={"text": "   "}, headers=A).status_code == 400
    assert c.post(BASE + f"/candidates/{world['c1']}/notes", json={"text": "x" * 2001}, headers=A).status_code == 422
    assert c.post(BASE + f"/candidates/{world['c1']}/notes", json={"text": "hi", "application_id": world["a2"]}, headers=A).status_code == 404
    assert [n["text"] for n in c.get(BASE + f"/candidates/{world['c1']}/notes", headers=A).json()["notes"]] == ["Strong CAD skills"]
    assert c.put(BASE + f"/notes/{nid}", json={"text": "Edited"}, headers=B).status_code == 404
    assert c.delete(BASE + f"/notes/{nid}", headers=B).status_code == 404
    assert c.put(BASE + f"/notes/{nid}", json={"text": "Edited"}, headers=A).json()["text"] == "Edited"
    assert c.delete(BASE + f"/notes/{nid}", headers=A).json()["deleted"] is True
    with Session(engine) as s:
        assert s.exec(select(RecruiterNote)).all() == []


def test_invite_to_apply(world):
    c, A = world["client"], world["A"]
    r = c.post(BASE + f"/candidates/{world['c2']}/invite", json={"job_id": world["j1"], "message": "Loved your profile"}, headers=A)
    assert r.status_code == 200 and r.json()["queued"] is True
    assert c.post(BASE + f"/candidates/{world['c2']}/invite", json={"job_id": world["j2"]}, headers=A).status_code == 400  # draft
    assert c.post(BASE + f"/candidates/{world['c1']}/invite", json={"job_id": world["j1"]}, headers=A).status_code == 400  # applied
    assert c.post(BASE + f"/candidates/{world['c2']}/invite", json={"job_id": world["jb"]}, headers=A).status_code == 404  # Bob's job
    assert c.post(BASE + f"/candidates/{world['c3']}/invite", json={"job_id": world["j1"]}, headers=A).status_code == 404  # private


# ── applications ────────────────────────────────────────────────────────────
def test_applications_list_filters_and_counts(world):
    c, A = world["client"], world["A"]
    d = c.get(BASE + "/applications", headers=A).json()
    assert d["total"] == 2 and d["counts"]["under_review"] == 1 and d["counts"]["shortlisted"] == 1
    assert {p["key"] for p in d["pipeline"]} >= {"applied", "under_review", "shortlisted", "interview", "offer", "rejected"}
    assert c.get(BASE + "/applications?status=shortlisted", headers=A).json()["items"][0]["application_id"] == world["a4"]
    assert c.get(BASE + "/applications?min_match=75", headers=A).json()["total"] == 1
    assert c.get(BASE + f"/applications?job={world['j1']}&sort=match", headers=A).json()["items"][0]["application_id"] == world["a1"]
    assert c.get(BASE + f"/applications?job={world['jb']}", headers=A).status_code == 404
    assert c.get(BASE + "/applications?status=weird", headers=A).status_code == 400
    assert c.get(BASE + "/applications?date_from=notadate", headers=A).status_code == 400
    assert c.get(BASE + "/applications?page_size=501", headers=A).status_code == 422
    assert c.get(BASE + f"/applications/{world['a2']}", headers=A).status_code == 404
    assert c.get(BASE + f"/applications/{world['a1']}", headers=A).json()["job"]["id"] == world["j1"]


def test_bulk_actions_audit_and_ownership(world):
    c, A = world["client"], world["A"]
    # Any foreign id → whole request rejected, nothing changes.
    r = c.post(BASE + "/applications/bulk", json={"ids": [world["a1"], world["a2"]], "action": "shortlist"}, headers=A)
    assert r.status_code == 404
    with Session(engine) as s:
        assert s.get(Application, world["a1"]).status == "ats_check"
    r = c.post(BASE + "/applications/bulk", json={"ids": [world["a1"]], "action": "shortlist"}, headers=A)
    assert r.status_code == 200 and r.json()["changed"] == 1
    r = c.post(BASE + "/applications/bulk", json={"ids": [world["a1"]], "action": "reject", "reason": "Location mismatch"}, headers=A)
    assert r.json()["changed"] == 1
    with Session(engine) as s:
        a = s.get(Application, world["a1"])
        assert a.status == "rejected" and a.human_decision_notes == "Location mismatch" and a.human_reviewer == "alice@acme.test"
        actions = [l.human_action for l in s.exec(select(DecisionAuditLog).where(DecisionAuditLog.application_id == world["a1"])).all()]
        assert actions == ["status_change_shortlisted", "status_change_rejected"]
    assert c.post(BASE + "/applications/bulk", json={"ids": [world["a1"]], "action": "email"}, headers=A).status_code == 400
    r = c.post(BASE + "/applications/bulk", json={"ids": [world["a1"], world["a4"]], "action": "email", "subject": "Update", "body": "Hello"}, headers=A)
    assert r.status_code == 200 and r.json()["ok"] == 2
    assert c.post(BASE + "/applications/bulk", json={"ids": [world["a1"]], "action": "hire"}, headers=A).status_code == 400
    assert c.post(BASE + "/applications/bulk", json={"ids": list(range(1, 202)), "action": "shortlist"}, headers=A).status_code == 422


def test_unshortlist(world):
    c, A = world["client"], world["A"]
    r = c.post(BASE + "/applications/bulk", json={"ids": [world["a4"]], "action": "unshortlist"}, headers=A)
    assert r.json()["changed"] == 1
    with Session(engine) as s:
        assert s.get(Application, world["a4"]).status == "ats_check"
    r = c.post(BASE + "/applications/bulk", json={"ids": [world["a4"]], "action": "unshortlist"}, headers=A)
    assert r.json()["changed"] == 0


def test_move_to_next_stage_semantics(world):
    c, A, B = world["client"], world["A"], world["B"]
    # ats_check → shortlisted
    r = c.post(BASE + f"/applications/{world['a1']}/next-stage", headers=A).json()
    assert r["action"] == "shortlisted" and r["changed"] is True
    # shortlisted without project verification → stays, with a reason
    r = c.post(BASE + f"/applications/{world['a1']}/next-stage", headers=A).json()
    assert r["changed"] is False and r["ok"] is False and "verification" in r["message"]
    # with a project score → AI interview unlocked
    with Session(engine) as s:
        a = s.get(Application, world["a1"])
        a.repo_match_score = 72
        s.add(a)
        s.commit()
    r = c.post(BASE + f"/applications/{world['a1']}/next-stage", headers=A).json()
    assert r["action"] == "interview_unlocked"
    with Session(engine) as s:
        assert s.get(Application, world["a1"]).interview_status == "unlocked"
    # automated_interview → offer stage
    with Session(engine) as s:
        a = s.get(Application, world["a4"])
        a.status = "automated_interview"
        a.interview_status = "completed"
        s.add(a)
        s.commit()
    r = c.post(BASE + f"/applications/{world['a4']}/next-stage", headers=A).json()
    assert r["action"] == "offer" and r["navigate"] == f"/recruiter/offers?application={world['a4']}"
    assert c.post(BASE + f"/applications/{world['a1']}/next-stage", headers=B).status_code == 404


# ── shortlisted ─────────────────────────────────────────────────────────────
def test_shortlisted_page(world):
    c, A = world["client"], world["A"]
    with Session(engine) as s:
        s.add(ScheduledInterview(application_id=world["a4"], job_id=world["j1"], candidate_id=world["c4"], recruiter_id=world["ra"],
                                 round_name="HR Round", starts_at=utc_now() + timedelta(days=2)))
        s.commit()
    d = c.get(BASE + "/shortlisted", headers=A).json()
    assert d["total"] == 1
    item = d["items"][0]
    assert item["interview_state"] == "interview_scheduled" and item["next_step"]["round_name"] == "HR Round"
    pipe = {p["key"]: p["count"] for p in d["pipeline"]}
    assert pipe["shortlisted"] == 1 and pipe["interview_scheduled"] == 1 and pipe["hr_round"] == 1
    assert len(d["upcoming"]) == 1 and d["insights"]
    assert c.get(BASE + "/shortlisted?interview_status=interview_completed", headers=A).json()["total"] == 0
    assert c.get(BASE + "/shortlisted?interview_status=bad", headers=A).status_code == 400
    assert c.get(BASE + "/shortlisted", headers=world["B"]).json()["total"] == 0
