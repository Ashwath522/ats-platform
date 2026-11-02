# Database migrations

Production schema changes run through Alembic. The container entrypoint
(`start.sh`, used by the Dockerfile `CMD`) runs `alembic upgrade head` and only then
`exec`s uvicorn. It is **fail-closed**: if the migration fails, the script exits
with Alembic's exit code and the API never starts against a partial schema
(`tests/test_startup_migrations.py`, and with real PostgreSQL
`tests/test_postgres_proctoring.py::test_start_script_never_starts_api_when_real_migration_fails`).

`init_db()` still runs at app startup (create missing tables / add missing
columns). It is a convenience for local SQLite and tests; it does not replace
migrations.

## Revisions

| Revision | What it does |
|---|---|
| `0000_baseline` | `create_all(checkfirst=True)`: creates missing tables only. Works on a brand-new database and on databases that `init_db()` created before Alembic existed. Never alters or drops. |
| `0001_proctor_idempotency` | Adds `client_event_id` to `proctorevent` / `proctorsnapshot` if missing, then unique `(session_id, client_event_id)` indexes. Idempotent. |

Because the baseline mirrors the current models, **every later revision must be
idempotent** (inspect before adding a column or index).

## Legacy duplicate evidence

`0001` refuses to run, changes nothing and prints how many duplicate groups
exist when a database already contains duplicate `(session_id, client_event_id)`
rows. Evidence is never deleted automatically. To reconcile:

```sql
-- 1. inspect
SELECT session_id, client_event_id, COUNT(*), MIN(id), MAX(id) FROM proctorevent
WHERE client_event_id IS NOT NULL GROUP BY session_id, client_event_id HAVING COUNT(*) > 1;
SELECT session_id, client_event_id, COUNT(*), MIN(id), MAX(id) FROM proctorsnapshot
WHERE client_event_id IS NOT NULL GROUP BY session_id, client_event_id HAVING COUNT(*) > 1;
-- 2. export those rows (e.g. \copy ... TO 'proctor_duplicates.csv' CSV HEADER) and record who approved the cleanup
-- 3. keep the earliest row of each group (an approved operator decision), e.g. for events:
DELETE FROM proctorevent e USING proctorevent k
 WHERE e.session_id = k.session_id AND e.client_event_id = k.client_event_id AND e.id > k.id;
```

Then re-run `alembic upgrade head`. The same flow is exercised against PostgreSQL in
`test_legacy_duplicates_fail_closed_without_deleting_evidence`.

## Verifying locally

```bash
cd backend
# default suite (SQLite)
EMBEDDING_BACKEND=hash ATS_TEST_DATA_DIR=$(mktemp -d) python -m pytest -q
# PostgreSQL: migrations, fail-closed start, advisory-lock quotas under a 2-worker server
ATS_PG_ADMIN_URL=postgresql://postgres@127.0.0.1:5432/postgres python -m pytest -q tests/test_postgres_proctoring.py
# whole proctoring suite on a scratch PostgreSQL database
ATS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/ats_scratch python -m pytest -q tests/test_proctoring_*.py
```
