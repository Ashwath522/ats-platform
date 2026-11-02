# Database migrations

Production schema changes use the checked-in Alembic workflow: from `backend/`, run `alembic upgrade head` and inspect SQL for the target database before deployment. `init_db()` remains available for local SQLite and tests, but is not a substitute for production migrations.

## Current status

Alembic is not initialised yet (there is no `alembic.ini` or `alembic/` folder), so production relies on `init_db()`, which creates tables and adds missing columns at startup. The Docker start command only runs `alembic upgrade head` when `alembic.ini` exists, so the server always starts.

The first revision adds proctor idempotency columns and unique indexes. Before upgrading an existing installation, inspect duplicates with:

```sql
SELECT session_id, client_event_id, COUNT(*) FROM proctorevent
WHERE client_event_id IS NOT NULL GROUP BY session_id, client_event_id HAVING COUNT(*) > 1;
SELECT session_id, client_event_id, COUNT(*) FROM proctorsnapshot
WHERE client_event_id IS NOT NULL GROUP BY session_id, client_event_id HAVING COUNT(*) > 1;
```

Do not delete evidence automatically. Export and reconcile duplicate rows with an operator-approved audit record, then apply the migration. A failed unique-index creation is intentionally a migration failure, not a warning to ignore.
