import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)
with TestClient(app):
    pass  # triggers startup (init_db) once; TestClient(app) below reuses the same DB file


def test_candidate_branches_endpoint_returns_branch_list():
    response = client.get("/api/candidate/branches")
    assert response.status_code == 200
    branch_ids = {item["id"] for item in response.json()}
    assert {"software", "mechanical", "civil", "ece", "eee", "aerospace"} <= branch_ids


def test_candidate_companies_endpoint_returns_json_list():
    response = client.get("/api/candidate/companies")
    assert response.status_code == 200
    assert isinstance(response.json(), list)
