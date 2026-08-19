# Changelog

## Unreleased — branch roles, deep analysis, auth, dedup, dashboard scaling

**Breaking change:** if you have an existing `backend/data/ats.db` from
before this change, delete it (or migrate manually) — the new
`Resume.content_hash` column and `RecruiterUser` table won't be added to an
existing SQLite file automatically.

**Breaking change:** the Recruiter tab now requires logging in / creating an
account first. All `/api/recruiter/*` endpoints except `/auth/register` and
`/auth/login` now require an `Authorization: Bearer <token>` header.

### Added
- Recruiter auth: register/login issuing a 24h JWT (`backend/app/auth.py`,
  `backend/app/api/auth.py`). Passwords hashed with direct `bcrypt`.
- Branch-scoped candidate role templates for software, Mechanical, Civil,
  ECE, EEE, and Aerospace.
- `GET /api/candidate/branches` and branch-filtered
  `GET /api/candidate/roles?branch=...`.
- Cached `POST /api/candidate/deep-analysis` for grammar, technical depth,
  experience, and summary analysis using one optional Anthropic call.
- Candidate UI branch/role selector and full-analysis panel.
- Resume dedup by content hash (SHA-256 of extracted text) in
  `_save_and_index_resume` — re-uploading the same resume reuses the
  existing entry instead of creating a duplicate.
- File upload validation: extension allowlist + 8MB streamed size limit
  (`backend/app/api/candidate.py`).
- `DELETE /api/recruiter/companies/{id}` endpoint.
- Pagination on `GET /api/recruiter/companies/{id}/matching-resumes`
  (`top_k`, `offset`).
- `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, root
  `docker-compose.yml` with a persisted data volume.
- `CORS_ORIGINS` and `JWT_SECRET_KEY` environment variables (loaded via
  `python-dotenv`, which was already a dependency but wasn't actually wired
  up before this change).
- `backend/tests/test_scoring.py`, `backend/tests/test_auth.py`, and
  `backend/tests/test_deep_analysis.py`.
- Recruiter frontend: login/register panel, JWT stored in `localStorage`,
  `Authorization` header attached to all protected requests, auto-logout on
  401.

### Changed
- `matching-resumes` no longer recomputes an embedding for every resume on
  every request — it now reuses each resume's embedding as stored in Chroma
  at upload time (`vector_store.query_collection` now returns `embeddings`
  too). This was the main scaling bottleneck on the recruiter dashboard.
- CORS origins are now configurable instead of hardcoded to `"*"`.

### Fixed
- A docstring in `candidate.py` claimed the wrong return order for
  `_save_and_index_resume` (cosmetic only, didn't affect behavior).

## Verified this session
Ran the full suite for real instead of trusting it: `pytest` (16/16 passing),
live curl tests of auth/dedup/pagination/delete against a running server, and
a full browser pass (Playwright) through both tabs including actual login,
company creation, and company deletion via the UI. Screenshots confirmed
correct rendering at each step.

### Fixed
- `passlib` + modern `bcrypt` incompatibility on Python 3.14 by switching
  auth hashing to direct `bcrypt` calls with explicit 72-byte truncation.
- Non-production environments keep a dev JWT fallback; non-debug production
  environments fail loudly if `JWT_SECRET_KEY` is still a placeholder.
- Frontend: added the missing "Delete" button on each company row in the
  recruiter dashboard, wired to the `DELETE /api/recruiter/companies/{id}`
  endpoint that already existed but nothing called. Confirmed working via a
  full create → delete → list-refreshes-correctly browser test.

### Not done in this pass
- Real MIME/content-type sniffing (extension-based validation only).
- Real Anthropic API verification for deep analysis.
- Expanded automated API/browser coverage for the new candidate flow.
- JD history UI, company rename, delete-company button in the frontend
  (the DELETE endpoint exists; nothing calls it yet).
- Integration tests against the live API, frontend component tests.
- CI/CD, TLS termination, secrets manager integration.
