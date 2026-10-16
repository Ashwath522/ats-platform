"""Profile PUT/GET round-trips college metadata (dataset id + domain) stored in preferences_json."""
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.auth import create_access_token
from app.db import CandidateProfile, CandidateUser, engine
from app.main import app
from app.services import llm_stream


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(llm_stream, "configured_providers", lambda: [])
    with TestClient(app) as c:
        yield c


def _student():
    email = f"col-{uuid.uuid4().hex[:8]}@example.com"
    with Session(engine) as s:
        u = CandidateUser(username=email, password_hash="x")
        s.add(u)
        s.commit()
        s.refresh(u)
        s.add(CandidateProfile(candidate_id=u.id, full_name="Asha Rao"))
        s.commit()
    return {"Authorization": f"Bearer {create_access_token(username=email, role='candidate')}"}, email


URL = "/api/candidate/profile"


def test_college_meta_round_trip_and_preferences_kept(client):
    h, email = _student()
    r = client.put(URL, json={"college": "Atria Institute of Technology", "college_meta": {"id": "atria", "domain": "atria.edu"}}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["college"] == "Atria Institute of Technology"
    assert body["college_meta"] == {"id": "atria", "domain": "atria.edu"}
    assert "college_meta" not in body["preferences"]

    # A page rewriting preferences (without the key) must not wipe the metadata.
    r = client.put(URL, json={"preferences": {"roles": ["Design Engineer"]}}, headers=h)
    assert r.json()["college_meta"] == {"id": "atria", "domain": "atria.edu"}
    assert r.json()["preferences"] == {"roles": ["Design Engineer"]}
    assert client.get(URL, headers=h).json()["college_meta"]["id"] == "atria"

    with Session(engine) as s:
        u = s.exec(select(CandidateUser).where(CandidateUser.username == email)).first()
        p = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == u.id)).first()
        prefs = json.loads(p.preferences_json)
        assert prefs["roles"] == ["Design Engineer"] and prefs["college_meta"]["id"] == "atria"


def test_free_text_college_clears_meta(client):
    h, _ = _student()
    client.put(URL, json={"college": "RV College", "college_meta": {"id": "rvce", "domain": "rvce.edu.in"}}, headers=h)
    r = client.put(URL, json={"college": "Govt Polytechnic Hassan"}, headers=h)
    assert r.json()["college"] == "Govt Polytechnic Hassan"
    assert r.json()["college_meta"] is None
    # Explicit clear
    client.put(URL, json={"college": "IIT Bombay", "college_meta": {"id": "iitb", "domain": "iitb.ac.in"}}, headers=h)
    r = client.put(URL, json={"college_meta": {}}, headers=h)
    assert r.json()["college_meta"] is None and r.json()["college"] == "IIT Bombay"
    # Unrelated field updates keep metadata.
    client.put(URL, json={"college": "IIT Bombay", "college_meta": {"id": "iitb", "domain": "iitb.ac.in"}}, headers=h)
    assert client.put(URL, json={"headline": "Hi"}, headers=h).json()["college_meta"]["id"] == "iitb"


@pytest.mark.parametrize("meta", [
    {"id": "Bad Id!", "domain": "x.ac.in"},
    {"id": "ok", "domain": "https://evil.example.com/path"},
    {"id": "ok", "domain": "javascript:alert(1)"},
])
def test_invalid_college_meta_rejected(client, meta):
    h, _ = _student()
    r = client.put(URL, json={"college": "X", "college_meta": meta}, headers=h)
    assert r.status_code == 422


def test_profile_without_meta(client):
    h, _ = _student()
    body = client.get(URL, headers=h).json()
    assert body["college_meta"] is None
