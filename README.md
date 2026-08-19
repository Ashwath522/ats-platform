# ATS Platform

**Note for the next agent working on this repo:** `main` was force-pushed at
one point during development, which discarded some prior work (a real
content-based MIME validation module, a CI workflow). That work has since
been restored/re-added where it mattered for correctness. Do not assume
anything about git history beyond `main`'s current tip — always check
`git log`, run `pytest`, and verify against actual file contents before
building on top of a claim in this doc. This section is accurate as of the
commit it's part of, not a permanent guarantee.

## Verified current state (candidate/recruiter ATS tool only — no portal yet)

- **Recruiter auth**: real (JWT + bcrypt, `backend/app/auth.py` +
  `backend/app/api/auth.py`), rate-limited via `slowapi`, and
  ownership-scoped (one recruiter cannot see/edit/delete another
  recruiter's companies — this was a real security bug, found and fixed;
  `backend/tests/test_recruiter_ownership.py` proves it).
- **Resume dedup**: by SHA-256 content hash, in
  `backend/app/api/candidate.py`.
- **File upload validation**: extension allowlist AND real content-based
  MIME sniffing via `python-magic`/libmagic
  (`backend/app/services/mime_check.py`) — a spoofed extension (e.g. a
  `.txt` renamed to `.pdf`) is rejected, not silently trusted. 8MB size
  limit, streamed to disk (never buffers the whole file in memory).
- **Branch/role selection**: `GET /api/candidate/branches` +
  `GET /api/candidate/roles?branch=` cover Software, Mechanical, Civil,
  ECE, EEE, and Aerospace, each with real paragraph-length JDs (see
  `backend/app/services/role_templates.py`), not just bare titles.
- **Deep analysis**: `POST /api/candidate/deep-analysis` — optional,
  on-demand, cached LLM call (grammar/technical-depth/experience scoring)
  kept OUT of the fast scoring path. Gracefully degrades if
  `ANTHROPIC_API_KEY` isn't set.
- **Docker**: `backend/Dockerfile`, `frontend/Dockerfile`,
  `frontend/nginx.conf`, root `docker-compose.yml` all exist.
- **Tests**: `backend/tests/` — 30 tests across scoring, auth, ownership,
  MIME validation, and API integration. Run `pytest` to confirm current
  pass count, don't trust this number blindly after further changes.
- **NOT present yet**: candidate accounts/profiles, a job board, job
  postings, applications, posts, GPS/location matching, or any 4-tab
  candidate navigation. The only "candidate" concept right now is an
  anonymous resume upload — there is no candidate login, no persistent
  candidate identity, and no portal UI beyond the existing single-page ATS
  checker. If you're building the portal expansion (candidate/recruiter
  accounts, job postings, applications, profiles), all of that is new
  work on top of this — don't assume any of it exists already.
- **CI**: a GitHub Actions workflow may or may not be present depending on
  push history (a token scope issue previously blocked pushing
  `.github/workflows/`) — check `.github/workflows/` directly rather than
  assuming.

Resume screening system with three flows:

1. **Branch/role ATS check** — upload a resume + choose a branch and role template, or paste any custom job description, then get an ATS score and missing keywords/skills.
2. **Company-specific ATS check** — candidate selects a company from a list; gets scored against that company's *current* job title/description.
3. **Recruiter dashboard** (auth required) — recruiter posts/updates a company's job description; sees all indexed resumes ranked by match score. Updating the JD immediately re-ranks candidates — no manual resync step.

## Why this architecture

Scoring is done **without any LLM call** in the hot path, for latency:
- Semantic similarity via a local `sentence-transformers` embedding model (`all-MiniLM-L6-v2`), running on CPU in milliseconds.
- Keyword/skill-gap detection via a curated skills vocabulary matched against resume/JD text.
- Both signals are blended into a single 0–100 `ats_score`.

Deep analysis is intentionally separate from that hot path. `POST /api/candidate/deep-analysis` can be triggered on demand after scoring and performs one cached LLM call for grammar, technical depth, and experience assessment. If `ANTHROPIC_API_KEY` is not set, the endpoint returns a graceful `llm_configured: false` response.

## Stack

- **Backend**: FastAPI, SQLModel (SQLite) for companies/JDs/resumes/recruiter accounts/analysis cache, ChromaDB for vector search, sentence-transformers for embeddings, python-jose + bcrypt for auth, Anthropic for optional deep analysis.
- **Frontend**: React + Vite.

## Running locally

### Backend
```bash
cd backend
cp .env.example .env   # then edit JWT_SECRET_KEY to a real random value
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
First run will download the `all-MiniLM-L6-v2` model from Hugging Face (~90MB) — needs normal internet access once.

**Upgrading from a version without auth/dedup?** Delete `backend/data/ats.db` (or run a real migration) before starting — the new `Resume.content_hash` column and `RecruiterUser` table aren't added to an existing SQLite file automatically.

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Visit `http://localhost:5173`. The Vite dev server proxies `/api` calls to `http://localhost:8000`.

### Tests
```bash
cd backend
pytest
```
`test_scoring.py` covers scoring math and branch vocabulary with no external services. `test_deep_analysis.py` covers parser/no-key behavior. `test_auth.py` covers password hashing + JWT.

## Running with Docker

```bash
cp .env.example .env   # then edit JWT_SECRET_KEY
docker compose up --build
```
Frontend: `http://localhost:8080` · Backend: `http://localhost:8000`. Data (SQLite + Chroma + uploaded resumes) persists in the `ats_data` volume across restarts.

## Auth

Recruiter endpoints (create/delete company, post a JD, view matching resumes) require a bearer token:
- `POST /api/recruiter/auth/register` (`username`, `password`, min 8 chars) → `{access_token, token_type, username}`
- `POST /api/recruiter/auth/login` (`username`, `password`) → same shape

Send the token as `Authorization: Bearer <access_token>` on protected requests. Tokens expire after 24h. This is intentionally minimal (no password reset, no refresh tokens, no email verification) — add those before real multi-tenant use. Candidate-facing endpoints stay unauthenticated on purpose.

## API overview

**Candidate** (no auth)
- `POST /api/candidate/ats-score` — flow 1, generic check (multipart: `file`, `job_description`)
- `GET /api/candidate/branches` — list candidate branch options
- `GET /api/candidate/roles?branch=mechanical` — list role templates, optionally branch-scoped
- `POST /api/candidate/deep-analysis` — cached on-demand grammar/technical-depth/experience analysis (multipart: `resume_id` plus one of `role_id`, `company_id`, `job_description`)
- `GET /api/candidate/companies` — list companies with an open role
- `POST /api/candidate/ats-score-for-company` — flow 2 (multipart: `file`, `company_id`)

**Recruiter auth** (no auth required to call these)
- `POST /api/recruiter/auth/register` — create a recruiter account (`username`, `password`)
- `POST /api/recruiter/auth/login` — get a bearer token (`username`, `password`)

**Recruiter** (bearer token required)
- `POST /api/recruiter/companies` — create a company (`name`)
- `DELETE /api/recruiter/companies/{id}` — delete a company and its job descriptions
- `POST /api/recruiter/companies/{id}/job-description` — set/update JD (`title`, `description`)
- `GET /api/recruiter/companies/{id}/matching-resumes?top_k=20&offset=0` — flow 3, ranked candidates against the current JD, paginated

## Resume upload limits

- Allowed types: `.pdf`, `.docx`, `.doc`, `.txt` (checked by extension; rejected with 400 otherwise)
- Max size: 8MB (streamed to disk in chunks, rejected with 413 if exceeded — never buffers the whole file in memory)
- Duplicate content (same resume text, re-uploaded via either flow) is detected by SHA-256 hash of the extracted text and reuses the existing entry instead of creating a duplicate DB row + vector

## Status / next steps

- Scoring pipeline (embeddings + keyword gap) is tested at the pure-logic layer; verified against real execution in `backend/tests/test_scoring.py`.
- Branch-scoped role templates now cover CS/software, Mechanical, Civil, ECE, EEE, and Aerospace.
- On-demand deep analysis endpoint is implemented and tested for JSON parsing and no-key graceful behavior. A real Anthropic call still requires `ANTHROPIC_API_KEY`.
- Recruiter endpoints now require auth (see above). Candidate endpoints remain open.
- Resume dedup by content hash is implemented — see `_save_and_index_resume` in `backend/app/api/candidate.py`.
- Recruiter dashboard scaling: `matching-resumes` now reuses each resume's embedding from Chroma instead of recomputing it per request, plus basic `top_k`/`offset` pagination.
- File validation: extension allowlist + streamed size limit. Still missing: real content/MIME sniffing (would need `python-magic` + libmagic), and no handling yet for corrupted/password-protected PDFs beyond a generic extraction-failed error.
- Docker + docker-compose added for both services, with a persisted data volume. The embedding model still downloads on first request inside the container unless you bake it into the image (see comment in `backend/Dockerfile`).
- Skills vocabulary in `backend/app/services/skills_vocab.py` now includes software plus core engineering branch coverage and selected business skills.
- No JD history view, no company rename, no candidate-side identity/history tracking yet.
- Still unverified in this local pass: Docker runtime, real browser upload flow, real embedding-model download, real Anthropic API calls, and remote CI status.
