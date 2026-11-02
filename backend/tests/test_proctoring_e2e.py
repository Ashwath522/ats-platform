"""End-to-end (backend): start a real interview → evidence with retries/duplicates
→ /finish → late sync from a reconnecting browser → server risk from persisted rows
only → authorized recruiter review of timeline and image bytes."""
import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlmodel import Session

from app.auth import create_access_token
from app.db import Application, InterviewSession, User, engine
from app.main import app
from app.services import llm_stream
from test_interview_api import _headers, _setup


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(llm_stream, "configured_providers", lambda: [])
    with TestClient(app) as c:
        yield c


def jpeg(w):
    b = io.BytesIO()
    Image.new("RGB", (w, 120), (40, 80, 120)).save(b, format="JPEG", quality=70)
    return b.getvalue()


def test_interview_evidence_survives_retries_and_finishes_with_server_risk(client):
    app_id = _setup()
    sid = client.post(f"/api/interview/applications/{app_id}/session", headers=_headers()).json()["session_id"]
    H = _headers()
    ev = lambda cid, t="tab_switched", sev="medium": {"client_event_id": cid, "type": t, "severity": sev, "ts": "2026-11-02T10:00:00Z"}

    # 1. snapshot + its event (snapshot first, as the browser does)
    r = client.post(f"/api/interview/{sid}/proctor/snapshot", headers=H, files={"image": ("s.jpg", jpeg(200), "image/jpeg")},
                    data={"event_type": "tab_switched", "severity": "medium", "client_event_id": "e1", "client_ts": "2026-11-02T10:00:00Z"})
    assert r.status_code == 200
    snap_id = r.json()["id"]
    # 2. network blip: the same batch is sent twice (first response lost) → no double counting
    batch = [ev("e1"), ev("e2", "phone_detected", "high")]
    first = client.post(f"/api/interview/{sid}/proctor/events", headers=H, json={"events": batch}).json()
    retry = client.post(f"/api/interview/{sid}/proctor/events", headers=H, json={"events": batch}).json()
    assert [x["status"] for x in first["results"]] == ["persisted", "persisted"]
    assert [x["status"] for x in retry["results"]] == ["duplicate", "duplicate"]

    # 3. finish — browser claims a tiny risk and reports one event still pending
    fin = client.post(f"/api/interview/sessions/{sid}/finish", headers=H, json={"ended_reason": "completed", "proctoring": {
        "risk_score": 1, "risk_level": "low", "proctoring_status": "completed_with_sync_issues",
        "sync": {"state": "partial", "pending_events": 1, "pending_snapshots": 0, "failed_events": 0, "failed_snapshots": 0}}})
    assert fin.status_code == 200
    with Session(engine) as s:
        assert s.get(Application, app_id).interview_risk_score == 8 + 18      # server formula, not the browser's 1

    # 4. the browser reconnects within the grace window and delivers the pending event
    late = client.post(f"/api/interview/{sid}/proctor/events", headers=H, json={"events": [ev("e3", "multiple_faces", "high")]}).json()
    assert late["results"][0]["status"] == "persisted"
    with Session(engine) as s:
        assert s.get(Application, app_id).interview_risk_score == 8 + 18 + 18
        rec_email = "int_rec@example.com"
        s.add(User(email=rec_email, name="Rec", role="recruiter", password_hash="x", email_verified=True))
        s.add(User(email="stranger@example.com", name="X", role="recruiter", password_hash="x", email_verified=True))
        s.commit()

    # 5. recruiter review: timeline, trust labels, image bytes; a stranger gets nothing
    R = {"Authorization": f"Bearer {create_access_token(username='int_rec@example.com', role='recruiter')}"}
    rep = client.get(f"/api/proctoring/applications/{app_id}", headers=R)
    assert rep.status_code == 200, rep.text
    body = rep.json()
    assert body["risk"]["server_verified"]["risk_score"] == 44 and body["risk"]["client_reported"]["risk_score"] == 1
    assert body["risk"]["client_reported"]["sync"]["state"] == "partial"
    assert [e["client"]["client_event_id"] for e in body["events"]] == ["e1", "e2", "e3"]
    assert body["events"][0]["snapshot_id"] == snap_id and body["events"][2]["server"]["late_sync"] is True
    img = client.get(f"/api/proctoring/snapshots/{snap_id}/image", headers=R)
    assert img.status_code == 200 and img.content[:3] == b"\xff\xd8\xff"
    S = {"Authorization": f"Bearer {create_access_token(username='stranger@example.com', role='recruiter')}"}
    assert client.get(f"/api/proctoring/applications/{app_id}", headers=S).status_code == 404
    assert client.get(f"/api/proctoring/snapshots/{snap_id}/image", headers=S).status_code == 404
    with Session(engine) as s:
        assert json.loads(s.get(InterviewSession, sid).eval_json)["proctoring"]["server_derived_risk_score"] == 44
