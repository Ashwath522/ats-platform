"""Proctoring integrity on the app database (SQLite in the default suite):
per-record acknowledgements, exact-duplicate rules, snapshot/event linkage,
late sync after /finish, relationship-chain authorization and trust labels."""
import datetime

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api import proctoring
from app.db import Application, InterviewSession, Job, ProctorEvent, ProctorSnapshot, RecruiterUser, engine, utc_now
from app.main import app
from test_proctoring_portal import CAND, _h, _jpeg, _setup  # noqa: E402  (tests dir is on sys.path)

OWN = ("own_rec@ex.com", "recruiter")
OTHER = ("other_rec@ex.com", "recruiter")
ADMIN = ("admin_p@ex.com", "admin")


@pytest.fixture
def client():
    return TestClient(app)


def post_events(client, sid, events):
    r = client.post(f"/api/interview/{sid}/proctor/events", headers=_h(*CAND), json={"events": events})
    assert r.status_code == 200, r.text
    return r.json()


def snap(client, sid, cid=None, data=None, event_type="tab_switched", severity="medium"):
    files = {"image": ("s.jpg", data or _jpeg(), "image/jpeg")}
    form = {"event_type": event_type, "severity": severity}
    if cid:
        form["client_event_id"] = cid
    return client.post(f"/api/interview/{sid}/proctor/snapshot", headers=_h(*CAND), files=files, data=form)


# ── acknowledgements ─────────────────────────────────────────────────────────

def test_mixed_batch_returns_accurate_per_record_outcomes(client):
    sid = _setup()["sid"]
    ts = utc_now().isoformat() + "Z"
    post_events(client, sid, [{"client_event_id": "e-old", "type": "tab_switched", "severity": "medium", "ts": ts}])
    out = post_events(client, sid, [
        {"client_event_id": "e-new", "type": "looking_away", "severity": "low", "ts": ts},          # persisted
        {"client_event_id": "e-old", "type": "tab_switched", "severity": "medium", "ts": ts},        # exact duplicate
        {"client_event_id": "e-old", "type": "phone_detected", "severity": "high", "ts": ts},        # id reused for different event
        {"client_event_id": "e-bad", "type": "NOT VALID", "severity": "medium"},                    # invalid
        {"client_event_id": "e-sev", "type": "tab_switched", "severity": "extreme"},                # invalid
        {"client_event_id": "bad id with spaces", "type": "tab_switched", "severity": "low"},        # invalid id
        "not-an-object",
        {"client_event_id": "e-new", "type": "looking_away", "severity": "low", "ts": ts},          # in-batch duplicate
    ])
    status = [(r["client_event_id"], r["status"]) for r in out["results"]]
    assert status == [("e-new", "persisted"), ("e-old", "duplicate"), ("e-old", "invalid"), ("e-bad", "invalid"),
                      ("e-sev", "invalid"), ("bad id with spaces", "invalid"), (None, "invalid"), ("e-new", "duplicate")]
    assert out["acknowledged"] == ["e-new", "e-old", "e-new"] or set(out["acknowledged"]) == {"e-new", "e-old"}
    assert "e-bad" not in out["acknowledged"] and out["stored"] == 1 and out["failed"] == 0
    with Session(engine) as s:
        rows = s.exec(select(ProctorEvent).where(ProctorEvent.session_id == sid)).all()
    assert sorted(r.client_event_id for r in rows) == ["e-new", "e-old"]
    assert next(r for r in rows if r.client_event_id == "e-old").event_type == "tab_switched"   # never overwritten


@pytest.mark.skipif(engine.dialect.name != "sqlite", reason="uses a SQLite trigger to inject a storage error")
def test_storage_error_is_failed_not_acknowledged(client):
    """A real database error on one row (here: a trigger) must not be reported as stored or duplicate."""
    from sqlalchemy import text
    sid = _setup()["sid"]
    with engine.begin() as c:
        c.execute(text("CREATE TRIGGER pe_boom BEFORE INSERT ON proctorevent WHEN NEW.client_event_id = 'x1' "
                       "BEGIN SELECT RAISE(ABORT, 'simulated storage error'); END"))
    try:
        out = post_events(client, sid, [{"client_event_id": f"x{i}", "type": "tab_switched", "severity": "low"} for i in range(3)])
    finally:
        with engine.begin() as c:
            c.execute(text("DROP TRIGGER pe_boom"))
    assert [r["status"] for r in out["results"]] == ["persisted", "failed", "persisted"]
    assert out["acknowledged"] == ["x0", "x2"]
    with Session(engine) as s:
        assert sorted(r.client_event_id for r in s.exec(select(ProctorEvent).where(ProctorEvent.session_id == sid)).all()) == ["x0", "x2"]


def test_failed_commit_reports_every_record_failed(client, monkeypatch):
    sid = _setup()["sid"]
    real_commit = Session.commit

    def broken_commit(self):
        raise RuntimeError("connection lost")

    monkeypatch.setattr(Session, "commit", broken_commit)
    out = post_events(client, sid, [{"client_event_id": "c1", "type": "tab_switched", "severity": "low"}])
    monkeypatch.setattr(Session, "commit", real_commit)
    assert out["results"][0]["status"] == "failed" and out["acknowledged"] == []


def test_event_quota_is_invalid_not_acknowledged(client, monkeypatch):
    sid = _setup()["sid"]
    monkeypatch.setattr(proctoring, "MAX_EVENTS_PER_SESSION", 2)
    out = post_events(client, sid, [{"client_event_id": f"q{i}", "type": "tab_switched", "severity": "low"} for i in range(4)])
    assert [r["status"] for r in out["results"]] == ["persisted", "persisted", "invalid", "invalid"]
    assert out["capacity_dropped"] == ["q2", "q3"] and out["acknowledged"] == ["q0", "q1"]
    again = post_events(client, sid, [{"client_event_id": "q0", "type": "tab_switched", "severity": "low"}])
    assert again["results"][0]["status"] == "duplicate"           # duplicates never consume quota


# ── snapshots ────────────────────────────────────────────────────────────────

def test_snapshot_exact_duplicate_vs_conflict_and_linkage(client):
    sid = _setup()["sid"]
    img = _jpeg()
    # event arrives first (e.g. after a refresh), snapshot later — server links them by client_event_id
    post_events(client, sid, [{"client_event_id": "ev-1", "type": "tab_switched", "severity": "medium"}])
    first = snap(client, sid, "ev-1", img)
    assert first.status_code == 200 and first.json()["status"] == "persisted"
    dup = snap(client, sid, "ev-1", img)
    assert dup.status_code == 200 and dup.json()["deduplicated"] and dup.json()["id"] == first.json()["id"]
    assert snap(client, sid, "ev-1", _jpeg(w=200)).status_code == 409             # same id, different bytes
    with Session(engine) as s:
        ev = s.exec(select(ProctorEvent).where(ProctorEvent.client_event_id == "ev-1")).one()
        assert ev.snapshot_id == first.json()["id"]
        assert len(s.exec(select(ProctorSnapshot).where(ProctorSnapshot.session_id == sid)).all()) == 1
    # snapshot first, event later: linked on insert without the client knowing the id
    s2 = snap(client, sid, "ev-2", _jpeg(w=330)).json()["id"]
    post_events(client, sid, [{"client_event_id": "ev-2", "type": "tab_switched", "severity": "medium", "snapshot_id": 999999}])
    with Session(engine) as s:
        assert s.exec(select(ProctorEvent).where(ProctorEvent.client_event_id == "ev-2")).one().snapshot_id == s2


def test_snapshot_quota_and_duplicates_do_not_consume_quota(client, monkeypatch):
    sid = _setup()["sid"]
    monkeypatch.setattr(proctoring, "MAX_SNAPSHOTS_PER_SESSION", 2)
    img = _jpeg()
    assert snap(client, sid, "a", img).status_code == 200
    assert snap(client, sid, "a", img).status_code == 200      # duplicate
    assert snap(client, sid, "b", _jpeg(w=300)).status_code == 200
    assert snap(client, sid, "c", _jpeg(w=310)).status_code == 429


# ── late sync after /finish ──────────────────────────────────────────────────

def test_late_evidence_accepted_in_grace_window_and_updates_server_risk(client):
    ids = _setup()
    with Session(engine) as s:
        iv = s.get(InterviewSession, ids["sid"])
        iv.status, iv.completed_at = "completed", utc_now()
        appl = s.get(Application, ids["app_id"])
        appl.interview_id = iv.id
        s.add_all([iv, appl])
        s.commit()
    out = post_events(client, ids["sid"], [{"client_event_id": "late-1", "type": "phone_detected", "severity": "high"}])
    assert out["results"][0]["status"] == "persisted"
    with Session(engine) as s:
        assert s.get(Application, ids["app_id"]).interview_risk_score == 18
        iv = s.get(InterviewSession, ids["sid"])
        iv.completed_at = utc_now() - datetime.timedelta(minutes=proctoring.late_sync_minutes() + 1)
        s.add(iv)
        s.commit()
    r = client.post(f"/api/interview/{ids['sid']}/proctor/events", headers=_h(*CAND), json={"events": [{"client_event_id": "late-2", "type": "tab_switched", "severity": "low"}]})
    assert r.status_code == 409
    report = client.get(f"/api/proctoring/sessions/{ids['sid']}", headers=_h(*OWN)).json()
    assert report["events"][0]["server"]["late_sync"] is True


# ── authorization: relationship chain ────────────────────────────────────────

def _snap_id(client, sid):
    r = snap(client, sid, "auth-1")
    assert r.status_code == 200
    return r.json()["id"]


def test_reviewer_access_follows_the_relationship_chain(client):
    ids = _setup()
    sid_ = _snap_id(client, ids["sid"])
    url = f"/api/proctoring/snapshots/{sid_}/image"
    assert client.get(url, headers=_h(*OWN)).status_code == 200
    assert client.get(url, headers=_h(*OWN)).headers["cache-control"] == "private, no-store"
    assert client.get(url, headers=_h(*ADMIN)).status_code == 200
    assert client.get(url, headers=_h(*OTHER)).status_code == 404
    assert client.get(f"/api/proctoring/sessions/{ids['sid']}", headers=_h(*OTHER)).status_code == 404
    assert client.get(url, headers=_h(*CAND)).status_code in (401, 403)
    assert client.get("/api/proctoring/snapshots/999999/image", headers=_h(*OWN)).status_code == 404


def _tamper(changes):
    with Session(engine) as s:
        for (model, pk), values in changes.items():
            row = s.get(model, pk)
            for k, v in values.items():
                setattr(row, k, v)
            s.add(row)
        s.commit()


def test_forged_session_job_id_cannot_grant_access(client):
    """A session row pointing at the attacker's job must not override the application's real job."""
    ids = _setup()
    snap_id = _snap_id(client, ids["sid"])
    with Session(engine) as s:
        other = s.exec(select(RecruiterUser).where(RecruiterUser.username == "other_rec@ex.com")).one()
        j = Job(recruiter_id=other.id, title="Attacker job", description="x")
        s.add(j)
        s.commit()
        s.refresh(j)
        attacker_job = j.id
    _tamper({(InterviewSession, ids["sid"]): {"job_id": attacker_job}})
    for who in (OTHER, OWN):        # inconsistent chain → nobody but admins can read it
        assert client.get(f"/api/proctoring/snapshots/{snap_id}/image", headers=_h(*who)).status_code == 404
        assert client.get(f"/api/proctoring/sessions/{ids['sid']}", headers=_h(*who)).status_code == 404


def test_snapshot_with_mismatched_denormalized_ids_is_refused(client):
    ids = _setup()
    snap_id = _snap_id(client, ids["sid"])
    with Session(engine) as s:
        other_app = Application(candidate_id=s.get(Application, ids["app_id"]).candidate_id, job_id=ids["job_id"], status="applied")
        s.add(other_app)
        s.commit()
        s.refresh(other_app)
        other_app_id = other_app.id
    _tamper({(ProctorSnapshot, snap_id): {"application_id": other_app_id}})
    assert client.get(f"/api/proctoring/snapshots/{snap_id}/image", headers=_h(*OWN)).status_code == 404
    _tamper({(ProctorSnapshot, snap_id): {"application_id": ids["app_id"], "candidate_id": 424242}})
    assert client.get(f"/api/proctoring/snapshots/{snap_id}/image", headers=_h(*OWN)).status_code == 404


def test_application_belonging_to_another_candidate_is_refused(client):
    ids = _setup()
    snap_id = _snap_id(client, ids["sid"])
    from app.db import CandidateUser
    with Session(engine) as s:
        other_cand = s.exec(select(CandidateUser).where(CandidateUser.username == "cand_other@ex.com")).one().id
    _tamper({(Application, ids["app_id"]): {"candidate_id": other_cand}})
    assert client.get(f"/api/proctoring/snapshots/{snap_id}/image", headers=_h(*OWN)).status_code == 404
    assert client.get(f"/api/proctoring/sessions/{ids['sid']}", headers=_h(*OWN)).status_code == 404


# ── trust boundaries ─────────────────────────────────────────────────────────

def test_client_risk_never_changes_server_risk_and_is_labelled(client):
    ids = _setup()
    post_events(client, ids["sid"], [{"client_event_id": "t1", "type": "phone_detected", "severity": "high"}])
    with Session(engine) as s:
        iv = s.get(InterviewSession, ids["sid"])
        iv.eval_json = '{"proctoring": {"risk_score": 3, "risk_level": "low", "detectors": {"face": "ok"}}}'
        s.add(iv)
        s.commit()
    risk = client.get(f"/api/proctoring/sessions/{ids['sid']}", headers=_h(*OWN)).json()["risk"]
    assert risk["risk_score"] == 18 and risk["server_verified"]["persisted_events"] == 1
    assert risk["client_reported"]["risk_score"] == 3 and risk["client_reported"]["detectors"] == {"face": "ok"}
    assert proctoring.server_risk([type("E", (), {"severity": "high"})()] * 10)["score"] == 100


def test_db_pool_never_runs_transaction_scoped_selects_in_autocommit():
    """Regression: read-autocommit released pg_advisory_xact_lock immediately, disabling quota locks."""
    from app.db_pool import _is_plain_read
    assert _is_plain_read("SELECT id FROM proctorevent")
    for sql in ("SELECT pg_advisory_xact_lock(1, 2)", "select pg_try_advisory_xact_lock(%(ns)s, %(sid)s)",
                "SELECT nextval('x')", "SELECT * FROM t FOR UPDATE"):
        assert not _is_plain_read(sql), sql
