# Database migrations

Update the SQLModel in `app/db.py`, then run `alembic revision --autogenerate -m "describe change"`. Review the generated SQL for SQLite and Postgres, run `alembic upgrade head`, and commit the model plus revision. `init_db()` remains available for local SQLite and tests.

## Current status

Alembic is not initialised yet (there is no `alembic.ini` or `alembic/` folder), so production relies on `init_db()`, which creates tables and adds missing columns at startup. The Docker start command only runs `alembic upgrade head` when `alembic.ini` exists, so the server always starts.

To turn Alembic on later: `cd backend && alembic init alembic`, point `alembic/env.py` at `app.db.engine` and `SQLModel.metadata`, run `alembic revision --autogenerate -m "baseline"`, then `alembic stamp head` once against the production database.
