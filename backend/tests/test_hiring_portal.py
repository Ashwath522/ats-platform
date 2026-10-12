"""Recruiter v2 hiring API (pages 18–22): interviews, offers, company profile,
team, analytics and account settings — auth, ownership, validation, emails."""
import io
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.auth import create_access_token, hash_password, verify_password
from app.db import (
    Application, CandidateProfile, CandidateUser, CompanyProfile, DecisionAuditLog, EmailLog, Job, Offer,
    RecruiterRequest, RecruiterUser, ScheduledInterview, TeamMember, User, engine, utc_now,
)
from app.main import app

BASE = "/api/recruiter/hiring"
PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
       b"\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")


@pytest.fixture
def client():
    return TestClient(app)


def _recruiter(email, password="Recruit@2026", company=None, verdict=None):
    with Session(engine) as s:
        s.add(User(name="Rec " + email.split("@")[0], email=email, role="recruiter", password_hash=hash_password(password), email_verified=True))
        rec = RecruiterUser(username=email, password_hash=hash_password(password))
        s.add(rec)
        if company:
            s.add(RecruiterRequest(name="Rec", email=email, phone="+919800000000", status="approved", company_name=company,
                                   verification_verdict=verdict))
        s.commit()
        s.refresh(rec)
        return rec.id, {"Authorization": f"Bearer {create_access_token(email, role='recruiter')}"}


def _world(rid, n=2, tag="a"):
    """A job owned by recruiter `rid` with `n` shortlisted applications."""
    with Session(engine) as s:
        job = Job(recruiter_id=rid, title=f"Design Engineer {tag}", description="d", branch="mechanical", location_text="Pune, India",
                  job_type="full-time", status="open")
        s.add(job)
        s.commit()
        s.refresh(job)
        app_ids = []
        for i in range(n):
            email = f"cand{tag}{i}@example.com"
            cu = CandidateUser(username=email, password_hash="x")
            s.add(cu)
            s.commit()
            s.refresh(cu)
            s.add(CandidateProfile(candidate_id=cu.id, full_name=f"Cand {tag}{i}", college="NIT Trichy", branch="mechanical", cgpa=8.1,
                                   contact_email=email))
            a = Application(candidate_id=cu.id, job_id=job.id, status="shortlisted", candidate_status="shortlisted", ats_score=80,
                            applied_at=utc_now() - timedelta(days=10))
            s.add(a)
            s.commit()
            s.refresh(a)
            app_ids.append(a.id)
        return job.id, app_ids


def _future(hours=48):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def _emails(category=None):
    with Session(engine) as s:
        q = select(EmailLog)
        if category:
            q = q.where(EmailLog.category == category)
        return s.exec(q).all()


def _iv_body(app_id, **kw):
    b = {"application_id": app_id, "round_name": "Technical Round 1", "starts_at": _future(), "duration_min": 60, "mode": "online",
         "meeting_link": "https://meet.example.com/x", "interviewers": "P. Kumar", "notify": True}
    b.update(kw)
    return b


# ── auth ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("method,path", [
    ("get", "/company"), ("put", "/company"), ("get", "/interviews"), ("post", "/interviews"), ("get", "/interviews/stats"),
    ("get", "/interviews/export.ics"), ("get", "/offers"), ("post", "/offers"), ("get", "/offers/stats"), ("get", "/analytics"),
    ("get", "/account"), ("post", "/account/password"), ("get", "/team"), ("post", "/team"), ("get", "/applications"),
])
def test_requires_recruiter_token(client, method, path):
    assert getattr(client, method)(BASE + path).status_code == 401
    cand = {"Authorization": f"Bearer {create_access_token('someone@example.com', role='candidate')}"}
    assert getattr(client, method)(BASE + path, headers=cand).status_code in (401, 403)


# ── company profile ─────────────────────────────────────────────────────────

def test_company_autocreate_name_sources(client):
    _, h1 = _recruiter("hr@acme-industries.com", company="Acme Industries Pvt Ltd", verdict="verified")
    r = client.get(BASE + "/company", headers=h1)
    assert r.status_code == 200
    d = r.json()
    assert d["name"] == "Acme Industries Pvt Ltd" and d["verified"] is True
    assert d["logo_url"] is None and d["cover_url"] is None and len(d["rounds"]) == 4 and len(d["offer_templates"]) >= 2
    _, h2 = _recruiter("talent@bosch.com")
    d2 = client.get(BASE + "/company", headers=h2).json()
    assert d2["name"] == "Bosch" and d2["verified"] is False
    with Session(engine) as s:
        assert len(s.exec(select(CompanyProfile)).all()) == 2


def test_company_update_validation_and_isolation(client):
    _, h1 = _recruiter("a@one.com")
    _, h2 = _recruiter("b@two.com")
    body = {"tagline": "Engineering for tomorrow", "website": "https://one.com", "industries": ["Automotive", "Automotive", "R&D"],
            "highlights": [{"label": "Employees", "value": "10,001+"}],
            "locations": [{"name": "Pune", "address": "Hinjawadi"}, {"name": "Chennai", "main": True}],
            "preferences": {"campus": "Yes", "rounds": [{"name": "Tech 1", "duration_min": 45}]}}
    d = client.put(BASE + "/company", json=body, headers=h1).json()
    assert d["industries"] == ["Automotive", "R&D"]
    assert [l["main"] for l in d["locations"]] == [False, True]
    assert d["rounds"] == [{"name": "Tech 1", "duration_min": 45, "description": ""}]
    assert d["preferences"]["campus"] == "Yes"
    # preferences merge keeps other keys
    d = client.put(BASE + "/company", json={"preferences": {"experience": "Freshers"}}, headers=h1).json()
    assert d["preferences"]["campus"] == "Yes" and d["preferences"]["experience"] == "Freshers"
    assert client.get(BASE + "/company", headers=h2).json()["tagline"] is None
    for bad in ({"website": "not a url"}, {"founded": "19xx"}, {"name": ""}, {"preferences": {"rounds": [{"name": "x", "duration_min": 5}]}},
                {"highlights": [{"label": "x", "value": "y"}] * 9}):
        assert client.put(BASE + "/company", json=bad, headers=h1).status_code == 422, bad


def test_company_uploads(client):
    _, h = _recruiter("media@one.com")
    r = client.post(BASE + "/company/logo", files={"file": ("logo.png", io.BytesIO(PNG), "image/png")}, headers=h)
    assert r.status_code == 200 and r.json()["logo_url"].startswith("/media/company-logos/")
    r = client.post(BASE + "/company/cover", files={"file": ("c.png", io.BytesIO(PNG), "image/png")}, headers=h)
    assert r.json()["cover_url"].startswith("/media/company-covers/")
    assert client.delete(BASE + "/company/cover", headers=h).json()["cover_url"] is None
    bad = client.post(BASE + "/company/logo", files={"file": ("x.png", io.BytesIO(b"not an image"), "image/png")}, headers=h)
    assert bad.status_code == 400
    for i in range(12):
        assert client.post(BASE + "/company/gallery", files={"file": (f"g{i}.png", io.BytesIO(PNG), "image/png")}, headers=h).status_code == 200
    full = client.post(BASE + "/company/gallery", files={"file": ("g.png", io.BytesIO(PNG), "image/png")}, headers=h)
    assert full.status_code == 400
    path = client.get(BASE + "/company", headers=h).json()["gallery"][0]["path"]
    r = client.delete(BASE + "/company/gallery", params={"path": path}, headers=h)
    assert r.status_code == 200 and len(r.json()["gallery"]) == 11
    assert client.delete(BASE + "/company/gallery", params={"path": path}, headers=h).status_code == 404


# ── team ────────────────────────────────────────────────────────────────────

def test_team_crud_invite_and_ownership(client):
    _, h1 = _recruiter("lead@one.com", company="One Corp")
    _, h2 = _recruiter("lead@two.com")
    r = client.post(BASE + "/team", json={"name": "Priya Nair", "email": "Priya@One.com", "title": "Campus Lead", "access_level": "admin"}, headers=h1)
    assert r.status_code == 201
    m = r.json()
    assert m["email"] == "priya@one.com" and m["status"] == "invited"
    assert len(_emails("team_invitation")) == 1
    assert client.post(BASE + "/team", json={"name": "Dup", "email": "priya@one.com"}, headers=h1).status_code == 409
    assert client.post(BASE + "/team", json={"name": "Bad", "email": "nope"}, headers=h1).status_code == 422
    assert client.post(BASE + "/team", json={"name": "X", "email": "x@one.com", "access_level": "owner"}, headers=h1).status_code == 422
    assert client.patch(f"{BASE}/team/{m['id']}", json={"access_level": "viewer"}, headers=h2).status_code == 404
    assert client.delete(f"{BASE}/team/{m['id']}", headers=h2).status_code == 404
    r = client.patch(f"{BASE}/team/{m['id']}", json={"access_level": "viewer", "status": "inactive"}, headers=h1)
    assert r.json()["access_level"] == "viewer" and r.json()["status"] == "inactive"
    assert client.post(f"{BASE}/team/{m['id']}/resend", headers=h1).status_code == 200
    assert len(_emails("team_invitation")) == 2
    assert client.get(BASE + "/team", headers=h2).json()["items"] == []
    assert client.delete(f"{BASE}/team/{m['id']}", headers=h1).status_code == 200
    assert client.get(BASE + "/team", headers=h1).json()["items"] == []


# ── interviews ──────────────────────────────────────────────────────────────

def test_schedule_interview_contract(client):
    rid, h = _recruiter("iv@one.com")
    _, apps = _world(rid)
    r = client.post(BASE + "/interviews", json=_iv_body(apps[0]), headers=h)
    assert r.status_code == 201, r.text
    iv = r.json()
    assert iv["status"] == "scheduled" and iv["starts_at"].endswith("Z") and iv["candidate_name"] == "Cand a0"
    with Session(engine) as s:
        assert s.get(Application, apps[0]).candidate_status == "interview"
        ev = s.exec(select(DecisionAuditLog).where(DecisionAuditLog.event_type == "human_interview_scheduled")).all()
        assert len(ev) == 1 and ev[0].application_id == apps[0]
    mails = _emails("interview_invite")
    assert len(mails) == 1 and mails[0].to_email == "canda0@example.com"
    # offset-aware time is converted to UTC
    t = (datetime.now(timezone(timedelta(hours=5, minutes=30))) + timedelta(days=5)).replace(microsecond=0)
    r = client.post(BASE + "/interviews", json=_iv_body(apps[1], starts_at=t.isoformat(), notify=False), headers=h)
    assert r.status_code == 201
    assert r.json()["starts_at"] == t.astimezone(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
    assert len(_emails("interview_invite")) == 1  # notify=False


def test_schedule_interview_validation_and_ownership(client):
    rid, h = _recruiter("iv2@one.com")
    _, h_other = _recruiter("iv2@two.com")
    _, apps = _world(rid)
    assert client.post(BASE + "/interviews", json=_iv_body(apps[0]), headers=h_other).status_code == 404
    assert client.post(BASE + "/interviews", json=_iv_body(99999), headers=h).status_code == 404
    past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    assert client.post(BASE + "/interviews", json=_iv_body(apps[0], starts_at=past), headers=h).status_code == 422
    assert client.post(BASE + "/interviews", json=_iv_body(apps[0], duration_min=10), headers=h).status_code == 422
    assert client.post(BASE + "/interviews", json=_iv_body(apps[0], duration_min=300), headers=h).status_code == 422
    assert client.post(BASE + "/interviews", json=_iv_body(apps[0], mode="phone"), headers=h).status_code == 422
    assert client.post(BASE + "/interviews", json=_iv_body(apps[0], starts_at="tomorrow"), headers=h).status_code == 422
    assert client.post(BASE + "/interviews", json=_iv_body(apps[0], meeting_link="javascript:alert(1)"), headers=h).status_code == 422
    start = datetime.now(timezone.utc) + timedelta(days=3)
    assert client.post(BASE + "/interviews", json=_iv_body(apps[0], starts_at=start.isoformat()), headers=h).status_code == 201
    overlap = client.post(BASE + "/interviews", json=_iv_body(apps[0], starts_at=(start + timedelta(minutes=30)).isoformat()), headers=h)
    assert overlap.status_code == 409
    # back-to-back is fine, and a different candidate at the same time is fine
    assert client.post(BASE + "/interviews", json=_iv_body(apps[0], starts_at=(start + timedelta(minutes=60)).isoformat()), headers=h).status_code == 201
    assert client.post(BASE + "/interviews", json=_iv_body(apps[1], starts_at=start.isoformat()), headers=h).status_code == 201


def test_interview_list_get_patch_cancel(client):
    rid, h = _recruiter("iv3@one.com")
    _, h_other = _recruiter("iv3@two.com")
    job_id, apps = _world(rid)
    iv = client.post(BASE + "/interviews", json=_iv_body(apps[0]), headers=h).json()
    iv2 = client.post(BASE + "/interviews", json=_iv_body(apps[1], round_name="HR Round", interviewers="N. Gupta", notify=False), headers=h).json()
    with Session(engine) as s:  # an AI interview completion shows up read-only
        a = s.get(Application, apps[1])
        a.interview_status, a.interview_eval_score = "completed", 77
        s.add(a)
        s.commit()
    items = client.get(BASE + "/interviews", headers=h).json()["items"]
    assert {i["kind"] for i in items} == {"human", "ai"}
    ai = [i for i in items if i["kind"] == "ai"][0]
    assert ai["round_name"] == "AI Interview" and ai["eval_score"] == 77
    assert client.get(BASE + "/interviews", params={"include_ai": "false"}, headers=h).json()["total"] == 2
    assert client.get(BASE + "/interviews", params={"round": "HR Round"}, headers=h).json()["total"] == 1
    assert client.get(BASE + "/interviews", params={"interviewer": "gupta"}, headers=h).json()["total"] == 1
    assert client.get(BASE + "/interviews", params={"q": "cand a0", "include_ai": "false"}, headers=h).json()["total"] == 1
    assert client.get(BASE + "/interviews", params={"job_id": job_id, "status": "scheduled"}, headers=h).json()["total"] == 2
    far = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    assert client.get(BASE + "/interviews", params={"start": far, "include_ai": "false"}, headers=h).json()["total"] == 0
    assert client.get(BASE + "/interviews", headers=h_other).json()["total"] == 0
    assert client.get(f"{BASE}/interviews/{iv['id']}", headers=h_other).status_code == 404
    assert client.patch(f"{BASE}/interviews/{iv['id']}", json={"status": "cancelled"}, headers=h_other).status_code == 404
    d = client.get(f"{BASE}/interviews/{iv['id']}", headers=h).json()
    assert d["application"]["id"] == apps[0] and len(d["rounds"]) == 1

    # reschedule → email
    r = client.patch(f"{BASE}/interviews/{iv['id']}", json={"starts_at": _future(96)}, headers=h)
    assert r.status_code == 200 and len(_emails("interview_reschedule")) == 1
    assert client.patch(f"{BASE}/interviews/{iv['id']}", json={"starts_at": _future(-5)}, headers=h).status_code == 422
    assert client.patch(f"{BASE}/interviews/{iv['id']}", json={"status": "done"}, headers=h).status_code == 422
    # cannot mark a future interview completed without feedback
    assert client.patch(f"{BASE}/interviews/{iv['id']}", json={"status": "completed"}, headers=h).status_code == 422
    # feedback validation then success
    assert client.patch(f"{BASE}/interviews/{iv['id']}", json={"feedback": {"rating": 6, "recommendation": "hire"}}, headers=h).status_code == 422
    assert client.patch(f"{BASE}/interviews/{iv['id']}", json={"feedback": {"rating": 4, "recommendation": "maybe"}}, headers=h).status_code == 422
    r = client.patch(f"{BASE}/interviews/{iv['id']}", json={"feedback": {"rating": 4, "recommendation": "strong_hire", "notes": "Solid"}}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "completed" and r.json()["feedback"]["rating"] == 4
    assert client.delete(f"{BASE}/interviews/{iv['id']}", headers=h).status_code == 409  # completed

    # cancel the other one → email + soft delete
    r = client.delete(f"{BASE}/interviews/{iv2['id']}", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert len(_emails("interview_cancel")) == 1
    assert client.delete(f"{BASE}/interviews/{iv2['id']}", headers=h).status_code == 409
    stats = client.get(BASE + "/interviews/stats", headers=h).json()
    assert stats["analytics"]["cancelled"] == 1 and stats["kpis"]["selected"]["value"] == 1
    assert stats["analytics"]["ai_completed"] == 1


def test_pending_feedback_and_ics(client):
    rid, h = _recruiter("ics@one.com", company="One Corp")
    _, apps = _world(rid)
    up = client.post(BASE + "/interviews", json=_iv_body(apps[0], notify=False), headers=h).json()
    with Session(engine) as s:  # a past interview that was completed without feedback
        a = s.get(Application, apps[1])
        s.add(ScheduledInterview(application_id=a.id, job_id=a.job_id, candidate_id=a.candidate_id, recruiter_id=rid,
                                 starts_at=utc_now() - timedelta(days=1), status="completed"))
        s.commit()
    stats = client.get(BASE + "/interviews/stats", headers=h).json()
    assert stats["kpis"]["pending_feedback"]["value"] == 1
    assert client.get(BASE + "/interviews", params={"status": "pending_feedback"}, headers=h).json()["total"] == 1
    r = client.get(BASE + "/interviews/export.ics", headers=h)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar")
    body = r.text
    assert body.startswith("BEGIN:VCALENDAR\r\n") and body.rstrip().endswith("END:VCALENDAR")
    assert body.count("BEGIN:VEVENT") == 1 and f"UID:interview-{up['id']}@corelink" in body
    assert all(len(line.encode()) <= 75 for line in body.split("\r\n"))


# ── offers ──────────────────────────────────────────────────────────────────

def _offer(client, h, app_id, **kw):
    b = {"application_id": app_id, "ctc": "₹6.5 LPA", "ctc_amount": 6.5, "joining_date": "2027-01-05",
         "letter_text": "Dear Cand, we are pleased to offer you the role.", "send": False}
    b.update(kw)
    return client.post(BASE + "/offers", json=b, headers=h)


def test_offer_lifecycle(client):
    rid, h = _recruiter("of@one.com", company="One Corp")
    _, h_other = _recruiter("of@two.com")
    _, apps = _world(rid, n=3)
    r = _offer(client, h, apps[0])
    assert r.status_code == 201 and r.json()["status"] == "draft"
    oid = r.json()["id"]
    assert _offer(client, h, apps[0]).status_code == 409  # one open offer per application
    assert _offer(client, h_other, apps[1]).status_code == 404
    assert _offer(client, h, apps[1], joining_date="05/01/2027").status_code == 422
    assert _offer(client, h, apps[1], ctc="").status_code == 422
    assert client.get(f"{BASE}/offers/{oid}", headers=h_other).status_code == 404
    assert client.post(f"{BASE}/offers/{oid}/send", headers=h_other).status_code == 404

    r = client.post(f"{BASE}/offers/{oid}/send", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "sent"
    sent = _emails("offer_send")
    assert len(sent) == 1 and sent[0].to_email == "canda0@example.com"
    assert len(_emails("recruiter_offer_update")) == 1  # offer_status notification on by default
    with Session(engine) as s:
        assert s.exec(select(DecisionAuditLog).where(DecisionAuditLog.event_type == "offer_sent")).first()

    r = client.patch(f"{BASE}/offers/{oid}", json={"status": "negotiation", "ctc": "₹7 LPA", "ctc_amount": 7}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "negotiation" and r.json()["ctc"] == "₹7 LPA"
    assert client.post(f"{BASE}/offers/{oid}/joined", headers=h).status_code == 409  # not accepted yet
    with Session(engine) as s:  # the student accepts via their own endpoint
        o = s.get(Offer, oid)
        o.status, o.responded_at = "accepted", utc_now()
        s.add(o)
        s.commit()
    r = client.post(f"{BASE}/offers/{oid}/joined", json={"joining_date": "2027-01-10"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "joined" and r.json()["joining_date"] == "2027-01-10"
    assert client.patch(f"{BASE}/offers/{oid}", json={"ctc": "x"}, headers=h).status_code == 409
    assert client.post(f"{BASE}/offers/{oid}/withdraw", headers=h).status_code == 409
    tl = client.get(f"{BASE}/offers/{oid}", headers=h).json()["timeline"]
    assert [e["label"] for e in tl][:2] == ["Draft created", "Offer sent"] and tl[-1]["label"] == "Marked as joined"

    # create + send in one go, then withdraw with email
    r = _offer(client, h, apps[1], send=True)
    assert r.json()["status"] == "sent"
    oid2 = r.json()["id"]
    r = client.post(f"{BASE}/offers/{oid2}/withdraw", json={"notify": True}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "withdrawn"
    assert len(_emails("offer_withdraw")) == 1
    with Session(engine) as s:
        assert s.exec(select(DecisionAuditLog).where(DecisionAuditLog.event_type == "offer_withdrawn")).first()
    # a withdrawn offer frees the application for a new one; drafts can be deleted, sent ones cannot
    r = _offer(client, h, apps[1], letter_text="")
    assert r.status_code == 201
    assert client.post(f"{BASE}/offers/{r.json()['id']}/send", headers=h).status_code == 422  # empty letter
    assert client.delete(f"{BASE}/offers/{r.json()['id']}", headers=h).status_code == 200
    assert client.delete(f"{BASE}/offers/{oid}", headers=h).status_code == 409

    lst = client.get(BASE + "/offers", headers=h).json()
    assert lst["counts"]["joined"] == 1 and lst["counts"]["withdrawn"] == 1 and lst["total"] == 2
    assert client.get(BASE + "/offers", params={"status": "joined"}, headers=h).json()["total"] == 1
    assert client.get(BASE + "/offers", params={"q": "cand a1"}, headers=h).json()["total"] == 1
    assert client.get(BASE + "/offers", headers=h_other).json()["total"] == 0
    st = client.get(BASE + "/offers/stats", headers=h).json()
    assert st["kpis"]["made"]["value"] == 2 and st["kpis"]["joined"]["value"] == 1
    assert [p["value"] for p in st["pipeline"]][:2] == [3, 3]
    assert st["joining_timeline"][0]["offer_id"] == oid


def test_offer_bulk_and_notification_pref(client):
    rid, h = _recruiter("bulk@one.com")
    _, h_other = _recruiter("bulk@two.com")
    _, apps = _world(rid, n=3)
    ids = [_offer(client, h, a, send=True).json()["id"] for a in apps]
    before = len(_emails("recruiter_offer_update"))
    assert client.put(BASE + "/account/notifications", json={"offer_status": False}, headers=h).json()["notifications"]["offer_status"] is False
    r = client.post(BASE + "/offers/bulk", json={"action": "remind", "ids": ids}, headers=h)
    assert r.json()["ok"] == 3 and len(_emails("offer_remind")) == 3
    other = client.post(BASE + "/offers/bulk", json={"action": "withdraw", "ids": ids}, headers=h_other).json()
    assert other["ok"] == 0 and other["failed"] == 3
    r = client.post(BASE + "/offers/bulk", json={"action": "withdraw", "ids": ids[:2]}, headers=h).json()
    assert r["ok"] == 2
    r = client.post(BASE + "/offers/bulk", json={"action": "joined", "ids": ids}, headers=h).json()
    assert r["ok"] == 0  # none accepted
    assert len(_emails("recruiter_offer_update")) == before  # preference honoured
    assert client.post(BASE + "/offers/bulk", json={"action": "explode", "ids": ids}, headers=h).status_code == 422
    assert client.post(BASE + "/offers/bulk", json={"action": "remind", "ids": []}, headers=h).status_code == 422


def test_applications_picker(client):
    rid, h = _recruiter("pick@one.com")
    _, h_other = _recruiter("pick@two.com")
    job_id, apps = _world(rid, n=2)
    with Session(engine) as s:
        cu = CandidateUser(username="fresh@example.com", password_hash="x")
        s.add(cu)
        s.commit()
        s.refresh(cu)
        s.add(Application(candidate_id=cu.id, job_id=job_id, status="ats_check", candidate_status="applied"))
        s.commit()
    items = client.get(BASE + "/applications", params={"stage": "interview"}, headers=h).json()["items"]
    assert {i["application_id"] for i in items} == set(apps)
    assert len(client.get(BASE + "/applications", params={"stage": "all"}, headers=h).json()["items"]) == 3
    assert client.get(BASE + "/applications", headers=h_other).json()["items"] == []
    _offer(client, h, apps[0])
    offer_items = client.get(BASE + "/applications", params={"stage": "offer"}, headers=h).json()["items"]
    assert [i for i in offer_items if i["application_id"] == apps[0]][0]["has_active_offer"] is True


# ── analytics ───────────────────────────────────────────────────────────────

def test_analytics_blocks(client):
    rid, h = _recruiter("an@one.com")
    _, h_other = _recruiter("an@two.com")
    job_id, apps = _world(rid, n=3)
    oid = _offer(client, h, apps[0], send=True).json()["id"]
    with Session(engine) as s:
        o = s.get(Offer, oid)
        o.status, o.responded_at = "accepted", utc_now()
        s.add(o)
        s.commit()
    today = utc_now().date()
    r = client.get(BASE + "/analytics", params={"start": (today - timedelta(days=60)).isoformat(), "end": today.isoformat(),
                                                "granularity": "week", "group": "branch"}, headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    k = {x["key"]: x for x in d["kpis"]}
    assert k["applications"]["value"] == 3 and k["offers"]["value"] == 1 and k["hired"]["value"] == 1
    assert 9 <= k["time_to_hire"]["value"] <= 11
    assert sum(t["value"] for t in d["trend"]) == 3
    assert d["pipeline"][0]["pct"] == 100 and d["pipeline"][-1]["value"] == 1
    assert d["time_to_hire"][0]["label"] == "Mechanical"
    assert d["branches"] == [{"label": "Mechanical", "value": 3}]
    assert d["colleges"][0] == {"label": "NIT Trichy", "value": 3}
    assert d["offer_acceptance"]["rate"] == 100
    assert d["locations"] == [{"label": "Pune", "value": 3}]
    assert d["sources"] == [{"label": "CoreLink", "value": 3}]
    assert len(d["insights"]) == 3
    assert client.get(BASE + "/analytics", params={"job_id": job_id}, headers=h).status_code == 200
    assert client.get(BASE + "/analytics", params={"job_id": job_id}, headers=h_other).status_code == 404
    assert client.get(BASE + "/analytics", params={"start": "2026-12-01", "end": "2026-01-01"}, headers=h).status_code == 422
    assert client.get(BASE + "/analytics", params={"granularity": "day"}, headers=h).status_code == 422
    assert client.get(BASE + "/analytics", headers=h_other).json()["kpis"][0]["value"] == 0


# ── account ─────────────────────────────────────────────────────────────────

def test_account_profile_and_password(client):
    rid, h = _recruiter("acc@one.com", password="OldPass123")
    d = client.get(BASE + "/account", headers=h).json()
    assert d["email"] == "acc@one.com" and d["notifications"]["new_applications"] is True and d["notifications"]["product_updates"] is False
    r = client.put(BASE + "/account", json={"name": "Rahul Sharma", "phone": "+91 98765 43210", "job_title": "TA Manager",
                                            "department": "Engineering Recruitment", "location": "Bangalore"}, headers=h)
    assert r.status_code == 200 and r.json()["job_title"] == "TA Manager" and r.json()["name"] == "Rahul Sharma"
    assert client.put(BASE + "/account", json={"phone": "call me"}, headers=h).status_code == 422
    with Session(engine) as s:
        u = s.exec(select(User).where(User.email == "acc@one.com")).first()
        assert u.phone == "+91 98765 43210" and json.loads(u.settings_json)["profile"]["department"] == "Engineering Recruitment"
    assert client.post(BASE + "/account/password", json={"current_password": "wrong", "new_password": "NewPass456"}, headers=h).status_code == 400
    assert client.post(BASE + "/account/password", json={"current_password": "OldPass123", "new_password": "short"}, headers=h).status_code == 422
    assert client.post(BASE + "/account/password", json={"current_password": "OldPass123", "new_password": "onlyletters"}, headers=h).status_code == 422
    r = client.post(BASE + "/account/password", json={"current_password": "OldPass123", "new_password": "NewPass456"}, headers=h)
    assert r.status_code == 200
    with Session(engine) as s:
        u = s.exec(select(User).where(User.email == "acc@one.com")).first()
        ru = s.get(RecruiterUser, rid)
        assert verify_password("NewPass456", u.password_hash) and verify_password("NewPass456", ru.password_hash)
    login = client.post("/api/auth/login", data={"email": "acc@one.com", "password": "NewPass456"})
    assert login.status_code == 200
    n = client.put(BASE + "/account/notifications", json={"weekly_report": False, "product_updates": True}, headers=h).json()["notifications"]
    assert n["weekly_report"] is False and n["product_updates"] is True and n["new_applications"] is True
    assert client.get(BASE + "/account", headers=h).json()["notifications"]["weekly_report"] is False
