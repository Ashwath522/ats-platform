"""Live jobs & resources: providers (against saved real / doc-shaped fixtures),
classifier, dedupe, expiry, endpoints and the student merge.

No network: every provider call goes through an httpx.MockTransport."""
import copy
import io
import json
import os
from datetime import timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.auth import create_access_token, hash_password
from app.db import (
    CandidateProfile, CandidateUser, ExternalApplicationLog, ExternalJob, Job, LiveResource, RecruiterUser, SyncRun, User,
    engine, utc_now,
)
from app.main import app
from app.services import live_sync, llm_stream
from app.services.live_sources import PROVIDERS
from app.services.live_sources import adzuna, arxiv, greenhouse, jooble, lever, smartrecruiters, youtube
from app.services.live_sources.base import clean_html, https_on_domain

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


def _load(*parts):
    path = os.path.join(FIX, *parts)
    with open(path, encoding="utf-8") as fh:
        return fh.read() if path.endswith(".xml") else json.load(fh)


def _iso(days_ago: float) -> str:
    return (utc_now() - timedelta(days=days_ago)).replace(microsecond=0).isoformat() + "Z"


# ── a fake internet ──────────────────────────────────────────────────────────

class FakeNet:
    """Routes provider URLs to fixture payloads. Mutate .sr_list / .fail to
    simulate postings disappearing or a source going down."""

    def __init__(self):
        lst = _load("live_jobs", "smartrecruiters_list.json")
        for i, item in enumerate(lst["content"]):
            item["releasedDate"] = _iso(1 + i * 0.1)          # keep fixtures inside the 45-day window
        self.sr_list = lst["content"]
        self.sr_detail = _load("live_jobs", "smartrecruiters_detail.json")
        self.fail = set()
        self.calls = []
        self.detail_calls = 0

    def detail_for(self, pid):
        item = next((c for c in self.sr_list if c["id"] == pid), None)
        if item is None:
            return None
        d = copy.deepcopy(self.sr_detail)
        d.update({k: item[k] for k in ("id", "name", "company", "location", "releasedDate", "experienceLevel", "typeOfEmployment")})
        slug = item["company"]["identifier"]
        d["postingUrl"] = f"https://jobs.smartrecruiters.com/{slug}/{pid}-x"
        d["applyUrl"] = f"https://jobs.smartrecruiters.com/{slug}/{pid}-x?oga=true"
        if item["name"] == "Product Engineer":
            d["jobAd"]["sections"]["jobDescription"]["text"] = "<p>Design brake components in <b>CATIA</b>, apply GD&amp;T, run FEA and DFMEA.</p>"
        if item["name"] == "Hardware Technical specialist":
            d["jobAd"]["sections"]["jobDescription"]["text"] = "<ul><li>PCB Design and Embedded Systems bring-up</li><li>Analog Circuit Design</li></ul>"
        return d

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.calls.append(url)
        host = request.url.host
        if host in self.fail:
            return httpx.Response(500, json={"error": "down"})
        if host == "api.smartrecruiters.com":
            parts = request.url.path.strip("/").split("/")   # v1 companies {id} postings [pid]
            cid = parts[2]
            if len(parts) == 4:
                items = [c for c in self.sr_list if c["company"]["identifier"] == cid]
                off = int(request.url.params.get("offset", 0))
                return httpx.Response(200, json={"offset": off, "limit": 100, "totalFound": len(items), "content": items[off:off + 100]})
            self.detail_calls += 1
            d = self.detail_for(parts[4])
            return httpx.Response(200, json=d) if d else httpx.Response(404, json={"message": "not found"})
        if host == "api.adzuna.com":
            data = _load("live_jobs", "adzuna_search.json")
            for r in data["results"]:
                r["created"] = _iso(2)
            return httpx.Response(200, json=data)
        if host == "jooble.org":
            data = _load("live_jobs", "jooble_search.json")
            for r in data["jobs"]:
                r["updated"] = (utc_now() - timedelta(days=1)).strftime("%Y-%m-%dT00:00:00.0000000")
            return httpx.Response(200, json=data)
        if host == "boards-api.greenhouse.io":
            return httpx.Response(200, json=_load("live_jobs", "greenhouse_jobs.json"))
        if host == "api.lever.co":
            return httpx.Response(200, json=_load("live_jobs", "lever_postings.json"))
        if host == "export.arxiv.org":
            return httpx.Response(200, text=_load("live_resources", "arxiv_feed.xml"), headers={"content-type": "application/atom+xml"})
        if host == "www.googleapis.com":
            return httpx.Response(200, json=_load("live_resources", "youtube_search.json"))
        return httpx.Response(404)


@pytest.fixture
def net(monkeypatch):
    fake = FakeNet()
    monkeypatch.setattr(live_sync, "TRANSPORT", httpx.MockTransport(fake))
    monkeypatch.setattr(PROVIDERS["arxiv"], "delay", 0)
    for k in ("ADZUNA_APP_ID", "ADZUNA_APP_KEY", "JOOBLE_API_KEY", "YOUTUBE_API_KEY", "LIVE_SYNC_TOKEN"):
        monkeypatch.delenv(k, raising=False)
    return fake


@pytest.fixture
def client(monkeypatch, net):
    monkeypatch.setattr(llm_stream, "configured_providers", lambda: [])
    with TestClient(app) as c:
        yield c


def H(email, role):
    return {"Authorization": f"Bearer {create_access_token(username=email, role=role)}"}


def _admin():
    with Session(engine) as s:
        s.add(User(name="Ada", email="admin@corelink.test", role="admin", password_hash=hash_password("AdminPass123!"), email_verified=True))
        s.commit()
    return H("admin@corelink.test", "admin")


def _student(email="stu@example.com", branch="ece", skills=("PCB Design", "Embedded Systems")):
    with Session(engine) as s:
        u = CandidateUser(username=email, password_hash="x")
        s.add(u)
        s.commit()
        s.refresh(u)
        s.add(CandidateProfile(candidate_id=u.id, branch=branch, skills_json=json.dumps(list(skills)), full_name="Priya",
                               location_text="Bengaluru, Karnataka"))
        s.commit()
        return u.id


def _sync(*names, kind="jobs"):
    return live_sync.run_sync_blocking(kind, "test", list(names) if names else None)


def _jobs(source=None, status=None):
    with Session(engine) as s:
        stmt = select(ExternalJob)
        if source:
            stmt = stmt.where(ExternalJob.source == source)
        if status:
            stmt = stmt.where(ExternalJob.status == status)
        return s.exec(stmt).all()


# ── providers parse real / documented shapes ─────────────────────────────────

def test_smartrecruiters_parses_real_fixtures():
    lst = _load("live_jobs", "smartrecruiters_list.json")
    jobs = [smartrecruiters.parse_posting(c, c["company"]["identifier"]) for c in lst["content"]]
    hw = next(j for j in jobs if j.external_id == "744000155165798")
    assert hw.company_name == "Bosch Group" and hw.city == "Bengaluru" and hw.location_text == "Bengaluru, India"
    assert hw.experience_level == "0-2" and hw.job_type == "full-time" and hw.remote_type == "onsite"
    assert hw.posted_at.year == 2026 and not hw.has_detail
    assert hw.detail_ref.startswith("https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/")
    d = smartrecruiters.apply_detail(jobs[0], _load("live_jobs", "smartrecruiters_detail.json"))
    assert d.apply_url == "https://jobs.smartrecruiters.com/Wabtec/3743990016074616-advance-lead-engineer-test-automation?oga=true"
    assert d.posting_url.startswith("https://jobs.smartrecruiters.com/Wabtec/")
    assert "Wabtec Corporation is a leading global provider" in d.description_text and "<p>" not in d.description_text
    assert "BE/BTech" in d.description_text and d.has_detail and d.active


def test_doc_shaped_providers_parse():
    a = [adzuna.parse_result(r, "mechanical") for r in _load("live_jobs", "adzuna_search.json")["results"]]
    assert a[0].title == "Mechanical Design Engineer - Gearbox"           # <strong> highlight stripped
    assert a[0].apply_url.startswith("https://www.adzuna.in/land/ad/4891234567")
    assert a[0].city == "Pune" and a[0].salary_min == 450000 and a[0].job_type == "full-time"
    assert a[2].salary_min is None                                       # predicted salary is not shown
    j = [jooble.parse_job(r, "ece") for r in _load("live_jobs", "jooble_search.json")["jobs"]]
    assert j[0].external_id == "-5212345678901234567" and j[0].salary_min == 600000 and j[0].salary_max == 900000
    assert "embedded C firmware" in j[0].description_text and j[0].posted_at is not None
    assert j[2] is None                                                  # link not on jooble.org → dropped
    g = [greenhouse.parse_job(r, "exampleaero") for r in _load("live_jobs", "greenhouse_jobs.json")["jobs"]]
    assert g[1] is None and g[0].external_id == "exampleaero:4012345"     # Seattle job filtered out
    assert "aircraft structures" in g[0].description_text and "&lt;" not in g[0].description_text
    l = [lever.parse_posting(r, "examplemotors") for r in _load("live_jobs", "lever_postings.json")]
    assert l[1] is None and l[0].job_type == "internship" and l[0].apply_url.endswith("/apply")
    assert "MATLAB/Simulink" in l[0].description_text
    papers = arxiv.parse_feed(_load("live_resources", "arxiv_feed.xml"), "mechanical")
    assert papers[0].url == "https://arxiv.org/abs/2610.01234v1" and papers[0].title.startswith("Topology Optimisation of Additively")
    assert papers[0].author == "A. Kumar, B. Rao" and papers[0].kind == "paper"
    vids = youtube.parse_search(_load("live_resources", "youtube_search.json"), "mechanical")
    assert len(vids) == 1 and vids[0].title == "Machine Design L12: Shafts & Keys"
    assert vids[0].url == "https://www.youtube.com/watch?v=dQw4w9WgXcA" and vids[0].thumbnail_url.startswith("https://i.ytimg.com/")


def test_url_and_html_hygiene():
    assert https_on_domain("http://jobs.smartrecruiters.com/x", ["smartrecruiters.com"]) == "https://jobs.smartrecruiters.com/x"
    assert https_on_domain("https://evil-smartrecruiters.com/x", ["smartrecruiters.com"]) is None
    assert https_on_domain("https://smartrecruiters.com.evil.io/x", ["smartrecruiters.com"]) is None
    assert https_on_domain("javascript:alert(1)", ["smartrecruiters.com"]) is None
    assert https_on_domain("https://user:pw@jobs.lever.co/x", ["lever.co"]) is None
    txt = clean_html("<p>Hello&nbsp;<b>world</b></p><script>x()</script><ul><li>One</li><li>Two</li></ul>" + "a" * 9000)
    assert txt.startswith("Hello world") and "• One" in txt and "x()" not in txt and len(txt) <= 8000


# ── classifier ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("title,desc,expected", [
    ("Hardware Technical specialist", "", "ece"),
    ("Mechanical Design Engineer - Gearbox", "SolidWorks ANSYS", "mechanical"),
    ("Graduate Engineer Trainee - Civil", "site supervision", "civil"),
    ("Electrical Engineer - Substation", "switchgear relay", "eee"),
    ("Embedded Software Engineer - AUTOSAR", "", "automobile"),
    ("Process Engineer", "Aspen Plus HYSYS distillation", "chemical"),
    ("Metallurgist", "heat treatment", "metallurgy"),
    ("Aerospace Structures Engineer", "", "aerospace"),
    ("Specialist, HR Operations", "", None),
    ("Talent Acquisition Partner", "engineering hiring", None),
    ("Finance Manager", "", None),
    ("Sales Engineer - Pumps", "", None),
    ("Marketing Executive", "", None),
    ("Legal Counsel", "", None),
    ("Senior Java Developer", "", None),
    ("Data Scientist", "Python, ML", None),
    ("Advance Lead Engineer - Test Automation", "", None),
    ("Diploma Trainee", "", None),
])
def test_classifier_keeps_core_and_drops_non_core(title, desc, expected):
    branch, _skills, _why = live_sync.classify(title, desc)
    assert branch == expected


def test_classifier_drops_software_description_without_core_title():
    desc = "Build React and Node.js microservices on AWS with Docker, Kubernetes, PostgreSQL and Redis."
    assert live_sync.classify("Associate Engineer", desc)[0] is None


# ── sync behaviour ───────────────────────────────────────────────────────────

def test_smartrecruiters_sync_keeps_only_core_jobs_with_official_links(net):
    out = _sync("smartrecruiters")
    sr = next(s for s in out["sources"] if s["source"] == "smartrecruiters")
    assert sr["status"] == "ok" and sr["fetched"] == 5
    rows = {j.title: j for j in _jobs("smartrecruiters")}
    assert set(rows) == {"Hardware Technical specialist", "Product Engineer"}
    hw = rows["Hardware Technical specialist"]
    assert hw.branch == "ece" and hw.status == "active" and hw.apply_url.startswith("https://jobs.smartrecruiters.com/BoschGroup/")
    assert "PCB Design" in json.loads(hw.skills_json) and "Analog Circuit Design" in hw.description_text
    assert rows["Product Engineer"].branch in {"mechanical", "automobile"}
    first_details = net.detail_calls
    with Session(engine) as s:
        run = s.exec(select(SyncRun).where(SyncRun.source == "smartrecruiters")).first()
        assert run.status == "ok" and run.added == 2 and run.finished_at
    # second run: unchanged postings → no detail calls
    _sync("smartrecruiters")
    assert net.detail_calls == first_details
    assert len(_jobs("smartrecruiters", "active")) == 2


def test_expiry_after_two_missed_successful_syncs(net):
    _sync("smartrecruiters")
    net.sr_list = [c for c in net.sr_list if c["name"] != "Product Engineer"]
    net.fail.add("api.smartrecruiters.com")
    _sync("smartrecruiters")                                  # failed sync: no miss counted
    pe = next(j for j in _jobs("smartrecruiters") if j.title == "Product Engineer")
    assert pe.miss_count == 0 and pe.status == "active"
    net.fail.clear()
    _sync("smartrecruiters")
    pe = next(j for j in _jobs("smartrecruiters") if j.title == "Product Engineer")
    assert pe.miss_count == 1 and pe.status == "active"
    _sync("smartrecruiters")
    pe = next(j for j in _jobs("smartrecruiters") if j.title == "Product Engineer")
    assert pe.status == "expired"
    hw = next(j for j in _jobs("smartrecruiters") if j.title == "Hardware Technical specialist")
    assert hw.status == "active" and hw.miss_count == 0


def test_inactive_detail_expires_and_too_old_is_hidden(net):
    net.sr_list[4]["releasedDate"] = _iso(60)               # Bosch hardware job → 60 days old
    _sync("smartrecruiters")
    assert [j.title for j in _jobs("smartrecruiters")] == ["Product Engineer"]
    # provider reports the posting inactive → expired immediately
    orig = net.detail_for

    def inactive(pid):
        d = orig(pid)
        if d:
            d["active"] = False
        return d
    net.detail_for = inactive
    net.sr_list[2]["releasedDate"] = _iso(0.5)             # changed version → detail re-fetched
    _sync("smartrecruiters")
    assert _jobs("smartrecruiters")[0].status == "expired"
    # existing active row that ages past 45 days is hidden by cleanup
    with Session(engine) as s:
        s.add(ExternalJob(source="adzuna", external_id="old", title="Electrical Engineer", company_name="X", branch="eee",
                          apply_url="https://www.adzuna.in/land/ad/old", posted_at=utc_now() - timedelta(days=50)))
        s.commit()
    live_sync.cleanup_jobs()
    assert _jobs("adzuna")[0].status == "expired"


def test_dedupe_by_source_id_and_company_title_city(net, monkeypatch):
    monkeypatch.setenv("ADZUNA_APP_ID", "id")
    monkeypatch.setenv("ADZUNA_APP_KEY", "key")
    _sync("adzuna")
    # 8 queries return the same 3 results → stored once each; HR dropped
    rows = _jobs("adzuna")
    assert sorted(j.title for j in rows) == ["Graduate Engineer Trainee - Civil", "Mechanical Design Engineer - Gearbox"]
    civil = next(j for j in rows if "Civil" in j.title)
    assert civil.salary_min is None and civil.branch == "civil"
    # The same job published on an official board wins over the aggregator copy
    with Session(engine) as s:
        s.add(ExternalJob(source="smartrecruiters", external_id="sr-1", title="Mechanical Design Engineer - Gearbox",
                          company_name="Precision Drives Private Limited", city="Pune", branch="mechanical",
                          apply_url="https://jobs.smartrecruiters.com/x", posted_at=utc_now(),
                          dedupe_key=live_sync.dedupe_key("Precision Drives Private Limited", "Mechanical Design Engineer - Gearbox", "Pune")))
        s.commit()
    _sync("adzuna")
    mech = next(j for j in _jobs("adzuna") if "Mechanical" in j.title)
    assert mech.status == "expired"
    assert live_sync.dedupe_key("Bosch Group", "Hardware  Specialist", "Bengaluru") == live_sync.dedupe_key("BOSCH", "hardware specialist", "bangalore")


def test_missing_keys_are_skipped_and_one_failure_does_not_break_others(net):
    net.fail.add("boards-api.greenhouse.io")
    live_sync.save_settings({"greenhouse_boards": ["exampleaero"], "lever_boards": ["examplemotors"]})
    out = _sync()
    by = {s["source"]: s for s in out["sources"]}
    assert by["adzuna"]["status"] == "skipped" and "ADZUNA_APP_ID" in by["adzuna"]["error"]
    assert by["jooble"]["status"] == "skipped"
    assert by["greenhouse"]["status"] == "error"
    assert by["smartrecruiters"]["status"] == "ok" and by["lever"]["status"] == "ok"
    lv = _jobs("lever")
    assert len(lv) == 1 and lv[0].branch == "automobile" and lv[0].job_type == "internship"


def test_jooble_keeps_core_and_valid_links(net, monkeypatch):
    monkeypatch.setenv("JOOBLE_API_KEY", "k")
    out = _sync("jooble")
    assert out["sources"][0]["status"] == "ok"
    rows = _jobs("jooble")
    assert [j.title for j in rows] == ["Embedded Firmware Engineer (ARM Cortex)"]
    assert rows[0].branch == "ece" and rows[0].apply_url.startswith("https://jooble.org/desc/")
    assert not any("k?" in (r.error or "") for r in Session(engine).exec(select(SyncRun)).all())


def test_resources_sync_arxiv_and_youtube(net, monkeypatch):
    out = _sync(kind="resources")
    by = {s["source"]: s for s in out["sources"]}
    assert by["arxiv"]["status"] == "ok" and by["youtube"]["status"] == "skipped"
    monkeypatch.setenv("YOUTUBE_API_KEY", "yt")
    _sync(kind="resources")
    with Session(engine) as s:
        res = s.exec(select(LiveResource)).all()
    # same fixture for every branch query: unique per (source, url), first branch wins
    assert {r.source for r in res} == {"arxiv", "youtube"}
    assert len([r for r in res if r.source == "arxiv"]) == 2 and len([r for r in res if r.source == "youtube"]) == 1
    assert all(r.url.startswith("https://") for r in res)


# ── endpoints ────────────────────────────────────────────────────────────────

def test_internal_endpoint_token_auth(client, monkeypatch):
    r = client.post("/api/internal/live-sync", json={"kind": "jobs"}, headers={"X-Sync-Token": "x"})
    assert r.status_code == 503
    monkeypatch.setenv("LIVE_SYNC_TOKEN", "s3cret-token")
    assert client.post("/api/internal/live-sync", json={"kind": "jobs"}).status_code == 403
    assert client.post("/api/internal/live-sync", json={"kind": "jobs"}, headers={"X-Sync-Token": "wrong"}).status_code == 403
    r = client.post("/api/internal/live-sync", json={"kind": "jobs"}, headers={"X-Sync-Token": "s3cret-token"})
    assert r.status_code == 202 and r.json()["started"] is True
    states = {s["source"]: s["state"] for s in r.json()["sources"]}
    assert states["smartrecruiters"] == "queued" and states["adzuna"] == "not configured"
    # background task ran inside the TestClient request
    assert len(_jobs("smartrecruiters", "active")) == 2
    assert client.post("/api/internal/live-sync", json={"kind": "nope"}, headers={"X-Sync-Token": "s3cret-token"}).status_code == 422


def test_admin_sync_status_settings_and_test_company(client, monkeypatch):
    adm = _admin()
    stu = H("stu@example.com", "candidate")
    _student()
    assert client.get("/api/admin/live-sync/status", headers=stu).status_code in (401, 403)
    monkeypatch.setenv("ADZUNA_APP_KEY", "super-secret-adzuna-key")
    r = client.post("/api/admin/live-sync", json={"kind": "all"}, headers=adm)
    assert r.status_code == 202 and r.json()["started"]
    st = client.get("/api/admin/live-sync/status", headers=adm)
    assert st.status_code == 200 and "super-secret-adzuna-key" not in st.text
    body = st.json()
    assert body["keys"]["ADZUNA_APP_KEY"] is True and body["keys"]["ADZUNA_APP_ID"] is False
    sr = next(s for s in body["sources"] if s["source"] == "smartrecruiters")
    assert sr["configured"] and sr["active"] == 2 and sr["last_run"]["status"] == "ok"
    az = next(s for s in body["sources"] if s["source"] == "adzuna")
    assert az["configured"] is False and az["keys"] == {"ADZUNA_APP_ID": False, "ADZUNA_APP_KEY": True}
    assert body["totals"]["active_jobs"] == 2 and len(body["runs"]) >= 7
    # settings persist in the DB
    r = client.put("/api/admin/live-sync/settings", json={"smartrecruiters_companies": ["BoschGroup", "Wabtec", "bad id!"]}, headers=adm)
    assert r.status_code == 422
    r = client.put("/api/admin/live-sync/settings", json={"smartrecruiters_companies": ["BoschGroup"], "enabled": {"jooble": False}}, headers=adm)
    assert r.status_code == 200 and r.json()["settings"]["smartrecruiters_companies"] == ["BoschGroup"]
    g = client.get("/api/admin/live-sync/settings", headers=adm).json()["settings"]
    assert g["enabled"]["jooble"] is False and g["enabled"]["adzuna"] is True
    t = client.post("/api/admin/live-sync/test-company", json={"provider": "smartrecruiters", "id": "Wabtec"}, headers=adm).json()
    assert t["ok"] and t["count"] == 4 and "Product Engineer" in t["sample"]
    t = client.post("/api/admin/live-sync/test-company", json={"provider": "smartrecruiters", "id": "Nobody"}, headers=adm).json()
    assert t["ok"] and t["count"] == 0
    assert client.post("/api/admin/live-sync/test-company", json={"provider": "adzuna", "id": "x"}, headers=adm).status_code == 422
    # admin can hide a listing
    jid = _jobs("smartrecruiters")[0].id
    assert client.patch(f"/api/admin/live-sync/jobs/{jid}", json={"status": "hidden"}, headers=adm).json()["status"] == "hidden"
    assert client.get("/api/admin/live-sync/jobs?status=hidden", headers=adm).json()["total"] == 1


def test_student_opportunities_merge_track_and_saved(client):
    stu = H("stu@example.com", "candidate")
    _student()
    with Session(engine) as s:
        rec = RecruiterUser(username="rec@corp.com", password_hash="x")
        s.add(rec)
        s.commit()
        s.refresh(rec)
        s.add(Job(recruiter_id=rec.id, title="PCB Design Intern", description="PCB", requirements="PCB Design, Altium Designer",
                  branch="ece", location_text="Bengaluru, India", job_type="internship"))
        s.commit()
    _sync("smartrecruiters")
    r = client.get("/api/student/opportunities", headers=stu).json()
    assert r["total"] == 3 and r["origin_counts"] == {"corelink": 1, "live": 2}
    ext = next(i for i in r["items"] if i["external"] and i["title"] == "Hardware Technical specialist")
    assert ext["id"].startswith("ext-") and ext["apply_url"].startswith("https://jobs.smartrecruiters.com/")
    assert ext["source_label"] == "Bosch Group careers · SmartRecruiters" and ext["company_logo"] is None
    assert ext["posted_at"].endswith("Z") and ext["last_checked_at"].endswith("Z") and ext["branch"] == "ece"
    assert ext["match"] > 0
    internal = next(i for i in r["items"] if not i["external"])
    assert isinstance(internal["id"], int)
    # same filters apply to live jobs
    assert client.get("/api/student/opportunities?branch=ece&origin=live", headers=stu).json()["total"] == 1
    assert client.get("/api/student/opportunities?q=hardware", headers=stu).json()["total"] == 1
    assert client.get("/api/student/opportunities?type=internship", headers=stu).json()["total"] == 1
    assert client.get("/api/student/opportunities?origin=corelink", headers=stu).json()["total"] == 1
    assert client.get("/api/student/opportunities?location=Bangalore&origin=live", headers=stu).json()["total"] >= 1
    # detail
    eid = ext["external_job_id"]
    d = client.get(f"/api/student/external-jobs/{eid}", headers=stu).json()
    assert "Analog Circuit Design" in d["description"] and d["skills_have"] and d["expired"] is False
    # track click + applied
    assert client.post(f"/api/student/external-jobs/{eid}/track", json={"action": "clicked"}, headers=stu).json()["applied"] is False
    a = client.post(f"/api/student/external-jobs/{eid}/track", json={"action": "applied"}, headers=stu).json()
    assert a["applied"] and a["applied_at"]
    client.post(f"/api/student/external-jobs/{eid}/track", json={"action": "applied"}, headers=stu)
    assert client.post(f"/api/student/external-jobs/{eid}/track", json={"action": "bogus"}, headers=stu).status_code == 422
    with Session(engine) as s:
        logs = s.exec(select(ExternalApplicationLog)).all()
        assert sorted(l.action for l in logs) == ["applied", "clicked"]
    ov = client.get("/api/student/applications/overview", headers=stu).json()
    assert len(ov["external"]) == 1 and ov["external"][0]["role"] == "Hardware Technical specialist"
    assert ov["external"][0]["clicks"] == 1 and ov["external"][0]["listing_status"] == "open"
    assert client.get("/api/student/opportunities?origin=live", headers=stu).json()["items"][0]["applied"] in (True, False)
    # saved jobs support external jobs
    assert client.post("/api/student/saved-jobs", json={"job_id": f"ext-{eid}"}, headers=stu).status_code == 201
    saved = client.get("/api/student/saved-jobs", headers=stu).json()["items"]
    assert saved[0]["job_id"] == f"ext-{eid}" and saved[0]["external"] is True
    assert client.get("/api/student/opportunities?saved_only=true", headers=stu).json()["total"] == 1
    assert client.delete(f"/api/student/saved-jobs/ext-{eid}", headers=stu).json()["saved"] is False
    assert client.get("/api/student/saved-jobs", headers=stu).json()["total"] == 0
    assert client.post("/api/student/saved-jobs", json={"job_id": "ext-99999"}, headers=stu).status_code == 404
    # expired listings disappear from the list; detail keeps the record for the applicant, without a link
    with Session(engine) as s:
        e = s.get(ExternalJob, eid)
        e.status = "expired"
        s.add(e)
        s.commit()
    assert client.get("/api/student/opportunities?origin=live", headers=stu).json()["total"] == 1
    d = client.get(f"/api/student/external-jobs/{eid}", headers=stu).json()
    assert d["expired"] is True and d["apply_url"] is None
    assert client.get("/api/student/applications/overview", headers=stu).json()["external"][0]["apply_url"] is None
    other = H("other@example.com", "candidate")
    _student("other@example.com")
    assert client.get(f"/api/student/external-jobs/{eid}", headers=other).status_code == 404
    assert client.post(f"/api/student/external-jobs/{eid}/track", json={"action": "clicked"}, headers=other).status_code == 404


def test_live_resources_student_and_admin_crud(client):
    adm = _admin()
    stu = H("stu@example.com", "candidate")
    _student(branch="mechanical")
    _sync(kind="resources")
    r = client.get("/api/student/live-resources", headers=stu).json()
    assert r["branch"] == "mechanical" and r["items"] and r["items"][0]["source"] == "arxiv"
    # admin link
    bad = client.post("/api/admin/live-resources", json={"branch": "mechanical", "kind": "article", "title": "GD&T primer", "url": "http://x.com"}, headers=adm)
    assert bad.status_code == 422
    assert client.post("/api/admin/live-resources", json={"branch": "software", "kind": "article", "title": "GD&T primer", "url": "https://x.com/a"}, headers=adm).status_code == 422
    link = client.post("/api/admin/live-resources", json={"branch": "mechanical", "kind": "article", "title": "GD&T primer", "url": "https://example.com/gdt"}, headers=adm)
    assert link.status_code == 201
    # PDF upload
    pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
    up = client.post("/api/admin/live-resources/upload", data={"branch": "mechanical", "kind": "notes", "title": "Unit 3 notes"},
                     files={"file": ("unit3.pdf", io.BytesIO(pdf), "application/pdf")}, headers=adm)
    assert up.status_code == 201 and up.json()["file_url"].startswith("/media/resources/")
    assert client.get(up.json()["file_url"]).content.startswith(b"%PDF-")
    fake = client.post("/api/admin/live-resources/upload", data={"branch": "mechanical", "kind": "notes", "title": "Fake"},
                       files={"file": ("x.pdf", io.BytesIO(b"MZ not a pdf"), "application/pdf")}, headers=adm)
    assert fake.status_code == 400
    big = client.post("/api/admin/live-resources/upload", data={"branch": "mechanical", "kind": "notes", "title": "Big"},
                      files={"file": ("big.pdf", io.BytesIO(b"%PDF-" + b"0" * (10 * 1024 * 1024)), "application/pdf")}, headers=adm)
    assert big.status_code == 400
    assert client.post("/api/admin/live-resources/upload", data={"branch": "mechanical", "kind": "notes", "title": "Doc"},
                       files={"file": ("x.docx", io.BytesIO(b"PK"), "application/octet-stream")}, headers=adm).status_code == 400
    r = client.get("/api/student/live-resources?kind=notes", headers=stu).json()
    assert [i["title"] for i in r["items"]] == ["Unit 3 notes"] and r["items"][0]["created_by"] is None
    rid = up.json()["id"]
    assert client.patch(f"/api/admin/live-resources/{rid}", json={"status": "hidden"}, headers=adm).json()["status"] == "hidden"
    assert client.get("/api/student/live-resources?kind=notes", headers=stu).json()["items"] == []
    assert client.get("/api/admin/live-resources?source=admin", headers=adm).json()["total"] == 2
    assert client.delete(f"/api/admin/live-resources/{rid}", headers=adm).json()["deleted"]
    assert client.get(up.json()["file_url"]).status_code == 404
    assert client.get("/api/admin/live-resources", headers=stu).status_code in (401, 403)
    q = client.get("/api/student/live-resources?q=welded&branch=all", headers=stu).json()
    assert len(q["items"]) == 1 and "Welded" in q["items"][0]["title"]


def test_restart_clears_stuck_running_run():
    from app.db import SyncRun, engine
    from app.services import live_sync
    from sqlmodel import Session
    with Session(engine) as s:
        s.add(SyncRun(kind="jobs", source="smartrecruiters", status="running"))
        s.commit()
    assert live_sync.is_running()
    assert live_sync.mark_interrupted_runs() >= 1
    assert not live_sync.is_running()


def test_arxiv_retries_after_rate_limit(monkeypatch):
    import asyncio
    import httpx
    from app.services.live_sources.arxiv import Arxiv
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, text="slow down")
        return httpx.Response(200, text=_load("live_resources", "arxiv_feed.xml"))

    p = Arxiv()
    p.delay = 0
    monkeypatch.setattr("app.services.live_sources.arxiv.TOPICS", {"mechanical": "abs:test"})

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await p.fetch(c, {})
    res = asyncio.run(go())
    assert res.items and not res.errors and calls["n"] == 2
