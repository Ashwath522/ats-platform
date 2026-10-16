"""Company directory, follow + notify, and the DEMO companies admin tools."""
import importlib.util
import json
import os
from datetime import timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.auth import create_access_token, hash_password
from app.db import (
    Application, CandidateProfile, CandidateUser, CompanyDirectory, CompanyFollow, CompanyProfile, EmailLog, ExternalJob,
    Job, RecruiterUser, User, engine, utc_now,
)
from app.main import app
from app.services import company_directory as cd
from app.services import demo_companies, email_delivery, live_sync, llm_stream
from app.services.company_seed import COMPANIES
from app.services.demo_company_data import DEMO_COMPANIES

D = "/api/student/company-directory"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(llm_stream, "configured_providers", lambda: [])
    with TestClient(app) as c:
        yield c


@pytest.fixture
def emails(monkeypatch):
    sent = []

    def fake_queue(to, subject, body, html=None, category="general"):
        sent.append({"to": to, "subject": subject, "category": category})
        with Session(engine) as s:
            s.add(EmailLog(to_email=to, subject=subject, category=category, status="logged"))
            s.commit()
        return len(sent)
    monkeypatch.setattr(email_delivery, "queue_email", fake_queue)
    return sent


def H(email, role):
    return {"Authorization": f"Bearer {create_access_token(username=email, role=role)}"}


def _admin():
    with Session(engine) as s:
        s.add(User(name="Ada", email="admin@corelink.test", role="admin", password_hash=hash_password("AdminPass123!"), email_verified=True))
        s.commit()
    return H("admin@corelink.test", "admin")


def _student(email="stu@example.com", branch="mechanical", notifications=None, resume=False):
    with Session(engine) as s:
        u = CandidateUser(username=email, password_hash="x")
        s.add(u)
        s.commit()
        s.refresh(u)
        p = CandidateProfile(candidate_id=u.id, branch=branch, skills_json=json.dumps(["SolidWorks", "GD&T"]), full_name="Asha",
                             notifications_json=json.dumps(notifications) if notifications is not None else None)
        if resume:
            from app.db import Resume
            r = Resume(filename="cv.pdf", file_path="/nonexistent/cv.pdf", vector_doc_id="r-test", content_hash="h")
            s.add(r)
            s.commit()
            s.refresh(r)
            p.resume_id = r.id
        s.add(p)
        s.commit()
        return u.id, H(email, "candidate")


def _recruiter(email, company_name):
    with Session(engine) as s:
        s.add(User(name="R", email=email, role="recruiter", password_hash=hash_password("Recruit@2026"), email_verified=True))
        ru = RecruiterUser(username=email, password_hash="x")
        s.add(ru)
        s.commit()
        s.refresh(ru)
        s.add(CompanyProfile(owner_recruiter_id=ru.id, name=company_name))
        s.commit()
        return ru.id, H(email, "recruiter")


def _post_job(client, h, title="Graduate Engineer Trainee", job_type="full-time", status="open"):
    r = client.post("/api/recruiter/jobs", headers=h, data={
        "title": title, "description": "Design gearboxes", "branch": "mechanical", "location_text": "Pune",
        "requirements": "SolidWorks, GD&T", "job_type": job_type, "status": status})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _ext(company_name="Bosch Group", slug="BoschGroup", title="Hardware specialist", source="smartrecruiters", ext_id="e1", **kw):
    now = utc_now()
    with Session(engine) as s:
        e = ExternalJob(source=source, external_id=ext_id, company_name=company_name, company_slug=slug, title=title,
                        apply_url="https://jobs.smartrecruiters.com/x", branch="ece", job_type=kw.get("job_type", "full-time"),
                        posted_at=now, first_seen_at=kw.get("first_seen_at", now), city="Bengaluru", location_text="Bengaluru, India")
        s.add(e)
        s.commit()
        s.refresh(e)
        return e


# ── directory ────────────────────────────────────────────────────────────────

def test_seed_data_is_honest_and_complete():
    slugs = [c["slug"] for c in COMPANIES]
    assert len(slugs) == len(set(slugs)) and len(COMPANIES) >= 30
    domains = {c["slug"]: c["domain"] for c in COMPANIES}
    for slug, dom in {"bosch": "bosch.com", "siemens": "siemens.com", "larsen-toubro": "larsentoubro.com", "bharat-electronics": "bel-india.in",
                      "hal": "hal-india.co.in", "isro": "isro.gov.in", "ntpc": "ntpc.co.in", "ongc": "ongcindia.com", "reliance-industries": "ril.com",
                      "jsw-steel": "jsw.in", "schneider-electric": "se.com", "wabtec": "wabteccorp.com", "texas-instruments": "ti.com",
                      "ge-aerospace": "geaerospace.com", "thermax": "thermaxglobal.com", "godrej-boyce": "godrejandboyce.com"}.items():
        assert domains[slug] == dom
    core = {"mechanical", "civil", "eee", "ece", "chemical", "aerospace", "automobile", "metallurgy"}
    for c in COMPANIES:
        assert c["branches"] and set(c["branches"]) <= core
        assert c["about"] and 2 <= c["about"].count(". ") + 1 <= 4
        assert "demo" not in c["name"].lower()
    assert {c["smartrecruiters_id"] for c in COMPANIES if c.get("smartrecruiters_id")} == {"BoschGroup", "Wabtec", "Continental"}


def test_directory_list_filters_and_suggest(client):
    _uid, h = _student()
    r = client.get(D, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == len(COMPANIES)
    bosch = next(i for i in body["items"] if i["slug"] == "bosch")
    assert bosch["domain"] == "bosch.com" and bosch["is_demo"] is False and bosch["following"] is False
    assert "Bengaluru" in body["facets"]["locations"]
    # filters
    aero = client.get(D, headers=h, params={"branch": "aerospace"}).json()["items"]
    assert aero and all("aerospace" in i["branches"] for i in aero)
    assert {i["slug"] for i in client.get(D, headers=h, params={"location": "Jamshedpur"}).json()["items"]} >= {"tata-steel", "tata-motors"}
    assert client.get(D, headers=h, params={"hiring": True}).json()["total"] == 0
    assert client.get(D, headers=h, params={"branch": "software"}).status_code == 422
    # suggestions, prefix ranked first
    s = client.get(f"{D}/suggest", headers=h, params={"q": "bo"}).json()["items"]
    assert s[0]["slug"] == "bosch" and s[0]["domain"] == "bosch.com" and "industry" in s[0]
    assert client.get(f"{D}/suggest", headers=h, params={"q": ""}).json()["items"] == []
    # auth
    assert client.get(D).status_code in (401, 403)
    rec_h = _recruiter("r@acme.com", "Acme")[1]
    assert client.get(D, headers=rec_h).status_code == 403


def test_portfolio_shows_real_internal_and_live_roles(client):
    _uid, h = _student()
    _rid, rh = _recruiter("talent@bosch.example", "Bosch Limited")      # name maps onto the Bosch portfolio
    jid = _post_job(client, rh)
    iid = _post_job(client, rh, title="Embedded Intern", job_type="internship")
    e = _ext()
    _ext(company_name="Some Other Co", slug="OtherCo", ext_id="e2", title="Unrelated")
    r = client.get(f"{D}/bosch", headers=h)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["name"] == "Bosch" and p["domain"] == "bosch.com" and p["open_roles"] == 3
    assert {j["id"] for j in p["jobs"]} == {jid, f"ext-{e.id}"}
    assert [j["id"] for j in p["internships"]] == [iid]
    assert all(j["company_slug"] == "bosch" and j["company_domain"] == "bosch.com" for j in p["jobs"] + p["internships"])
    ext_card = next(j for j in p["jobs"] if j["external"])
    assert ext_card["apply_url"].startswith("https://")
    assert client.get(f"{D}/no-such-co", headers=h).status_code == 404
    assert client.get(f"{D}/..%2Fetc", headers=h).status_code == 404
    # grid counts + hiring filter + opportunities company filter
    row = next(i for i in client.get(D, headers=h, params={"hiring": True}).json()["items"] if i["slug"] == "bosch")
    assert row["open_roles"] == 3 and row["open_internships"] == 1
    opp = client.get("/api/student/opportunities", headers=h, params={"company": "bosch", "page_size": 50}).json()
    assert opp["total"] == 3 and all(i["company_slug"] == "bosch" for i in opp["items"])


def test_follow_unfollow_and_following_list(client):
    _uid, h = _student()
    r = client.post(f"{D}/siemens/follow", headers=h, json={})
    assert r.status_code == 201 and r.json()["following"] is True and r.json()["notify_email"] is True
    assert client.post(f"{D}/siemens/follow", headers=h).status_code == 201          # idempotent
    with Session(engine) as s:
        assert len(s.exec(select(CompanyFollow)).all()) == 1
    assert client.patch(f"{D}/siemens/follow", headers=h, json={"notify_email": False}).json()["notify_email"] is False
    f = client.get(f"{D}/following", headers=h).json()
    assert f["total"] == 1 and f["items"][0]["slug"] == "siemens" and f["items"][0]["notify_email"] is False
    assert client.get(D, headers=h, params={"following_only": True}).json()["total"] == 1
    assert client.get(f"{D}/siemens", headers=h).json()["following"] is True
    assert client.post(f"{D}/nope/follow", headers=h).status_code == 404
    assert client.delete(f"{D}/siemens/follow", headers=h).json()["following"] is False
    assert client.get(f"{D}/following", headers=h).json()["total"] == 0
    assert client.patch(f"{D}/siemens/follow", headers=h, json={"notify_email": True}).status_code == 404
    # another student's follows are separate
    _u2, h2 = _student("other@example.com")
    client.post(f"{D}/abb/follow", headers=h2)
    assert client.get(f"{D}/following", headers=h).json()["total"] == 0


def test_bell_and_email_for_new_internal_job_at_followed_company(client, emails):
    uid, h = _student(email="asha@example.com")
    _u_off, h_off = _student(email="quiet@example.com", notifications={"email": True, "job_alerts": False})
    _rid, rh = _recruiter("talent@ti.example", "Texas Instruments India")
    old = _post_job(client, rh, title="Old role before follow")
    client.post(f"{D}/texas-instruments/follow", headers=h)
    client.post(f"{D}/texas-instruments/follow", headers=h_off)
    with Session(engine) as s:   # follow happened after the old job
        for f in s.exec(select(CompanyFollow)).all():
            f.created_at = utc_now() - timedelta(seconds=1)
            s.add(f)
        j = s.get(Job, old)
        j.created_at = utc_now() - timedelta(minutes=5)
        s.add(j)
        s.commit()
    emails.clear()
    new_id = _post_job(client, rh, title="Analog Design Engineer")
    items = client.get("/api/notifications", headers=h).json()["items"]
    mine = [i for i in items if i["kind"] == "company_job"]
    assert [i["title"] for i in mine] == ["New role at Texas Instruments: Analog Design Engineer"]
    assert mine[0]["link"] == f"/candidate/companies/texas-instruments?job={new_id}"
    # email: only the student whose job alerts are on; at most one per company per day
    assert [e["to"] for e in emails] == ["asha@example.com"]
    assert emails[0]["category"] == "company_follow:texas-instruments"
    _post_job(client, rh, title="Second role same day")
    assert len(emails) == 1
    assert len([i for i in client.get("/api/notifications", headers=h).json()["items"] if i["kind"] == "company_job"]) == 2
    # a draft does not notify until it is opened
    draft = _post_job(client, rh, title="Draft role", status="draft")
    assert all("Draft role" not in i["title"] for i in client.get("/api/notifications", headers=h).json()["items"])
    with Session(engine) as s:
        s.exec(select(EmailLog)).all()
        for row in s.exec(select(EmailLog)).all():
            row.created_at = utc_now() - timedelta(days=2)
            s.add(row)
        s.commit()
    r = client.put(f"/api/recruiter/jobs/{draft}", headers=rh, data={"status": "open"})
    assert r.status_code == 200
    assert len(emails) == 2 and "Draft role" in emails[-1]["subject"]
    # notify_email off -> bell only
    client.patch(f"{D}/texas-instruments/follow", headers=h, json={"notify_email": False})
    with Session(engine) as s:
        for row in s.exec(select(EmailLog)).all():
            row.created_at = utc_now() - timedelta(days=2)
            s.add(row)
        s.commit()
    _post_job(client, rh, title="Fourth role")
    assert len(emails) == 2


def test_live_job_for_followed_company_notifies(client, emails):
    uid, h = _student(email="asha@example.com")
    client.post(f"{D}/bosch/follow", headers=h)
    with Session(engine) as s:
        f = s.exec(select(CompanyFollow)).first()
        f.created_at = utc_now() - timedelta(minutes=1)
        s.add(f)
        s.commit()
    e = _ext(title="Hardware Technical specialist")
    _ext(company_name="Wabtec", slug="Wabtec", ext_id="w1", title="Unfollowed company role")
    assert cd.notify_new_external_jobs([e]) == 1
    assert emails[0]["to"] == "asha@example.com" and "Bosch" in emails[0]["subject"]
    feed = [i for i in client.get("/api/notifications", headers=h).json()["items"] if i["kind"] == "company_job"]
    assert [i["title"] for i in feed] == ["New role at Bosch: Hardware Technical specialist"]
    assert feed[0]["link"] == f"/candidate/companies/bosch?job=ext-{e.id}"
    # older listings (seen before the follow) are not "new"
    with Session(engine) as s:
        row = s.get(ExternalJob, e.id)
        row.first_seen_at = utc_now() - timedelta(hours=1)
        s.add(row)
        s.commit()
    assert not [i for i in client.get("/api/notifications", headers=h).json()["items"] if i["kind"] == "company_job"]


def test_live_sync_hook_calls_follow_notifier(client, monkeypatch):
    path = os.path.join(os.path.dirname(__file__), "test_live_sync.py")
    spec = importlib.util.spec_from_file_location("_tls_for_directory", path)
    tls = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tls)
    monkeypatch.setattr(live_sync, "TRANSPORT", httpx.MockTransport(tls.FakeNet()))
    seen = []
    monkeypatch.setattr(cd, "notify_new_external_jobs", lambda rows: seen.extend(rows) or 0)
    live_sync.run_sync_blocking("jobs", "test", ["smartrecruiters"])
    assert seen, "new live jobs must be passed to the follow notifier"
    assert {r.company_slug for r in seen} <= {"BoschGroup", "Wabtec", "Continental"}
    assert {cd.slug_for_external(r) for r in seen} <= {"bosch", "wabtec", "continental"}


# ── demo companies ───────────────────────────────────────────────────────────

def test_demo_data_is_fictional_and_covers_all_branches():
    assert len(DEMO_COMPANIES) == 20
    branches, cities, kinds = set(), set(), set()
    for c in DEMO_COMPANIES:
        assert 3 <= len(c["jobs"]) <= 4
        assert not any(c["name"].lower().startswith(r["name"].lower()) for r in COMPANIES)
        for j in c["jobs"]:
            branches.add(j[1]); kinds.add(j[2]); cities.add(j[3])
            assert j[4] < j[5]
    assert branches == {"mechanical", "civil", "eee", "ece", "chemical", "aerospace", "automobile", "metallurgy"}
    assert kinds == {"full-time", "internship"} and len(cities) >= 10


def test_demo_create_is_idempotent_and_logins_work(client):
    ah = _admin()
    _uid, sh = _student(resume=True)
    r = client.post("/api/admin/demo/companies", headers=ah)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["companies"] == 20 and body["accounts_created"] == 20
    logins = body["logins"]
    assert all(l["password"] and len(l["password"]) >= 16 and l["created"] for l in logins)
    assert all(l["email"].endswith(".demo.corelink") for l in logins)
    with Session(engine) as s:   # never stored in plain text
        hashes = {u.email: u.password_hash for u in s.exec(select(User).where(User.role == "recruiter")).all()}
        assert all(hashes[l["email"]].startswith("$2") and l["password"] not in hashes[l["email"]] for l in logins)
    # every login: auth, own company, own 3-4 jobs
    tokens = {}
    for l in logins:
        t = client.post("/api/recruiter/auth/login", data={"username": l["email"], "password": l["password"]})
        assert t.status_code == 200, (l["email"], t.text)
        rh = {"Authorization": f"Bearer {t.json()['access_token']}"}
        tokens[l["email"]] = rh
        comp = client.get("/api/recruiter/hiring/company", headers=rh).json()
        assert comp["name"] == l["company"] and comp["name"].startswith("Demo · ")
        jobs = client.get("/api/recruiter/jobs", headers=rh).json()
        assert len(jobs) == l["jobs"] and 3 <= len(jobs) <= 4
    # refresh: no new accounts, no passwords, no duplicate jobs
    again = client.post("/api/admin/demo/companies", headers=ah).json()
    assert again["accounts_created"] == 0 and all(l["password"] is None for l in again["logins"])
    with Session(engine) as s:
        assert len(s.exec(select(CompanyDirectory).where(CompanyDirectory.is_demo == True)).all()) == 20  # noqa: E712
        assert len(s.exec(select(Job)).all()) == sum(len(c["jobs"]) for c in DEMO_COMPANIES)
    # old passwords still work after refresh
    first = logins[0]
    assert client.post("/api/recruiter/auth/login", data={"username": first["email"], "password": first["password"]}).status_code == 200
    # students see the demo companies with the demo flag
    lst = client.get(D, headers=sh, params={"demo": "demo"}).json()
    assert lst["total"] == 20 and all(i["is_demo"] and i["domain"] is None for i in lst["items"])
    port = client.get(f"{D}/{first['slug']}", headers=sh).json()
    assert port["is_demo"] and port["open_roles"] == first["jobs"]
    assert all(j["company_demo"] for j in port["jobs"] + port["internships"])
    # a student applies -> only that company's recruiter sees the applicant
    from app.api import candidate_jobs  # noqa: F401
    job_id = (port["jobs"] + port["internships"])[0]["id"]
    with Session(engine) as s:
        s.add(Application(candidate_id=_uid, job_id=job_id, ats_score=70))
        s.commit()
    own = client.get(f"/api/recruiter/jobs/{job_id}/applicants", headers=tokens[first["email"]])
    assert own.status_code == 200 and own.json()["applicant_count"] == 1
    other = logins[1]
    assert client.get(f"/api/recruiter/jobs/{job_id}/applicants", headers=tokens[other["email"]]).status_code in (403, 404)
    other_jobs = {j["id"] for j in client.get("/api/recruiter/jobs", headers=tokens[other["email"]]).json()}
    assert job_id not in other_jobs
    portal_apps = client.get("/api/recruiter/portal/applications", headers=tokens[other["email"]]).json()
    assert portal_apps.get("total", 0) == 0
    # admin sees the Demo flag on jobs
    adm_jobs = client.get("/api/admin/portal/jobs", headers=ah, params={"page_size": 100}).json()["items"]
    assert adm_jobs and all(j["is_demo"] for j in adm_jobs)


def test_demo_delete_removes_everything_including_applications(client):
    ah = _admin()
    uid, sh = _student()
    _rid, rh = _recruiter("talent@real.example", "Real Engineering Co")
    real_job = _post_job(client, rh, title="Real job")
    client.post("/api/admin/demo/companies", headers=ah)
    with Session(engine) as s:
        demo_job = s.exec(select(Job).where(Job.id != real_job)).first()
        s.add(Application(candidate_id=uid, job_id=demo_job.id))
        s.add(Application(candidate_id=uid, job_id=real_job))
        s.commit()
    slug = demo_companies.demo_slug(DEMO_COMPANIES[0]["key"])
    client.post(f"{D}/{slug}/follow", headers=sh)
    assert client.get("/api/admin/demo/companies", headers=ah).json() == {"companies": 20, "recruiters": 20, "jobs": 62, "applications": 1}
    r = client.delete("/api/admin/demo/companies", headers=ah)
    assert r.status_code == 200 and r.json()["companies"] == 20 and r.json()["applications"] == 1
    with Session(engine) as s:
        assert [j.id for j in s.exec(select(Job)).all()] == [real_job]
        assert [a.job_id for a in s.exec(select(Application)).all()] == [real_job]
        assert not s.exec(select(User).where(User.email.like("%.demo.corelink"))).all()
        assert not s.exec(select(RecruiterUser).where(RecruiterUser.username.like("%.demo.corelink"))).all()
        assert not s.exec(select(CompanyFollow)).all()
        assert len(s.exec(select(CompanyDirectory)).all()) == len(COMPANIES)
        assert len(s.exec(select(CompanyProfile)).all()) == 1
    assert client.get("/api/admin/demo/companies", headers=ah).json()["companies"] == 0
    # deleting again is harmless
    assert client.delete("/api/admin/demo/companies", headers=ah).status_code == 200


def test_demo_endpoints_are_admin_only(client):
    _uid, sh = _student()
    _rid, rh = _recruiter("r@x.example", "X")
    for h in (sh, rh, {}):
        assert client.post("/api/admin/demo/companies", headers=h).status_code in (401, 403)
        assert client.delete("/api/admin/demo/companies", headers=h).status_code in (401, 403)
        assert client.get("/api/admin/demo/companies", headers=h).status_code in (401, 403)


def test_seed_script_writes_csv_outside_repo(tmp_path, monkeypatch):
    import subprocess
    import sys
    script = os.path.join(os.path.dirname(__file__), "..", "scripts", "seed_demo_companies.py")
    env = {**os.environ}
    inside = os.path.join(os.path.dirname(__file__), "logins.csv")
    bad = subprocess.run([sys.executable, script, inside], env=env, capture_output=True, text=True)
    assert bad.returncode != 0 and not os.path.exists(inside)
    out = tmp_path / "logins.csv"
    ok = subprocess.run([sys.executable, script, str(out)], env=env, capture_output=True, text=True)
    assert ok.returncode == 0, ok.stderr
    lines = out.read_text().strip().splitlines()
    assert len(lines) == 21 and lines[0].startswith("company,slug,recruiter_email,password")
    assert oct(out.stat().st_mode & 0o777) == "0o600"
    rm = subprocess.run([sys.executable, script, "--remove"], env=env, capture_output=True, text=True)
    assert rm.returncode == 0
