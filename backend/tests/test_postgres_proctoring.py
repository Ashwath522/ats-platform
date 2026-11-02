"""Real PostgreSQL verification (never SQLite): migrations, fail-closed startup,
advisory-lock quotas and idempotency under true concurrency (a 2-worker uvicorn
server, independent connections).

Runs only when ATS_PG_ADMIN_URL points at a PostgreSQL server where the user can
CREATE/DROP DATABASE, e.g.:
    ATS_PG_ADMIN_URL=postgresql://postgres@127.0.0.1:5433/postgres pytest tests/test_postgres_proctoring.py
"""
import io
import os
import socket
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import pytest

ADMIN_URL = os.environ.get("ATS_PG_ADMIN_URL")
pytestmark = pytest.mark.skipif(not ADMIN_URL, reason="ATS_PG_ADMIN_URL not set — PostgreSQL tests skipped")

BACKEND = Path(__file__).resolve().parents[1]
JWT = "pg-test-secret-0123456789abcdef0123456789abcdef"


def _admin_exec(sql):
    import sqlalchemy as sa
    eng = sa.create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with eng.connect() as c:
        c.execute(sa.text(sql))
    eng.dispose()


@pytest.fixture
def pg_url():
    name = f"ats_pgtest_{uuid.uuid4().hex[:10]}"
    _admin_exec(f'CREATE DATABASE "{name}"')
    url = ADMIN_URL.rsplit("/", 1)[0] + f"/{name}"
    yield url
    _admin_exec(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def _env(url, **extra):
    env = {k: v for k, v in os.environ.items() if k not in {"ATS_DATA_DIR"}}
    env.update({"DATABASE_URL": url, "JWT_SECRET_KEY": JWT, "EMBEDDING_BACKEND": "hash", "LIVE_SYNC_AUTO": "false",
                "ATS_DATA_DIR": f"/tmp/ats-pg-{uuid.uuid4().hex[:6]}", "ADMIN_EMAIL": "", "ADMIN_PASSWORD": "",
                "GROQ_API_KEY": "", "GEMINI_API_KEY": "", "OPENROUTER_API_KEY": "", "MEDIA_STORE": "db"})
    env.update(extra)
    return env


def alembic(url, *args):
    return subprocess.run([sys.executable, "-m", "alembic", *(args or ("upgrade", "head"))], cwd=BACKEND,
                          env=_env(url), capture_output=True, text=True, timeout=180)


def _engine(url):
    import sqlalchemy as sa
    return sa.create_engine(url)


def _insp_names(url, table):
    import sqlalchemy as sa
    eng = _engine(url)
    insp = sa.inspect(eng)
    names = {i["name"] for i in insp.get_indexes(table)} | {u["name"] for u in insp.get_unique_constraints(table)}
    eng.dispose()
    return names


def _version(url):
    import sqlalchemy as sa
    eng = _engine(url)
    with eng.connect() as c:
        has = c.execute(sa.text("SELECT to_regclass('alembic_version')")).scalar()
        v = c.execute(sa.text("SELECT version_num FROM alembic_version")).scalar() if has else None
    eng.dispose()
    return v


# ── migrations ──────────────────────────────────────────────────────────────

def test_fresh_database_migrates_and_rerun_is_idempotent(pg_url):
    first = alembic(pg_url)
    assert first.returncode == 0, first.stderr
    assert _version(pg_url) == "0001_proctor_idempotency"
    assert "uq_proctor_event_session_client" in _insp_names(pg_url, "proctorevent")
    assert "uq_proctor_snapshot_session_client" in _insp_names(pg_url, "proctorsnapshot")
    again = alembic(pg_url)
    assert again.returncode == 0, again.stderr


def _legacy_with_duplicates(url):
    """Schema as init_db() left it before Alembic: client_event_id present, no unique index, duplicate rows."""
    import sqlalchemy as sa
    from sqlmodel import SQLModel
    import app.db  # noqa: F401
    eng = _engine(url)
    SQLModel.metadata.create_all(eng)
    cid, sid, _ = _seed_rows(url, status="completed")
    with eng.begin() as c:
        for t, ix in (("proctorevent", "uq_proctor_event_session_client"), ("proctorsnapshot", "uq_proctor_snapshot_session_client")):
            c.execute(sa.text(f'ALTER TABLE {t} DROP CONSTRAINT IF EXISTS "{ix}"'))
            c.execute(sa.text(f'DROP INDEX IF EXISTS "{ix}"'))
        for _ in range(2):
            c.execute(sa.text("INSERT INTO proctorevent (session_id, candidate_id, client_event_id, event_type, severity, created_at) "
                              "VALUES (:s, :c, 'dup-1', 'tab_switched', 'low', now())"), {"s": sid, "c": cid})
    eng.dispose()


def _event_count(url):
    import sqlalchemy as sa
    eng = _engine(url)
    with eng.connect() as c:
        n = c.execute(sa.text("SELECT COUNT(*) FROM proctorevent")).scalar()
    eng.dispose()
    return n


def test_legacy_duplicates_fail_closed_without_deleting_evidence(pg_url):
    _legacy_with_duplicates(pg_url)
    out = alembic(pg_url)
    assert out.returncode != 0
    assert "No data was changed" in (out.stderr + out.stdout)
    assert _event_count(pg_url) == 2 and _version(pg_url) != "0001_proctor_idempotency"
    # operator-approved reconciliation, then the upgrade succeeds
    import sqlalchemy as sa
    eng = _engine(pg_url)
    with eng.begin() as c:
        c.execute(sa.text("DELETE FROM proctorevent WHERE id = (SELECT MAX(id) FROM proctorevent WHERE client_event_id = 'dup-1')"))
    eng.dispose()
    ok = alembic(pg_url)
    assert ok.returncode == 0, ok.stderr
    assert "uq_proctor_event_session_client" in _insp_names(pg_url, "proctorevent")


def test_start_script_never_starts_api_when_real_migration_fails(pg_url, tmp_path):
    _legacy_with_duplicates(pg_url)
    marker = tmp_path / "uvicorn-started"
    fake = tmp_path / "bin"
    fake.mkdir()
    (fake / "uvicorn").write_text(f"#!/bin/sh\ntouch {marker}\n")
    (fake / "uvicorn").chmod(0o755)
    (fake / "alembic").write_text(f"#!/bin/sh\nexec {sys.executable} -m alembic \"$@\"\n")
    (fake / "alembic").chmod(0o755)
    env = _env(pg_url, PATH=f"{fake}:{os.environ['PATH']}")
    r = subprocess.run(["sh", str(BACKEND / "start.sh")], env=env, capture_output=True, text=True, timeout=180)
    assert r.returncode != 0 and not marker.exists()


# ── concurrency against a real multi-worker server ─────────────────────────

def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def server(pg_url):
    assert alembic(pg_url).returncode == 0
    port = _free_port()
    env = _env(pg_url, TESTING="1", PROCTOR_MAX_SNAPSHOTS="4", PROCTOR_MAX_EVENTS="30")
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port), "--workers", "2"],
                            cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    import httpx
    base = f"http://127.0.0.1:{port}"
    for _ in range(240):
        try:
            if httpx.get(base + "/docs", timeout=1).status_code == 200:
                break
        except Exception:
            time.sleep(0.5)
    else:
        proc.kill()
        raise RuntimeError(proc.stderr.read().decode()[-2000:])
    time.sleep(2)   # let both workers finish startup
    yield base, pg_url
    proc.terminate()
    proc.wait(timeout=20)


def _token(email):
    from jose import jwt
    import datetime
    return jwt.encode({"sub": email, "role": "candidate", "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=1)}, JWT, algorithm="HS256")


def _seed_rows(url, status="active"):
    from sqlmodel import Session
    from app.db import CandidateUser, InterviewSession
    eng = _engine(url)
    email = f"cand{uuid.uuid4().hex[:6]}@x"
    with Session(eng) as s:
        cand = CandidateUser(username=email, password_hash="x")
        s.add(cand)
        s.commit()
        s.refresh(cand)
        iv = InterviewSession(candidate_id=cand.id, status=status, mode="application")
        s.add(iv)
        s.commit()
        s.refresh(iv)
        out = (cand.id, iv.id, email)
    eng.dispose()
    return out


def _seed_session(url):
    _, sid, email = _seed_rows(url)
    return sid, {"Authorization": f"Bearer {_token(email)}"}


def _count(url, table, sid):
    import sqlalchemy as sa
    eng = _engine(url)
    with eng.connect() as c:
        n = c.execute(sa.text(f"SELECT COUNT(*) FROM {table} WHERE session_id = :s"), {"s": sid}).scalar()
    eng.dispose()
    return n


def _jpeg(w):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (w, 120), (w % 255, 30, 60)).save(buf, format="JPEG", quality=70)
    return buf.getvalue()


def _parallel(n, fn):
    out, barrier = [None] * n, threading.Barrier(n)

    def run(i):
        barrier.wait()
        out[i] = fn(i)

    threads = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    return out


def test_concurrent_snapshot_uploads_never_exceed_quota(server):
    import httpx
    base, url = server
    sid, h = _seed_session(url)
    res = _parallel(12, lambda i: httpx.post(f"{base}/api/interview/{sid}/proctor/snapshot", headers=h, timeout=30,
                                             files={"image": ("s.jpg", _jpeg(100 + i), "image/jpeg")},
                                             data={"event_type": "tab_switched", "severity": "medium", "client_event_id": f"s{i}"}).status_code)
    assert sorted(res).count(200) == 4 and res.count(429) == 8, res
    assert _count(url, "proctorsnapshot", sid) == 4


def test_concurrent_identical_snapshot_is_stored_once(server):
    import httpx
    base, url = server
    sid, h = _seed_session(url)
    img = _jpeg(150)
    res = _parallel(10, lambda i: httpx.post(f"{base}/api/interview/{sid}/proctor/snapshot", headers=h, timeout=30,
                                             files={"image": ("s.jpg", img, "image/jpeg")},
                                             data={"event_type": "tab_switched", "severity": "medium", "client_event_id": "same"}))
    assert all(r.status_code == 200 for r in res), [r.text for r in res]
    assert sum(1 for r in res if r.json()["status"] == "persisted") == 1
    assert _count(url, "proctorsnapshot", sid) == 1


def test_concurrent_event_batches_respect_quota_and_report_exactly(server):
    import httpx
    base, url = server
    sid, h = _seed_session(url)
    res = _parallel(6, lambda i: httpx.post(f"{base}/api/interview/{sid}/proctor/events", headers=h, timeout=30, json={
        "events": [{"client_event_id": f"b{i}-{k}", "type": "tab_switched", "severity": "low"} for k in range(10)]}).json())
    statuses = [r["status"] for body in res for r in body["results"]]
    assert statuses.count("persisted") == 30 and statuses.count("invalid") == 30
    assert _count(url, "proctorevent", sid) == 30
    acked = {x for body in res for x in body["acknowledged"]}
    import sqlalchemy as sa
    eng = _engine(url)
    with eng.connect() as c:
        stored = {r[0] for r in c.execute(sa.text("SELECT client_event_id FROM proctorevent WHERE session_id = :s"), {"s": sid})}
    eng.dispose()
    assert acked == stored          # every acknowledgement is backed by a row, and vice versa


def test_concurrent_duplicate_batches_store_each_event_once(server):
    import httpx
    base, url = server
    sid, h = _seed_session(url)
    batch = [{"client_event_id": f"d{k}", "type": "looking_away", "severity": "medium", "ts": "2026-01-01T00:00:00Z"} for k in range(5)]
    res = _parallel(8, lambda i: httpx.post(f"{base}/api/interview/{sid}/proctor/events", headers=h, timeout=30, json={"events": batch}).json())
    assert sum(r["status"] == "persisted" for body in res for r in body["results"]) == 5
    assert all(len(body["acknowledged"]) == 5 for body in res)
    assert _count(url, "proctorevent", sid) == 5


def test_advisory_lock_is_deterministic_and_released_on_rollback(pg_url):
    import sqlalchemy as sa
    from app.api.proctoring import LOCK_NAMESPACE
    eng = _engine(pg_url)
    sql_lock = sa.text("SELECT pg_advisory_xact_lock(:ns, :sid)")
    sql_try = sa.text("SELECT pg_try_advisory_xact_lock(:ns, :sid)")
    with eng.connect() as a, eng.connect() as b:
        ta = a.begin()
        a.execute(sql_lock, {"ns": LOCK_NAMESPACE, "sid": 77})
        tb = b.begin()
        assert b.execute(sql_try, {"ns": LOCK_NAMESPACE, "sid": 77}).scalar() is False   # same key → blocked
        assert b.execute(sql_try, {"ns": LOCK_NAMESPACE, "sid": 78}).scalar() is True    # other session → independent
        tb.rollback()
        ta.rollback()                                                                       # rollback releases
        tb = b.begin()
        assert b.execute(sql_try, {"ns": LOCK_NAMESPACE, "sid": 77}).scalar() is True
        tb.rollback()
    eng.dispose()


def test_app_engine_holds_the_lock_until_commit(pg_url):
    """Through the real app engine (db_pool tuning active), the lock must still be held after the call."""
    import sqlalchemy as sa
    from sqlmodel import Session
    from app.db_pool import tune_engine
    from app.api.proctoring import LOCK_NAMESPACE, _lock_proctor_session
    eng = _engine(pg_url)
    tune_engine(eng)
    with Session(eng) as s:
        _lock_proctor_session(s, 91)
        held = s.execute(sa.text("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()")).scalar()
        assert held == 1
        s.rollback()
    eng.dispose()
