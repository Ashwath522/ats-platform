import json
import time

import dns.resolver
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api import auth as auth_api
from app.db import RecruiterRequest, User, engine
from app.services import recruiter_verification as rv
from app.services.recruiter_verification import (
    gstin_checksum_char,
    registrable_domain,
    validate_cin,
    validate_gstin,
    verify_recruiter,
)


def _check(result, cid):
    return next(c for c in result["checks"] if c["id"] == cid)


# --------------------------------------------------------------------------- offline checks

def test_disposable_email_is_blocked():
    r = verify_recruiter("Real Person", "someone@mailinator.com", "+91 9876543210", network=False)
    assert r["blocked"] is True
    assert r["verdict"] == "high_risk"
    assert "Disposable" in r["block_reason"]
    assert _check(r, "disposable")["status"] == "fail"


def test_invalid_email_is_blocked():
    r = verify_recruiter("Real Person", "not-an-email", "9876543210", network=False)
    assert r["blocked"] is True
    assert _check(r, "email_syntax")["status"] == "fail"


def test_free_mail_warns_but_not_blocked():
    r = verify_recruiter("Priya Sharma", "priya.sharma@gmail.com", "9876543210", "Acme Labs", "acme.example",
                         network=False)
    assert r["blocked"] is False
    assert _check(r, "free_mail")["status"] == "warn"
    assert _check(r, "domain_match")["status"] == "warn"
    assert r["verdict"] in {"review", "verified"}


def test_gstin_checksum():
    assert gstin_checksum_char("27AAPFU0939F1Z") == "V"
    ok, _ = validate_gstin("27AAPFU0939F1ZV")
    assert ok
    ok, detail = validate_gstin("27AAPFU0939F1ZW")
    assert not ok and "checksum" in detail
    ok, detail = validate_gstin("27AAPFU0939F1")
    assert not ok and "format" in detail
    r = verify_recruiter("Priya", "p@acme.in", "9876543210", gstin="27AAPFU0939F1ZW", network=False)
    assert _check(r, "gstin")["status"] == "fail"
    assert r["score"] <= 70 and r["verdict"] != "verified"


def test_cin_validation():
    assert validate_cin("U72900KA2015PTC082988")[0]
    assert validate_cin("u72900ka2015ptc082988")[0]
    assert not validate_cin("U72900KA2015XYZ082988")[0]
    assert not validate_cin("X72900KA2015PTC082988")[0]


@pytest.mark.parametrize("host,expected", [
    ("www.acme.com", "acme.com"),
    ("careers.acme.com", "acme.com"),
    ("mail.acme.co.in", "acme.co.in"),
    ("acme.co.uk", "acme.co.uk"),
    ("shop.acme.com.au", "acme.com.au"),
    ("hr@jobs.acme.co.in", "acme.co.in"),
])
def test_registrable_domain(host, expected):
    assert registrable_domain(host) == expected


def test_domain_match_and_company_name_offline():
    r = verify_recruiter(
        "Ravi Kumar", "ravi@careers.acmerobotics.co.in", "+91 98765 43210",
        company_name="Acme Robotics Pvt Ltd", company_website="https://www.acmerobotics.co.in/about",
        designation="Talent Lead", gstin="27AAPFU0939F1ZV", cin="U72900KA2015PTC082988",
        linkedin_url="https://www.linkedin.com/company/acme-robotics/", network=False,
    )
    assert _check(r, "domain_match")["status"] == "pass"
    assert _check(r, "company_name")["status"] == "pass"
    assert _check(r, "linkedin")["status"] == "pass"
    assert _check(r, "phone")["status"] == "pass"
    assert _check(r, "mx")["status"] == "skip"
    assert _check(r, "website")["status"] == "skip"
    assert r["verdict"] == "verified"
    assert r["score"] == 100
    assert r["domain"] == "acmerobotics.co.in"


def test_mismatch_and_bad_inputs_warn():
    r = verify_recruiter("test", "test@othercorp.com", "12345", company_name="Acme",
                         company_website="acme.com", linkedin_url="https://linkedin.com/in/someone",
                         network=False)
    assert _check(r, "domain_match")["status"] == "warn"
    assert _check(r, "linkedin")["status"] == "warn"
    assert _check(r, "phone")["status"] == "warn"
    assert _check(r, "name")["status"] == "warn"


# --------------------------------------------------------------------------- network checks (mocked)

class _MX:
    def __init__(self, host):
        self.exchange = host


def _install_dns(monkeypatch, mx=None, a=None, sane=True):
    """mx/a: dict domain -> list | Exception class."""
    class FakeResolver:
        timeout = lifetime = 0

        def resolve(self, name, rtype):
            table = mx if rtype == "MX" else a
            value = (table or {}).get(name, dns.resolver.NXDOMAIN)
            if isinstance(value, type) and issubclass(value, Exception):
                raise value()
            return value

    monkeypatch.setattr(rv, "_new_resolver", lambda: FakeResolver())
    monkeypatch.setattr(rv, "_dns_trustworthy", lambda: sane)


def test_network_checks_pass_with_mocked_dns_and_http(monkeypatch):
    _install_dns(monkeypatch, mx={"acme.com": [_MX("mx1.acme.com.")]}, a={"www.acme.com": ["1.2.3.4"]})
    monkeypatch.setattr(rv, "_probe_website", lambda url: {
        "ok": True, "status_code": 200, "final_url": url, "title": "Acme | Home", "error": None,
    })
    r = verify_recruiter("Ann Lee", "ann@acme.com", "+1 415 555 0100", "Acme Inc", "www.acme.com")
    assert _check(r, "mx")["status"] == "pass"
    assert _check(r, "website")["status"] == "pass"
    assert r["website_title"] == "Acme | Home"
    assert r["verdict"] == "verified"


def test_nxdomain_fails_and_dns_error_warns(monkeypatch):
    _install_dns(monkeypatch, mx={"ghost.com": dns.resolver.NXDOMAIN}, a={"ghost.com": dns.resolver.NXDOMAIN})
    monkeypatch.setattr(rv, "_probe_website", lambda url: {"ok": False, "status_code": None, "title": None,
                                                            "error": "dns"})
    r = verify_recruiter("Ann Lee", "ann@ghost.com", "9876543210", "Ghost", "ghost.com")
    assert _check(r, "mx")["status"] == "fail"
    assert _check(r, "website")["status"] == "fail"
    assert r["verdict"] != "verified"

    _install_dns(monkeypatch, mx={"acme.com": dns.resolver.NoNameservers}, a={"acme.com": dns.resolver.LifetimeTimeout})
    monkeypatch.setattr(rv, "_probe_website", lambda url: {"ok": False, "status_code": None, "title": None,
                                                            "error": "timeout"})
    r = verify_recruiter("Ann Lee", "ann@acme.com", "9876543210", "Acme", "acme.com")
    assert _check(r, "mx")["status"] == "warn"
    assert _check(r, "website")["status"] == "warn"


def test_untrustworthy_resolver_downgrades_nxdomain(monkeypatch):
    _install_dns(monkeypatch, mx={}, a={}, sane=False)
    monkeypatch.setattr(rv, "_probe_website", lambda url: {"ok": False, "status_code": None, "title": None,
                                                            "error": "connect"})
    r = verify_recruiter("Ann Lee", "ann@acme.com", "9876543210", "Acme", "acme.com")
    assert _check(r, "mx")["status"] == "warn"
    assert _check(r, "website")["status"] == "warn"


def test_probe_website_parses_title(monkeypatch):
    import httpx

    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/html"},
                              text="<html><head><title> Acme &amp; Co </title></head></html>")

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client
    monkeypatch.setattr(rv.httpx, "Client", lambda **kw: real_client(transport=transport, **kw))
    result = rv._probe_website("https://acme.com/")
    assert result["ok"] is True
    assert result["title"] == "Acme & Co"


def test_network_probes_respect_deadline(monkeypatch):
    def slow_mx(domain):
        time.sleep(3)
        return "pass", "late"

    monkeypatch.setattr(rv, "NETWORK_DEADLINE", 0.3)
    monkeypatch.setattr(rv, "_probe_mx", slow_mx)
    started = time.monotonic()
    r = verify_recruiter("Ann Lee", "ann@acme.com", "9876543210")
    assert time.monotonic() - started < 2
    assert _check(r, "mx")["status"] == "warn"


# --------------------------------------------------------------------------- API

@pytest.fixture
def api_client(monkeypatch):
    from app.main import app

    monkeypatch.setattr(auth_api, "_verification_network_enabled", lambda: False)
    monkeypatch.delenv("ADMIN_EMAIL", raising=False)
    with TestClient(app) as client:
        yield client


def test_api_blocks_disposable_email(api_client):
    response = api_client.post(
        "/api/recruiter-requests",
        data={"name": "Spam Bot", "email": "bot@yopmail.com", "phone": "9876543210"},
    )
    assert response.status_code == 422
    assert "Disposable" in response.json()["detail"]
    with Session(engine) as session:
        assert session.exec(select(RecruiterRequest).where(RecruiterRequest.email == "bot@yopmail.com")).first() is None


def test_api_stores_verification(api_client):
    response = api_client.post(
        "/api/recruiter-requests",
        data={
            "name": "Ravi Kumar",
            "email": "Ravi@AcmeRobotics.co.in",
            "phone": "+91 98765 43210",
            "company_name": "Acme Robotics Pvt Ltd",
            "company_website": "acmerobotics.co.in",
            "designation": "HR Manager",
            "gstin": "27aapfu0939f1zv",
            "cin": "U72900KA2015PTC082988",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["verification"]["verdict"] == "verified"
    assert "checks" not in body["verification"]

    with Session(engine) as session:
        stored = session.get(RecruiterRequest, body["id"])
        assert stored.email == "ravi@acmerobotics.co.in"
        assert stored.company_name == "Acme Robotics Pvt Ltd"
        assert stored.gstin == "27AAPFU0939F1ZV"
        assert stored.verification_verdict == "verified"
        assert stored.verification_score == body["verification"]["score"]
        assert json.loads(stored.verification_json)["checks"]

    duplicate = api_client.post(
        "/api/recruiter-requests",
        data={"name": "Ravi Kumar", "email": "ravi@acmerobotics.co.in", "phone": "9876543210"},
    )
    assert duplicate.status_code == 409


def test_api_validate_returns_checks_without_storing(api_client):
    response = api_client.post(
        "/api/recruiter-requests/validate",
        data={"name": "Priya", "email": "priya@gmail.com", "phone": "9876543210"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["verdict"] in {"review", "verified", "high_risk"}
    assert any(c["id"] == "free_mail" and c["status"] == "warn" for c in body["checks"])
    with Session(engine) as session:
        assert session.exec(select(RecruiterRequest)).first() is None


def test_admin_list_and_reverify(api_client):
    from app.auth import create_access_token, hash_password

    with Session(engine) as session:
        session.add(User(name="Admin", email="admin-verify@example.com", role="admin",
                         password_hash=hash_password("password123"), email_verified=True))
        session.commit()
    headers = {"Authorization": f"Bearer {create_access_token('admin-verify@example.com', 'admin')}"}

    created = api_client.post(
        "/api/recruiter-requests",
        data={"name": "Ann Lee", "email": "ann@gmail.com", "phone": "9876543210", "company_name": "Acme"},
    ).json()

    listing = api_client.get("/api/admin/recruiter-requests", headers=headers)
    assert listing.status_code == 200
    item = next(i for i in listing.json() if i["id"] == created["id"])
    assert item["company_name"] == "Acme"
    assert item["verification_verdict"] == created["verification"]["verdict"]
    assert item["verification"]["checks"]

    reverify = api_client.post(f"/api/admin/recruiter-requests/{created['id']}/reverify", headers=headers)
    assert reverify.status_code == 200
    assert reverify.json()["verification"]["checks"]

    status = api_client.get("/api/admin/email/status", headers=headers)
    assert status.status_code == 200
    assert "provider" in status.json() and isinstance(status.json()["logs"], list)
