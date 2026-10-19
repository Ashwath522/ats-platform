"""Sign in with LinkedIn, the LinkedIn URL field and the LinkedIn PDF import."""
import base64
import json
import time

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api import linkedin_auth
from app.auth import create_access_token, decode_token_payload, hash_password
from app.db import CandidateProfile, CandidateUser, User, engine
from app.main import app
from app.services.linkedin_pdf import parse_linkedin_text
from app.services.linkedin_url import normalize_linkedin_url

CID = "77testclient"
SITE = "https://corelink-pi.vercel.app"
CALLBACK = SITE + "/auth/linkedin/callback"


def _png():
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (10, 100, 200)).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(linkedin_auth, "fetch_photo", lambda url: _png())
    monkeypatch.setenv("LINKEDIN_CLIENT_ID", CID)
    monkeypatch.setenv("LINKEDIN_CLIENT_SECRET", "s3cret")
    monkeypatch.setenv("APP_PUBLIC_URL", SITE)
    with TestClient(app) as c:
        yield c


def _jwt(claims):
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return f"{enc({'alg': 'RS256'})}.{enc(claims)}.sig"


def fake_linkedin(email, verified=True, iss="https://www.linkedin.com/oauth", aud=CID, exp=None, name="Asha Rao", error=None):
    def exchange(code, redirect_uri):
        assert redirect_uri == CALLBACK
        if error:
            raise linkedin_auth.LinkedInError(*error)
        return {"access_token": "x", "id_token": _jwt({
            "iss": iss, "aud": aud, "exp": exp or time.time() + 600, "email": email,
            "email_verified": verified, "name": name, "picture": "https://media.licdn.com/p.jpg"})}
    return exchange


def login(client, role="candidate", redirect=CALLBACK):
    return client.post("/api/auth/linkedin", json={"code": "abc", "redirect_uri": redirect, "role": role})


def test_config(client, monkeypatch):
    assert client.get("/api/auth/linkedin/config").json() == {"enabled": True, "client_id": CID}
    monkeypatch.setenv("LINKEDIN_CLIENT_SECRET", "")
    assert client.get("/api/auth/linkedin/config").json() == {"enabled": False, "client_id": None}
    assert login(client).status_code == 503


def test_client_id_with_stray_spaces_still_matches(client, monkeypatch):
    monkeypatch.setenv("LINKEDIN_CLIENT_ID", f"  {CID} ")
    monkeypatch.setattr(linkedin_auth, "exchange_code", fake_linkedin("spaces@gmail.com"))
    assert client.get("/api/auth/linkedin/config").json()["client_id"] == CID
    assert login(client).status_code == 200


def test_new_student_created_verified_and_no_photo(client, monkeypatch):
    monkeypatch.setattr(linkedin_auth, "exchange_code", fake_linkedin("New.Li@Gmail.com"))
    r = login(client)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] is True and body["username"] == "new.li@gmail.com"
    assert decode_token_payload(body["access_token"])["role"] == "candidate"
    prof = client.get("/api/candidate/profile", headers={"Authorization": f"Bearer {body['access_token']}"}).json()
    assert prof["linkedin_verified"] is True and prof["linkedin_verified_at"]
    assert "linkedin_verified" not in (prof.get("preferences") or {})
    assert prof["full_name"] == "Asha Rao"
    assert prof["avatar_url"]                  # LinkedIn photo saved as the avatar
    assert body["needs_profile"] is True       # nothing filled yet → import step


def test_photo_only_from_linkedin_cdn_and_never_blocks_login(client, monkeypatch):
    assert linkedin_auth.fetch_photo is not None
    with pytest.raises(ValueError):
        linkedin_auth._download_photo("https://evil.example/p.jpg")
    def boom(url):
        raise RuntimeError("cdn down")
    monkeypatch.setattr(linkedin_auth, "fetch_photo", boom)
    monkeypatch.setattr(linkedin_auth, "exchange_code", fake_linkedin("nophoto@gmail.com"))
    r = login(client)
    assert r.status_code == 200
    prof = client.get("/api/candidate/profile", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).json()
    assert not prof["avatar_url"]


def test_existing_mixed_case_student_is_matched(client, monkeypatch):
    with Session(engine) as s:
        s.add(CandidateUser(username="Mixed.Li@Example.com", password_hash=hash_password("Password123")))
        s.commit()
    monkeypatch.setattr(linkedin_auth, "exchange_code", fake_linkedin("mixed.li@example.com"))
    r = login(client)
    assert r.status_code == 200 and r.json()["created"] is False
    assert r.json()["username"] == "Mixed.Li@Example.com"


@pytest.mark.parametrize("kw,status", [
    ({"verified": False}, 403), ({"verified": "true"}, 200), ({"iss": "https://evil.example"}, 401),
    ({"aud": "other"}, 401), ({"exp": 1}, 401),
])
def test_token_checks(client, monkeypatch, kw, status):
    monkeypatch.setattr(linkedin_auth, "exchange_code", fake_linkedin(f"chk{status}{len(kw)}@gmail.com", **kw))
    assert login(client).status_code == status


def test_bad_redirect_uri_rejected(client, monkeypatch):
    monkeypatch.setattr(linkedin_auth, "exchange_code", fake_linkedin("x@gmail.com"))
    r = login(client, redirect="https://evil.example/auth/linkedin/callback")
    assert r.status_code == 400


@pytest.mark.parametrize("err,needle", [
    (("invalid_client", "Client authentication failed"), "client ID / secret"),
    (("invalid_request", "Unable to retrieve access token: appid/redirect uri/code verifier does not match"), "callback URL"),
    (("invalid_grant", "authorization code expired"), "expired"),
])
def test_linkedin_errors_are_explained(client, monkeypatch, err, needle):
    monkeypatch.setattr(linkedin_auth, "exchange_code", fake_linkedin("x@gmail.com", error=err))
    r = login(client)
    assert r.status_code == 401 and needle in r.json()["detail"]


def test_recruiter_only_if_approved(client, monkeypatch):
    monkeypatch.setattr(linkedin_auth, "exchange_code", fake_linkedin("hr@firm.com"))
    assert login(client, role="recruiter").status_code == 403
    with Session(engine) as s:
        s.add(User(name="HR", email="hr@firm.com", role="recruiter", password_hash=hash_password("Password123"), email_verified=True))
        s.commit()
    r = login(client, role="recruiter")
    assert r.status_code == 200 and r.json()["role"] == "recruiter"


def _student(client, email="pdf.student@example.com"):
    with Session(engine) as s:
        u = CandidateUser(username=email, password_hash=hash_password("Password123"))
        s.add(u)
        s.commit()
    return {"Authorization": f"Bearer {create_access_token(email, role='candidate')}"}


def test_profile_save_keeps_verification_and_client_cannot_set_it(client, monkeypatch):
    monkeypatch.setattr(linkedin_auth, "exchange_code", fake_linkedin("keep@gmail.com"))
    tok = login(client).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    r = client.put("/api/candidate/profile", headers=h, json={"headline": "Hi", "preferences": {"roles": ["Design"], "linkedin_verified": False}})
    assert r.status_code == 200 and r.json()["linkedin_verified"] is True
    h2 = _student(client, "fake@example.com")
    r = client.put("/api/candidate/profile", headers=h2, json={"preferences": {"linkedin_verified": {"at": "x"}}})
    assert r.json()["linkedin_verified"] is False


@pytest.mark.parametrize("raw,expected", [
    ("https://www.linkedin.com/in/ashwath-m-767327297/?isSelfProfile=true", "https://www.linkedin.com/in/ashwath-m-767327297"),
    ("linkedin.com/in/asha-rao", "https://www.linkedin.com/in/asha-rao"),
    ("in.linkedin.com/in/asha-rao/", "https://www.linkedin.com/in/asha-rao"),
    ("http://www.linkedin.com/in/Asha_Rao", "https://www.linkedin.com/in/Asha_Rao"),
    ("", None),
])
def test_url_normaliser(raw, expected):
    assert normalize_linkedin_url(raw) == expected


@pytest.mark.parametrize("raw", ["https://www.linkedin.com/company/bosch", "https://evil.com/in/asha", "javascript:alert(1)", "asha rao"])
def test_url_normaliser_rejects(raw):
    with pytest.raises(ValueError):
        normalize_linkedin_url(raw)


def test_profile_url_saved_normalised_and_old_values_dont_block(client):
    h = _student(client, "url.student@example.com")
    r = client.put("/api/candidate/profile", headers=h, json={"linkedin_url": "linkedin.com/in/url-student?x=1"})
    assert r.status_code == 200 and r.json()["linkedin_url"] == "https://www.linkedin.com/in/url-student"
    assert client.put("/api/candidate/profile", headers=h, json={"linkedin_url": "not a link"}).status_code == 422
    with Session(engine) as s:   # legacy free-text value saved before validation existed
        u = s.exec(select(CandidateUser).where(CandidateUser.username == "url.student@example.com")).one()
        p = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == u.id)).one()
        p.linkedin_url = "my linkedin"
        s.add(p)
        s.commit()
    r = client.put("/api/candidate/profile", headers=h, json={"headline": "x", "linkedin_url": "my linkedin"})
    assert r.status_code == 200


def test_pdf_import_reads_linkedin_export_and_saves_nothing(client, tmp_path):
    pytest.importorskip("reportlab")
    from tests.linkedin_fixture import build_linkedin_like_pdf
    pdf = tmp_path / "Profile.pdf"
    build_linkedin_like_pdf(str(pdf))
    h = _student(client)
    r = client.post("/api/candidate/profile/linkedin-import", headers=h, files={"file": ("Profile.pdf", pdf.read_bytes(), "application/pdf")})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["full_name"] == "Asha Rao" and d["location_text"] == "Bengaluru, Karnataka, India"
    assert d["headline"].startswith("Mechanical Engineering Student")
    assert d["skills"] == ["SolidWorks", "ANSYS", "GD&T"]
    assert d["languages"] == ["English", "Kannada"]
    assert d["linkedin_url"] == "https://www.linkedin.com/in/asha-rao-12345"
    assert [(j["company"], j["title"], j["end"]) for j in d["experience"]] == [
        ("Bosch India", "Design Intern", "August 2024"),
        ("Team Vegavath SAE", "Suspension Lead", "Present"),
        ("Team Vegavath SAE", "Suspension Engineer", "August 2023")]
    assert d["experience"][0]["description"].startswith("Modelled brackets")
    edu = d["education"]
    assert edu[0]["institution"] == "Atria Institute of Technology" and edu[0]["field_of_study"] == "Mechanical Engineering"
    assert (edu[0]["start_year"], edu[0]["end_year"], edu[0]["level"]) == ("2021", "2025", "degree")
    assert edu[1]["level"] == "pu"
    assert d["warnings"] == []
    prof = client.get("/api/candidate/profile", headers=h).json()
    assert prof["skills"] == [] and not prof.get("headline")


def test_pdf_import_rejects_bad_files(client):
    h = _student(client, "bad.files@example.com")
    r = client.post("/api/candidate/profile/linkedin-import", headers=h, files={"file": ("a.pdf", b"hello", "application/pdf")})
    assert r.status_code == 400
    big = b"%PDF-1.4" + b"0" * (5 * 1024 * 1024 + 10)
    r = client.post("/api/candidate/profile/linkedin-import", headers=h, files={"file": ("a.pdf", big, "application/pdf")})
    assert r.status_code == 413
    r = client.post("/api/candidate/profile/linkedin-import", headers=h, files={"file": ("a.pdf", b"%PDF-1.4 broken", "application/pdf")})
    assert r.status_code == 422


def test_non_linkedin_text_warns():
    d = parse_linkedin_text("John Doe\nResume\nObjective: get a job\nSkills: C, Python")
    assert d["warnings"] and d["experience"] == []
