"""Resume ↔ job match (one job, pasted JD) and best-fit jobs."""
import json

import pytest
from sqlmodel import Session

from app.db import ExternalJob, engine, utc_now
from app.services import hot_data, llm_stream
from tests.test_student_portal import H, _job, _recruiter, _student, client  # noqa: F401  (fixture)


@pytest.fixture(autouse=True)
def _fresh_caches():
    for c in ("jobs_cache", "external_cache"):
        cache = getattr(hot_data, c, None)
        if cache is not None and hasattr(cache, "clear"):
            cache.clear()
    yield


def _ext(title="CAD Design Engineer", skills=("SolidWorks", "GD&T"), branch="mechanical", **kw):
    with Session(engine) as s:
        e = ExternalJob(source="greenhouse", external_id=f"x-{title}", company_name="Bosch", title=title,
                        description_text=f"{title}. Must know {', '.join(skills)}.", skills_json=json.dumps(list(skills)),
                        branch=branch, apply_url="https://jobs.example.com/1", status="active", posted_at=utc_now(), **kw)
        s.add(e)
        s.commit()
        s.refresh(e)
        return e.id


def test_needs_resume(client):
    _student("nores@example.com")
    rid = _recruiter()
    jid = _job(rid)
    r = client.get(f"/api/student/resume/job-match?job={jid}", headers=H("nores@example.com"))
    assert r.status_code == 409 and "Upload your resume" in r.json()["detail"]


def test_match_internal_job(client):
    _student(with_resume=True, skills=("SolidWorks", "ANSYS", "Creo"))
    rid = _recruiter()
    jid = _job(rid, title="Mechanical Design Intern", reqs="SolidWorks, ANSYS, GD&T, Creo, Fusion 360")
    r = client.get(f"/api/student/resume/job-match?job={jid}", headers=H())
    assert r.status_code == 200, r.text
    d = r.json()
    assert 0 <= d["score"] <= 100 and d["verdict"]["label"]
    assert "SolidWorks" in d["matched_skills"] and "ANSYS" in d["matched_skills"]
    assert "Creo" in d["on_profile_not_resume"]          # on the profile, not in the resume
    assert any(t["kind"] == "keywords" for t in d["tips"])
    assert d["job"]["id"] == jid and d["job"]["applied"] is False
    assert d["ai_tips"] == [] and d["cached"] is False
    again = client.get(f"/api/student/resume/job-match?job={jid}", headers=H()).json()
    assert again["cached"] is True and again["score"] == d["score"]


def test_match_external_job_and_closed_jobs(client):
    _student(with_resume=True)
    eid = _ext()
    r = client.get(f"/api/student/resume/job-match?job=ext-{eid}", headers=H())
    assert r.status_code == 200, r.text
    assert r.json()["job"]["external"] is True and r.json()["job"]["apply_url"].startswith("https://")
    rid = _recruiter()
    closed = _job(rid, status="closed")
    assert client.get(f"/api/student/resume/job-match?job={closed}", headers=H()).status_code == 404
    assert client.get("/api/student/resume/job-match?job=abc", headers=H()).status_code == 400


def test_pasted_jd(client):
    _student(with_resume=True)
    jd = "Thermal Engineer — design HVAC systems. Required: AutoCAD, HVAC, CFD, MATLAB. 0-2 years."
    r = client.post("/api/student/resume/job-match", headers=H(), json={"jd_text": jd, "title": "Thermal Engineer"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["job"]["pasted"] is True and d["job"]["title"] == "Thermal Engineer"
    assert "AutoCAD" in d["matched_skills"]
    assert client.post("/api/student/resume/job-match", headers=H(), json={"jd_text": "too short"}).status_code == 422


def test_ai_tips_when_llm_available(client, monkeypatch):
    _student(with_resume=True)
    rid = _recruiter()
    jid = _job(rid)
    monkeypatch.setattr(llm_stream, "configured_providers", lambda: ["groq"])

    async def fake(messages, **kw):
        return {"tips": [{"title": "Lead with your gearbox FEA project", "detail": "It matches their simulation focus."}]}
    monkeypatch.setattr(llm_stream, "complete_json", fake)
    d = client.get(f"/api/student/resume/job-match?job={jid}&refresh=true", headers=H()).json()
    assert d["ai_tips"][0]["title"].startswith("Lead with")


def test_best_jobs_ranks_fitting_roles_first(client):
    _student(with_resume=True)
    rid = _recruiter()
    good = _job(rid, title="Mechanical Design Intern", reqs="SolidWorks, ANSYS, GD&T, CATIA, MATLAB")
    bad = _job(rid, title="Embedded Firmware Engineer", branch="electronics", reqs="Embedded C, RTOS, PCB design, Verilog, ARM Cortex")
    eid = _ext(title="CAD Engineer", skills=("SolidWorks", "AutoCAD", "GD&T"))
    r = client.get("/api/student/resume/best-jobs?limit=5", headers=H())
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    ids = [i["id"] for i in items]
    assert good in ids and f"ext-{eid}" in ids
    assert ids.index(good) < ids.index(bad) if bad in ids else True
    top = items[0]
    assert top["ats_score"] >= items[-1]["ats_score"] and top["verdict"]["label"]
    assert isinstance(top["matched_skills"], list)
    only_live = client.get("/api/student/resume/best-jobs?origin=live", headers=H()).json()["items"]
    assert all(i["external"] for i in only_live)


def test_skill_aliases_and_tags_are_cleaned(client):
    _student(with_resume=True)
    rid = _recruiter()
    jid = _job(rid, title="Gear Design Engineer", reqs="FEA, FEA (Finite Element Analysis), Demo, IS, Gear design, SolidWorks")
    d = client.get(f"/api/student/resume/job-match?job={jid}", headers=H()).json()
    req = [s.lower() for s in d["required_skills"]]
    assert "demo" not in req and "is" not in req
    assert sum(1 for s in req if s.startswith("fea")) == 1
    assert "Gear design" in d["missing_skills"]
