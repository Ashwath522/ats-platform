"""Tests for new portal features: candidate auth role separation, distance calc."""
import math
import pytest

# ── Distance calculations ──

from app.services.distance import haversine_km, distance_or_none


def test_haversine_same_point():
    """Distance from a point to itself should be 0."""
    assert haversine_km(12.97, 77.59, 12.97, 77.59) == 0.0


def test_haversine_known_distance():
    """Bangalore to Mumbai is roughly 840 km straight line."""
    dist = haversine_km(12.97, 77.59, 19.08, 72.88)
    assert 830 < dist < 860  # allow some tolerance


def test_haversine_antipodes():
    """Opposite sides of the Earth should be ~20000 km."""
    dist = haversine_km(0, 0, 0, 180)
    assert 20000 < dist < 20100


def test_distance_or_none_with_missing_coords():
    """Should return None when any coordinate is missing."""
    assert distance_or_none(None, 77.59, 19.08, 72.88) is None
    assert distance_or_none(12.97, None, 19.08, 72.88) is None
    assert distance_or_none(12.97, 77.59, None, 72.88) is None
    assert distance_or_none(12.97, 77.59, 19.08, None) is None


def test_distance_or_none_with_valid_coords():
    """Should return a float when all coordinates present."""
    result = distance_or_none(12.97, 77.59, 19.08, 72.88)
    assert result is not None
    assert isinstance(result, float)
    assert result > 0


# ── Auth role token generation ──

from app.auth import (
    create_access_token, decode_access_token, hash_password, verify_password,
)


def test_token_contains_role():
    """JWT should carry the role claim."""
    token = create_access_token("alice", role="candidate")
    username, role = decode_access_token(token)
    assert username == "alice"
    assert role == "candidate"


def test_token_recruiter_role():
    """JWT with recruiter role."""
    token = create_access_token("bob", role="recruiter")
    username, role = decode_access_token(token)
    assert username == "bob"
    assert role == "recruiter"


def test_token_default_role_is_recruiter():
    """For backwards compat, default role should be 'recruiter'."""
    token = create_access_token("charlie")
    username, role = decode_access_token(token)
    assert role == "recruiter"


def test_password_hash_roundtrip():
    """Password hashing should be verifiable."""
    pw = "testPassword123"
    hashed = hash_password(pw)
    assert verify_password(pw, hashed)
    assert not verify_password("wrongPassword", hashed)


from fastapi.testclient import TestClient
from app.main import app


def test_admin_suggestions_flow(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "portal-admin@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "secretAdminCode")
    client = TestClient(app)
    with client:
        # Submit suggestion
        res = client.post("/api/suggestions", data={"text": "This is a great app!", "submitter": "anonymous"})
        assert res.status_code == 200
        assert res.json()["success"] is True

        # Query-string passwords are no longer accepted.
        res_fail = client.get("/api/admin/suggestions", params={"password": "wrong"})
        assert res_fail.status_code == 401

        login = client.post(
            "/api/auth/login",
            data={"email": "portal-admin@example.com", "password": "secretAdminCode"},
        )
        assert login.status_code == 200
        token = login.json()["access_token"]

        res_ok = client.get("/api/admin/suggestions", headers={"Authorization": f"Bearer {token}"})
        assert res_ok.status_code == 200
        data = res_ok.json()
        assert "candidate_count" in data
        assert "recruiter_count" in data
        assert len(data["suggestions"]) >= 1
        assert data["suggestions"][0]["text"] == "This is a great app!"
