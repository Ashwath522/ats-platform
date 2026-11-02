#!/bin/sh
# Container entrypoint. Fail-closed: if migrations fail, the script exits with
# Alembic's exit code and the API is never started against a partial schema.
set -eu
cd "$(dirname "$0")"
echo "[start] applying database migrations (alembic upgrade head)"
alembic upgrade head
echo "[start] migrations applied; starting API"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers "${WEB_CONCURRENCY:-1}" --proxy-headers --forwarded-allow-ips='*'
