"""Regressions for the Nov 2026 audit: NULL JSON columns, missing upload filenames,
applicant names, and database-side job filtering/pagination."""
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.auth import create_access_token
from app.db import Application, CandidateProfile, CandidateUser, Job, RecruiterUser, User, engine
from app.main import app
from app.services import llm_stream
from app.utils_json import jloads


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(llm_stream, "configured_providers", lambda: [])
    with TestClient(app) as c:
        yield c


def H(email, role):
    return {"Authorization": f"Bearer {create_access_token(username=email, role=role)}"}


def seed():
    with Session(engine) as s:
        rec = RecruiterUser(username="rec@x.com", password_hash="x")
        cand = CandidateUser(username="asha@x.com", password_hash="x")
        s.add_all([rec, cand, User(email="rec@x.com", name="Rec", role="recruiter", password_hash="x", email_verified=True)])
        s.commit()
        s.refresh(rec)
        s.refresh(cand)
        s.add(CandidateProfile(candidate_id=cand.id, full_name="Asha Rao", headline="Backend Engineer"))
        jobs = [Job(recruiter_id=rec.id, title=t, description="d", location_text=loc, salary_min=lo, salary_max=hi, remote_type=rt, status="open")
                for t, loc, lo, hi, rt in [("Design Engineer", "Pune", 4, 6, "onsite"), ("Civil Site Engineer", "Bengaluru", 3, 5, "onsite"),
                                           ("Embedded Engineer", None, 8, 12, "remote"), ("Design Intern", "Pune", 1, 2, "hybrid")]]
        s.add_all(jobs)
        s.commit()
        for j in jobs:
            s.refresh(j)
        appl = Application(candidate_id=cand.id, job_id=jobs[0].id, status="applied")
        s.add(appl)
        s.commit()
        # legacy rows: columns added later by ALTER TABLE can be empty/NULL
        appl.matched_skills_json = ""
        appl.missing_skills_json = "not-json"
        s.add(appl)
        s.commit()
        return jobs[0].id


def test_jloads_tolerates_null_and_garbage():
    assert jloads(None) == [] and jloads("") == [] and jloads("not json") == [] and jloads('["a"]') == ["a"] and jloads("null", {}) == {}


def test_empty_or_bad_json_columns_do_not_500(client):
    job_id = seed()
    r = client.get("/api/candidate/jobs/applications/mine", headers=H("asha@x.com", "candidate"))
    assert r.status_code == 200, r.text
    assert r.json()["applications"][0]["matched_skills"] == []
    r = client.get(f"/api/recruiter/jobs/{job_id}/applicants", headers=H("rec@x.com", "recruiter"))
    assert r.status_code == 200, r.text
    row = r.json()["applicants"][0] if "applicants" in r.json() else r.json()[0] if isinstance(r.json(), list) else next(iter(v for v in r.json().values() if isinstance(v, list)))[0]
    assert row["candidate_name"] == "Asha Rao" and row["missing_skills"] == []


def test_job_search_filters_in_db_and_paginates(client):
    seed()
    h = H("asha@x.com", "candidate")
    got = client.get("/api/candidate/jobs", params={"title": "design"}, headers=h).json()
    assert {j["title"] for j in got["jobs"]} == {"Design Engineer", "Design Intern"} and got["total"] == 2
    got = client.get("/api/candidate/jobs", params={"location": "pune", "remote_type": "hybrid"}, headers=h).json()
    assert [j["title"] for j in got["jobs"]] == ["Design Intern"]
    got = client.get("/api/candidate/jobs", params={"salary_min": 7}, headers=h).json()
    assert [j["title"] for j in got["jobs"]] == ["Embedded Engineer"]        # NULL location doesn't crash
    page = client.get("/api/candidate/jobs", params={"limit": 2, "offset": 2}, headers=h).json()
    assert page["total"] == 4 and page["count"] == 2
    sal = client.get("/api/candidate/jobs", params={"sort_by": "salary"}, headers=h).json()
    assert sal["jobs"][0]["title"] == "Embedded Engineer"


def test_upload_without_filename_is_400_not_500(client):
    seed()
    files = {"file": ("", b"%PDF-1.4 tiny", "application/pdf")}
    r = client.post("/api/candidate/score-project", files=files, data={"job_description": "x"}, headers=H("asha@x.com", "candidate"))
    assert r.status_code in (400, 422), r.text
