"""Fictional demo students on the demo companies: labelled, isolated, removable, never in public numbers."""
from sqlmodel import Session, select

from app.db import Application, CandidateProfile, CandidateUser, Job
from app.db import engine
from app.services import demo_activity
from tests.test_company_directory_portal import _admin, _post_job, _recruiter, _student, client  # noqa: F401


def test_demo_students_need_demo_companies(client):
    ah = _admin()
    r = client.post("/api/admin/demo/activity", headers=ah)
    assert r.status_code == 409 and "demo companies first" in r.json()["detail"]


def test_demo_activity_flow(client):
    ah = _admin()
    real_uid, _sh = _student()
    _rid, rh = _recruiter("talent@real.example", "Real Engineering Co")
    real_job = _post_job(client, rh, title="Real job")
    before = client.get("/api/public/stats").json()
    client.post("/api/admin/demo/companies", headers=ah)

    r = client.post("/api/admin/demo/activity", headers=ah)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["students_created"] == 24 and body["demo_students"] == 24
    assert 48 <= body["demo_student_applications"] <= 72
    # idempotent
    again = client.post("/api/admin/demo/activity", headers=ah).json()
    assert again["students_created"] == 0 and again["applications_created"] == 0
    assert again["demo_student_applications"] == body["demo_student_applications"]

    with Session(engine) as s:
        demo_users = s.exec(select(CandidateUser).where(CandidateUser.username.like("%@students.demo.corelink"))).all()
        assert len(demo_users) == 24
        ids = [u.id for u in demo_users]
        profs = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id.in_(ids))).all()
        assert all("Demo profile" in p.bio and p.college and p.branch for p in profs)
        apps = s.exec(select(Application).where(Application.candidate_id.in_(ids))).all()
        demo_job_ids = {j.id for j in s.exec(select(Job).where(Job.id != real_job)).all()}
        assert all(a.job_id in demo_job_ids for a in apps)            # never on real jobs
        assert all(38 <= a.ats_score <= 93 for a in apps)
        assert len({a.status for a in apps}) >= 3                     # a realistic pipeline mix

    # Public landing numbers ignore every demo company, job and student.
    after = client.get("/api/public/stats").json()
    assert after["students"] == before["students"] and after["open_jobs"] == before["open_jobs"]
    assert not any(n.startswith("Demo") for n in after["company_names"])

    # Real recruiter never sees demo applicants.
    assert client.get(f"/api/recruiter/jobs/{real_job}/applicants", headers=rh).json()["applicant_count"] == 0

    st = client.get("/api/admin/demo/companies", headers=ah).json()
    assert st["demo_students"] == 24
    d = client.delete("/api/admin/demo/activity", headers=ah).json()
    assert d["demo_students"] == 24
    with Session(engine) as s:
        assert not s.exec(select(CandidateUser).where(CandidateUser.username.like("%@students.demo.corelink"))).all()
        assert s.get(CandidateUser, real_uid) is not None


def test_removing_demo_companies_also_removes_demo_students(client):
    ah = _admin()
    client.post("/api/admin/demo/companies", headers=ah)
    client.post("/api/admin/demo/activity", headers=ah)
    r = client.delete("/api/admin/demo/companies", headers=ah).json()
    assert r["demo_students"] == 24
    assert demo_activity.status() == {"demo_students": 0, "demo_student_applications": 0}
