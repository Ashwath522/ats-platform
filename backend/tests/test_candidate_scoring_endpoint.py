import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient

from app.api import candidate
from app.main import app


client = TestClient(app)


class FakeEmbeddingModel:
    def embed_text(self, text):
        if "Python" in text and "Docker" in text:
            return [1.0, 0.0]
        return [0.8, 0.2]


def test_core_ats_scoring_endpoint_returns_score(monkeypatch):
    monkeypatch.setattr(
        candidate,
        "save_and_index_resume",
        lambda file: ("resume-1", "Python developer with 3 years of Docker experience.", [1.0, 0.0], None),
    )
    monkeypatch.setattr(candidate.EmbeddingModel, "get", lambda: FakeEmbeddingModel())

    response = client.post(
        "/api/candidate/ats-score",
        data={"job_description": "Need Python and Docker experience."},
        files={"file": ("resume.txt", b"ignored by stub", "text/plain")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["resume_id"] == "resume-1"
    assert payload["ats_score"] > 0
    assert "Python" in payload["matched_skills"]
    assert "Docker" in payload["matched_skills"]
