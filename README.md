# ATS Platform

## Verified current state

This has grown well past a resume-scoring tool into a full candidate/
recruiter portal. As of this doc's commit:

**Core ATS scoring** (the original feature)
- Fast, LLM-free scoring: local `sentence-transformers` embeddings +
  keyword matching. Skills vocabulary covers 6 branches (Software,
  Mechanical, Civil, ECE, EEE, Aerospace) with real paragraph-length role
  JDs (`backend/app/services/role_templates.py`), not just bare titles.
- Dynamic vocabulary learning: unrecognized terms found in real resumes
  get tracked (`DiscoveredSkill` table) and promoted into matching once
  seen often enough — the vocabulary grows from real data, not just a
  hand-maintained list.
- Honest scoring: if a JD has no recognizable skills, `keyword_coverage`
  is `null` (not a misleading false 100%), and `jd_has_recognized_skills`
  tells the caller why.
- Optional, on-demand, cached LLM features — kept OUT of the fast scoring
  path: `/deep-analysis` (grammar/technical-depth/experience scores) and
  `/resume-suggestions` (concrete "add this" suggestions). Support both
  `GEMINI_API_KEY` and `ANTHROPIC_API_KEY`; gracefully degrade if neither
  is set.

**Candidate portal**
- Separate candidate auth (`candidate_auth.py`), profile with resume
  upload, branch selection, skills/experience/education
  (`candidate_profile.py`).
- Home feed of posts from all candidates (`candidate_posts.py`).
- Job browsing + apply with auto-scoring (`candidate_jobs.py`) —
  applying reuses the candidate's stored resume, scores it against the
  job automatically, and records an `Application` row.
- Location: geolocation-based "jobs near me" with haversine distance.

**Recruiter portal**
- Recruiter auth, ownership-scoped companies (one recruiter cannot
  see/edit/delete another's — this was a real security bug, found and
  fixed; `test_recruiter_ownership.py` proves it).
- Job posting CRUD (`recruiter_jobs.py`): create/edit/delete/list own
  jobs, view ranked applicants per job.

**Admin**
- `admin.py`: a public suggestion-box submission endpoint plus an
  admin-gated listing endpoint. Intentionally minimal (see Known
  limitations below).

**Security / validation**
- Real content-based MIME validation (`mime_check.py`, libmagic) — a
  `.txt` renamed to `.pdf` is rejected, not trusted.
- Rate limiting on auth endpoints (`slowapi`), disabled during tests via
  a `TESTING` env-var guard.
- 8MB upload size limit, resume dedup by SHA-256 content hash.

**Tests**: 44 tests across 9 files (`backend/tests/`) — scoring, auth,
ownership, MIME validation, portal (haversine/tokens/admin), deep
analysis, suggestions/vocab learning, candidate API. Run `pytest` to
confirm the current pass count; don't trust this number blindly after
further changes.

**Docker**: `backend/Dockerfile`, `frontend/Dockerfile`,
`frontend/nginx.conf`, root `docker-compose.yml` all exist.

**WebView integration**: `WEBVIEW_INTEGRATION.md` documents the contract
for embedding this web app in the separate Flutter `Interface` repo.

## Known limitations — documented on purpose, not silent gaps

- **Auth is intentionally minimal**: no email verification, no password
  reset flow, no refresh tokens (see the comment in `backend/app/auth.py`
  itself). Fine for a project/demo; add before any real multi-tenant
  deployment.
- **SQLite + ad-hoc migrations**: schema changes are applied via raw
  `ALTER TABLE` statements in `db.py`'s startup path (e.g.
  `owner_username`, `apply_url` columns), not a real migration tool like
  Alembic. Works for a single-file demo DB; would need a proper migration
  story before running against a shared production database.
- **No CI currently running**: `.github/workflows/ci.yml` exists in this
  repo's working tree but has repeatedly failed to push — the GitHub
  token used in this project's development sessions lacks the `workflow`
  scope required to push changes under `.github/workflows/`. The file is
  written and correct; someone with appropriate token permissions (or via
  the GitHub web UI directly) needs to add it.
- **Frontend has no component library or state management library** —
  plain React `useState`/`useEffect` throughout, custom CSS. Functional
  and reasonably styled, not built on top of a design system.
- **A few rough edges remain**: no JD history view (only the latest JD
  per job/company is used or shown), backend integration tests exist but
  aren't exhaustive, no frontend component tests at all, and PDF
  extraction handles the common cases (multi-column templates, corrupted/
  password-protected files) but hasn't been stress-tested against a wide
  variety of real-world resume templates.

## Why this architecture

Core ATS scoring is done **without any LLM call** in the hot path, for
latency:
- Semantic similarity via a local `sentence-transformers` embedding model
  (`all-MiniLM-L6-v2`), running on CPU in milliseconds.
- Keyword/skill-gap detection via a branch-scoped skills vocabulary,
  expanded over time by real resume data (see Dynamic vocabulary
  learning above).
- Both signals blend into a single 0–100 `ats_score`.

Deep analysis and resume suggestions are intentionally separate from that
hot path — on-demand LLM calls, cached per (resume, target) pair, only
triggered when a candidate explicitly asks for them.

## Stack

- **Backend**: FastAPI, SQLModel (SQLite), ChromaDB for vector search,
  sentence-transformers for embeddings, python-jose + bcrypt for auth,
  slowapi for rate limiting, python-magic for real file-content
  validation, Anthropic/Gemini for optional LLM features.
- **Frontend**: React + Vite.

## Running locally

### Backend
```bash
cd backend
cp .env.example .env   # then edit JWT_SECRET_KEY to a real random value
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
First run downloads the `all-MiniLM-L6-v2` model from Hugging Face
(~90MB) — needs normal internet access once.

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Visit `http://localhost:5173`. The Vite dev server proxies `/api` calls
to `http://localhost:8000`.

### Tests
```bash
cd backend
pytest
```
44 tests across 9 files: `test_scoring.py` (scoring math + branch
vocabulary), `test_auth.py` (password hashing + JWT), `test_deep_analysis.py`
(parser + no-key behavior), `test_suggestions_and_vocab.py` (resume
suggestions + dynamic vocab learning), `test_mime_check.py` (real
content-based file validation), `test_recruiter_ownership.py` (the
ownership/IDOR fix), `test_portal.py` (haversine distance, token roles,
admin flow), `test_candidate_api.py` (branches/companies endpoints).

## Running with Docker

```bash
cp .env.example .env   # then edit JWT_SECRET_KEY
docker compose up --build
```
Frontend: `http://localhost:8080` · Backend: `http://localhost:8000`.
Data persists in the `ats_data` volume across restarts.

## Auth

Both candidate and recruiter accounts use JWT bearer tokens, issued from
separate register/login endpoint pairs:
- `POST /api/recruiter/auth/register`, `/api/recruiter/auth/login`
- `POST /api/candidate/auth/register`, `/api/candidate/auth/login`

Send the token as `Authorization: Bearer <access_token>`. Tokens embed a
`role` claim (`recruiter` or `candidate`) so protected endpoints reject
the wrong role, not just "not logged in." Tokens expire after 24h.
Intentionally minimal — see Known limitations above.

## API overview

**Candidate — scoring** (no auth)
- `GET /api/candidate/branches`, `GET /api/candidate/roles?branch=`
- `POST /api/candidate/ats-score` — generic check (multipart: `file` +
  `role_id` or `job_description`)
- `POST /api/candidate/ats-score-existing-resume` — same, for a resume
  already indexed (e.g. from a profile)
- `GET /api/candidate/companies`, `POST /api/candidate/ats-score-for-company`
- `POST /api/candidate/deep-analysis`, `POST /api/candidate/resume-suggestions`
  — on-demand, cached LLM calls (multipart: `resume_id` + one of
  `role_id`/`company_id`/`job_description`)

**Candidate — portal** (bearer token, `role=candidate`)
- `GET/PUT /api/candidate/profile`, `POST /api/candidate/profile/resume`
- `GET/POST /api/candidate/posts` — home feed
- `GET /api/candidate/jobs`, `GET /api/candidate/jobs/{id}`,
  `POST /api/candidate/jobs/{id}/apply`,
  `GET /api/candidate/jobs/applications/mine`

**Recruiter — companies/scoring** (bearer token, `role=recruiter`,
ownership-scoped)
- `POST /api/recruiter/companies`, `DELETE /api/recruiter/companies/{id}`
- `POST /api/recruiter/companies/{id}/job-description`
- `GET /api/recruiter/companies/{id}/matching-resumes?top_k=&offset=`

**Recruiter — jobs** (bearer token, `role=recruiter`)
- `POST /api/recruiter/jobs`, `GET /api/recruiter/jobs`,
  `PUT /api/recruiter/jobs/{id}`, `DELETE /api/recruiter/jobs/{id}`
- `GET /api/recruiter/jobs/{id}/applicants` — ranked

**Admin**
- `POST /api/suggestions` (public) — submit feedback
- `GET /api/admin/suggestions` (admin-gated) — list submissions

## Resume upload limits & validation

- Allowed types: `.pdf`, `.docx`, `.doc`, `.txt`
- Real content validation: extension check, then actual byte-content
  sniffed via `python-magic`/libmagic and compared against what the
  extension claims (`backend/app/services/mime_check.py`)
- Max size: 8MB, streamed to disk (never buffers the whole file in memory)
- Duplicate content detected by SHA-256 hash of extracted text — reuses
  the existing entry instead of creating a duplicate
