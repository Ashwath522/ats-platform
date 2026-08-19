# ATS Platform — Remaining Work

Repo: https://github.com/Ashwath522/ats-platform

Status update: items 1, 3, 4, 7, and 8 below are now fully verified — not
just statically reviewed, but actually run (pytest executed, live API calls
made against a running server, and a real browser driven through both tabs
including login and company deletion). See CHANGELOG.md for the two bugs
found and fixed in the process.

## 1. Frontend integration testing — DONE, verified for real
- Ran `uvicorn` + `vite` together, confirmed the `/api` proxy reaches the
  backend, and drove a real Chromium browser (Playwright) through both tabs:
  loaded the app, registered/logged in as a recruiter, created a company,
  posted a JD, and deleted the company — with screenshots confirming each
  screen rendered correctly. No console/page errors during any of this.
- This was NOT run against the real embedding model (see item 2) — a
  TF-IDF stub stood in for `sentence-transformers` for this pass only,
  since this sandbox can't reach huggingface.co. The API/DB/vector-store/
  auth wiring is confirmed correct regardless of which embedding backend
  is behind it.

## 2. Real embedding model download — still unverified
- Still unconfirmed in a real environment. Run the backend with normal
  internet access and confirm `all-MiniLM-L6-v2` downloads (~90MB, one
  time) and produces sane similarity scores.

## 3. Resume re-upload / deduplication — DONE, verified
- Confirmed via live test: uploading the same resume file twice returns
  the identical `resume_id` both times instead of creating a duplicate.

## 4. Auth / access control — DONE, verified (minimal)
- Confirmed via live test: unauthenticated/garbage-token requests to
  `/api/recruiter/*` return 401; register -> login -> authenticated
  create-company all work; duplicate username registration returns 409;
  wrong password returns 401.
- Found and fixed a real bug in this pass: `passlib` is incompatible with
  `bcrypt>=4.1` (raises `ValueError` on passwords over 72 bytes instead of
  truncating) — this was crashing 3 of the auth tests and would have
  crashed real registrations for long passwords. Pinned `bcrypt==4.0.1`
  and added explicit 72-byte truncation in `auth.py` as a backstop so this
  can't regress even if the pin is loosened later.
- Still intentionally minimal: no password reset, no email verification,
  no refresh tokens, no login rate limiting. Add before real multi-tenant
  deployment.

## 5. Optional LLM-generated improvement suggestions — not started
- If wanted: add a separate endpoint that takes the existing
  `missing_skills` list and calls an LLM once, cached per
  (resume_id, company_id) pair. Keep it out of the scoring hot path.

## 6. Skills vocabulary is a starting list — not started
- Still ~90 tech-focused skills. Expand for your target industries.

## 7. Company/JD management gaps — mostly done
- Delete button now exists in the frontend (RecruiterPage.jsx), wired to
  the `DELETE /api/recruiter/companies/{id}` endpoint. Verified via a real
  browser test: create a company, click Delete, confirm the dialog, list
  refreshes and the company is gone.
- Still missing: no JD history view in the UI (only the latest JD per
  company is ever shown/used — older ones are orphaned rows in the DB with
  no UI to browse them), no edit-in-place for company name.

## 8. Recruiter dashboard scaling — DONE, verified
- Confirmed via live test with `top_k`/`offset` params that pagination
  works and that matching-resumes responds correctly. The embedding-reuse
  fix (reading from Chroma instead of recomputing every request) was
  reviewed in code; not separately load-tested at scale.

## 9. File validation & limits — DONE (partially), not separately tested
- Extension allowlist and 8MB streamed size limit are implemented in
  candidate.py. Not explicitly exercised this session (no oversized or
  wrong-extension file was uploaded in testing) — worth a quick manual
  check before relying on it.
- Still missing: real MIME/content-type sniffing (would need
  `python-magic` + libmagic). Corrupted/password-protected PDFs still just
  fail with a generic "could not extract text" error.

## 10. Deployment — DONE (base setup), not run
- `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, and
  root `docker-compose.yml` exist. Not built or run this session (no
  Docker available in this sandbox) — build and run `docker compose up`
  once to confirm before relying on it.
- `CORS_ORIGINS` and `JWT_SECRET_KEY` are environment-configurable.
- Still missing: CI/CD, TLS termination, secrets manager integration.

## 11. Tests — DONE, verified
- `backend/tests/test_scoring.py` and `backend/tests/test_auth.py`: all 16
  tests actually executed via `pytest` and passing (after the bcrypt fix
  in item 4).
- Still missing: integration tests hitting the actual FastAPI endpoints
  end-to-end (would need `httpx.AsyncClient` + a test DB — the live curl/
  browser testing this session covered this manually but it isn't
  automated), and any frontend component tests.

---
Recommended next steps, in priority order:
1. Confirm the real embedding model (item 2) downloads and scores
   sensibly with actual internet access — this is the only piece that
   couldn't be verified at all in this sandbox.
2. Build and run the Docker setup once (item 10) to confirm it actually
   starts both containers and they can talk to each other.
3. Add a JD history view (item 7) if you want recruiters to see past
   postings, not just the current one.
4. Everything else is either done-and-verified or a deliberate scope cut
   documented above (auth hardening, LLM suggestions, MIME sniffing).
