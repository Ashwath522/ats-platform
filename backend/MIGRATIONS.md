# Database migrations

Update the SQLModel in `app/db.py`, then run `alembic revision --autogenerate -m "describe change"`. Review the generated SQL for SQLite and Postgres, run `alembic upgrade head`, and commit the model plus revision. `init_db()` remains available for local SQLite and tests.
