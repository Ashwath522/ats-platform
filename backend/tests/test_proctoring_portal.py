"""Proctoring evidence: snapshot/event upload (candidate) + reviewer access + retention."""
import io
import datetime

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlmodel import Session, select

from app.api import proctoring
from app.auth import create_access_token
from app.db import (Application, CandidateUser, InterviewSession, Job, ProctorEvent, ProctorSnapshot,
                    RecruiterUser, User, engine, utc_now)
from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def _jpeg(w=320, h=240, quality=60) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (120, 90, 60)).save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (1, 2, 3)).save(buf, format="PNG")
    return buf.getvalue()


def _setup(mode="application", status="active"):
    with Session(engine) as s:
        for email, role in (("own_rec@ex.com", "recruiter"), ("other_rec@ex.com", "recruiter"), ("admin_p@ex.com", "admin"),
                            ("cand_p@ex.com", "candidate"), ("cand_other@ex.com", "candidate")):
            s.add(User(email=email, name=email.split("@")[0], role=role, password_hash="x", email_verified=True))
        own = RecruiterUser(username="own_rec@ex.com", password_hash="x")
        other = RecruiterUser(username="other_rec@ex.com", password_hash="x")
        cand = CandidateUser(username="cand_p@ex.com", password_hash="x")
        cand2 = CandidateUser(username="cand_other@ex.com", password_hash="x")
        s.add_all([own, other, cand, cand2])
        s.commit()
        for x in (own, other, cand, cand2):
            s.refresh(x)
        job = Job(recruiter_id=own.id, title="Design Engineer", description="CAD")
        s.add(job)
        s.commit()
        s.refresh(job)
        appl = Application(candidate_id=cand.id, job_id=job.id, status="shortlisted", interview_status="in_progress")
        s.add(appl)
        s.commit()
        s.refresh(appl)
        iv = InterviewSession(application_id=None if mode == "practice" else appl.id, candidate_id=cand.id,
                              job_id=None if mode == "practice" else job.id, mode=mode, status=status)
        s.add(iv)
        s.commit()
        s.refresh(iv)
        return {"sid": iv.id, "app_id": appl.id, "job_id": job.id}


def _h(email, role):
    return {"Authorization": f"Bearer {create_access_token(username=email, role=role)}"}


CAND = ("cand_p@ex.com", "candidate")


def _upload(client, sid, data=None, event_type="tab_switched", severity="medium", who=CAND, ctype="image/jpeg"):
    return client.post(f"/api/interview/{sid}/proctor/snapshot",
                       files={"image": ("snap.jpg", data if data is not None else _jpeg(), ctype)},
                       data={"event_type": event_type, "severity": severity, "label": "Tab switched",
                             "client_ts": utc_now().isoformat() + "Z"},
                       headers=_h(*who))


def test_upload_and_reviewer_access(client):
    ids = _setup()
    r = _upload(client, ids["sid"], event_type="baseline", severity="info")
    assert r.status_code == 200, r.text
    r = _upload(client, ids["sid"])
    assert r.status_code == 200, r.text
    snap_id = r.json()["id"]
    ev = client.post(f"/api/interview/{ids['sid']}/proctor/events", headers=_h(*CAND), json={"events": [
        {"type": "tab_switched", "severity": "medium", "ts": utc_now().isoformat() + "Z", "details": {"hidden_ms": 4000}, "snapshot_id": snap_id},
        {"type": "looking_away", "severity": "low", "ts": int(utc_now().replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)},
        {"type": "BAD TYPE!", "severity": "medium"},
        {"type": "paste_detected", "severity": "critical"},
    ]})
    assert ev.status_code == 200, ev.text
    assert ev.json() == {"stored": 2, "dropped": 2}

    # Owner recruiter: full report with snapshots + events
    rep = client.get(f"/api/proctoring/applications/{ids['app_id']}", headers=_h("own_rec@ex.com", "recruiter"))
    assert rep.status_code == 200, rep.text
    body = rep.json()
    assert [x["kind"] for x in body["snapshots"]] == ["baseline", "event"]
    assert next(e for e in body["events"] if e["type"] == "tab_switched")["snapshot_id"] == snap_id
    assert body["event_counts"] == {"tab_switched": 1, "looking_away": 1}
    assert body["retention_days"] == 90
    img = client.get(body["snapshots"][1]["url"], headers=_h("own_rec@ex.com", "recruiter"))
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    assert img.content.startswith(b"\xff\xd8\xff")

    # Admin: by session id too
    assert client.get(f"/api/proctoring/sessions/{ids['sid']}", headers=_h("admin_p@ex.com", "admin")).status_code == 200
    assert client.get(body["snapshots"][0]["url"], headers=_h("admin_p@ex.com", "admin")).status_code == 200

    # Another recruiter: hidden
    other = _h("other_rec@ex.com", "recruiter")
    assert client.get(f"/api/proctoring/applications/{ids['app_id']}", headers=other).status_code == 404
    assert client.get(f"/api/proctoring/sessions/{ids['sid']}", headers=other).status_code == 404
    assert client.get(body["snapshots"][0]["url"], headers=other).status_code == 404

    # Candidate cannot list or view
    assert client.get(f"/api/proctoring/applications/{ids['app_id']}", headers=_h(*CAND)).status_code in (401, 403)
    assert client.get(body["snapshots"][0]["url"], headers=_h(*CAND)).status_code in (401, 403)
    assert client.get(body["snapshots"][0]["url"]).status_code in (401, 403)


def test_ownership_and_session_state(client):
    ids = _setup()
    # Another candidate cannot upload to this session
    assert _upload(client, ids["sid"], who=("cand_other@ex.com", "candidate")).status_code == 404
    # Recruiter token is not a candidate
    assert _upload(client, ids["sid"], who=("own_rec@ex.com", "recruiter")).status_code == 403
    # Unknown session
    assert _upload(client, 99999).status_code == 404
    with Session(engine) as s:
        iv = s.get(InterviewSession, ids["sid"])
        iv.status = "completed"
        s.add(iv)
        s.commit()
    assert _upload(client, ids["sid"]).status_code == 409
    assert client.post(f"/api/interview/{ids['sid']}/proctor/events", headers=_h(*CAND), json={"events": []}).status_code == 409


def test_practice_session_rejected(client):
    ids = _setup(mode="practice")
    r = _upload(client, ids["sid"])
    assert r.status_code == 400 and "Practice" in r.json()["detail"]
    r = client.post(f"/api/interview/{ids['sid']}/proctor/events", headers=_h(*CAND), json={"events": [{"type": "tab_switched", "severity": "medium"}]})
    assert r.status_code == 400
    with Session(engine) as s:
        assert s.exec(select(ProctorSnapshot)).all() == []
        assert s.exec(select(ProctorEvent)).all() == []
    # Practice sessions are never exposed to reviewers
    assert client.get(f"/api/proctoring/sessions/{ids['sid']}", headers=_h("admin_p@ex.com", "admin")).status_code == 404


def test_validation_magic_size_and_severity(client):
    ids = _setup()
    sid = ids["sid"]
    assert _upload(client, sid, data=_png(), ctype="image/jpeg").status_code == 400          # PNG bytes labelled jpeg
    assert _upload(client, sid, data=b"\xff\xd8\xff" + b"0" * 500 + b"\xff\xd9").status_code == 400  # magic but not decodable
    assert _upload(client, sid, data=b"hello").status_code == 400
    big = _jpeg(1200, 1000, quality=100)
    noise = io.BytesIO()
    import random
    random.seed(1)
    im = Image.frombytes("RGB", (1000, 800), bytes(random.getrandbits(8) for _ in range(1000 * 800 * 3)))
    im.save(noise, format="JPEG", quality=95)
    assert len(noise.getvalue()) > proctoring.MAX_SNAPSHOT_BYTES
    assert _upload(client, sid, data=noise.getvalue()).status_code == 413
    assert len(big) > 0
    assert _upload(client, sid, data=_jpeg(2000, 100)).status_code == 400  # too wide
    assert _upload(client, sid, severity="low").status_code == 400          # low events never store frames
    assert _upload(client, sid, event_type="../etc").status_code == 400
    r = client.post(f"/api/interview/{sid}/proctor/events", headers=_h(*CAND), json={"events": [{"type": "x_y", "severity": "low"}] * 51})
    assert r.status_code == 400


def test_snapshot_cap_and_baseline_limit(client, monkeypatch):
    ids = _setup()
    sid = ids["sid"]
    monkeypatch.setattr(proctoring, "MAX_SNAPSHOTS_PER_SESSION", 4)
    assert _upload(client, sid, event_type="baseline", severity="info").status_code == 200
    assert _upload(client, sid, event_type="baseline", severity="info").status_code == 200
    assert _upload(client, sid, event_type="baseline", severity="info").status_code == 429  # max 2 baselines
    assert _upload(client, sid).status_code == 200
    assert _upload(client, sid, event_type="phone_detected", severity="high").status_code == 200
    r = _upload(client, sid)
    assert r.status_code == 429 and "limit" in r.json()["detail"]
    with Session(engine) as s:
        assert len(s.exec(select(ProctorSnapshot).where(ProctorSnapshot.session_id == sid)).all()) == 4


def test_event_cap(client, monkeypatch):
    ids = _setup()
    monkeypatch.setattr(proctoring, "MAX_EVENTS_PER_SESSION", 3)
    r = client.post(f"/api/interview/{ids['sid']}/proctor/events", headers=_h(*CAND),
                    json={"events": [{"type": "tab_switched", "severity": "medium"}] * 5})
    assert r.json() == {"stored": 3, "dropped": 2}


def test_retention_cleanup_and_deletion_request(client):
    ids = _setup()
    assert _upload(client, ids["sid"]).status_code == 200
    assert _upload(client, ids["sid"], event_type="baseline", severity="info").status_code == 200
    client.post(f"/api/interview/{ids['sid']}/proctor/events", headers=_h(*CAND), json={"events": [{"type": "tab_switched", "severity": "medium"}]})
    with Session(engine) as s:
        old = s.exec(select(ProctorSnapshot).where(ProctorSnapshot.kind == "event")).first()
        old.created_at = utc_now() - datetime.timedelta(days=91)
        s.add(old)
        for e in s.exec(select(ProctorEvent)).all():
            e.created_at = utc_now() - datetime.timedelta(days=95)
            s.add(e)
        s.commit()
    out = proctoring.purge_old_proctor_evidence()
    assert out["snapshots_deleted"] == 1 and out["events_deleted"] == 1 and out["retention_days"] == 90
    with Session(engine) as s:
        left = s.exec(select(ProctorSnapshot)).all()
        assert [x.kind for x in left] == ["baseline"]

    # Candidate deletion request removes the remaining evidence for that application
    r = client.post(f"/api/candidate/applications/{ids['app_id']}/request-data-deletion", headers=_h(*CAND))
    assert r.status_code == 200, r.text
    with Session(engine) as s:
        assert s.exec(select(ProctorSnapshot)).all() == []


def test_retention_days_env(monkeypatch):
    monkeypatch.setenv("PROCTOR_RETENTION_DAYS", "30")
    assert proctoring.retention_days() == 30
    monkeypatch.setenv("PROCTOR_RETENTION_DAYS", "nope")
    assert proctoring.retention_days() == 90
