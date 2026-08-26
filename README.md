# ATS Platform

**Note for the next agent working on this repo:** `main` was force-pushed at
one point during development, which discarded some prior work (a real
content-based MIME validation module, a CI workflow). That work has since
been restored/re-added where it mattered for correctness. Do not assume
anything about git history beyond `main`'s current tip — always check
`git log`, run `pytest`, and verify against actual file contents before
building on top of a claim in this doc. This section is accurate as of the
commit it's part of, not a permanent guarantee.

## Verified current state

- **Recruiter auth**: real (JWT + bcrypt, `backend/app/auth.py` +
  `backend/app/api/auth.py`), rate-limited via `slowapi`, and
  ownership-scoped (one recruiter cannot see/edit/delete another
  recruiter's companies — this was a real security bug, found and fixed;
  `backend/tests/test_recruiter_ownership.py` proves it).
- **Resume dedup**: by SHA-256 content hash, in
  `backend/app/api/candidate.py`.
- **File upload validation**: extension allowlist + 8MB streamed size
  limit (never buffers the whole file in memory). Content-based MIME
  sniffing via `python-magic`/libmagic is implemented in
  `backend/app/services/mime_check.py` and works when libmagic is
  installed — a spoofed extension (e.g. a `.txt` renamed to `.pdf`) is
  rejected. When libmagic is **not** installed the check degrades
  gracefully (extension-only validation still applies, MIME sniffing is
  skipped). 4 tests in `test_mime_check.py` cover this and are skipped
  when libmagic is absent.
- **Branch/role selection**: `GET /api/candidate/branches` +
  `GET /api/candidate/roles?branch=` cover Software, Mechanical, Civil,
  ECE, EEE, and Aerospace, each with real paragraph-length JDs (see
  `backend/app/services/role_templates.py`), not just bare titles.
- **Deep analysis**: `POST /api/candidate/deep-analysis` — optional,
  on-demand, cached LLM call (grammar/technical-depth/experience scoring)
  kept OUT of the fast scoring path. Defaults to **local Ollama** (e.g. `llama3.2`) if available, falls back gracefully to Google Gemini (free tier) if `GEMINI_API_KEY` is set, or degrades gracefully if neither is present.
- **Docker**: `backend/Dockerfile`, `frontend/Dockerfile`,
  `frontend/nginx.conf`, root `docker-compose.yml` all exist.
- **Tests**: `backend/tests/` — comprehensive test suite across scoring, auth, ownership, recruiter approval flow, OTP/password-reset, MIME validation, portal helpers, vocab learning, and API integration. Run `pytest` to confirm current pass count.
- **Candidate portal**: candidate auth, profile/resume management, job
  browsing, applications, posts/feed, and contact/profile screens are
  present in the backend routers and frontend routes.
- **Recruiter job postings**: approved recruiters can create/manage jobs
  and review applicants in addition to the original company/JD matching
  workflow. Features edit-in-place company names.
- **CI**: GitHub Actions workflow `.github/workflows/ci.yml` runs pytest and builds the frontend on every push/PR to main.
- **Frontend**: Clean LinkedIn blue (`#0A66C2`) design system, global TopNav, tabbed AdminPage, SVG icons.

Resume screening system with these main flows:

1. **Branch/role ATS check** — upload a resume + choose a branch and role template, or paste any custom job description, then get an ATS score and missing keywords/skills.
2. **Company-specific ATS check** — candidate selects a company from a list; gets scored against that company's *current* job title/description.
3. **Recruiter dashboard** (auth required) — approved recruiters post/update a company's job description; see all indexed resumes ranked by match score. Updating the JD immediately re-ranks candidates — no manual resync step.
4. **Candidate portal** — candidates sign up/login, maintain a profile and resume, browse jobs, apply, view suggestions, and post updates.
5. **Admin approval queue** — recruiter signups enter a pending request table; admins approve/reject requests and approved recruiters receive generated credentials by email.

## Core Branches

The system supports specialized role templates and ATS scoring for the following core engineering disciplines:
- **Software** (CS / Software)
- **Mechanical** (Mechanical)
- **Civil** (Civil)
- **Chemical** (Chemical)
- **ECE** (Electronics & Communication)
- **EEE** (Electrical)
- **Aerospace** (Aerospace)

When a candidate's submitted project is evaluated, the final blended score is determined by the formula: `Final Score = 0.4 * ATS Score + 0.6 * Project Score`.

## Generating Demo Data

To populate the database with a full set of realistic demo data (Admin, Recruiters, Candidates, varied Jobs, dynamic PDF resumes, and scored applications):

```bash
cd backend
venv/bin/pip install -r requirements.txt
PYTHONPATH=. venv/bin/python scripts/seed_demo_data.py
```
This will automatically generate realistic PDF resumes, process them through the actual ATS machine-learning embedding pipeline, simulate applications, and output login credentials to a local `demo_credentials.md` file at the repository root.

## Architecture

Scoring is done **without any LLM call** in the hot path, for latency:
- Semantic similarity via a local `sentence-transformers` embedding model (`all-MiniLM-L6-v2` by default, or configurable via `EMBEDDING_MODEL`), running on CPU in milliseconds.
- Keyword/skill-gap detection via a curated skills vocabulary matched against resume/JD text, plus heuristic extraction of technical tokens from raw JD text.
- Both signals are blended into a single calibrated 0–100 `ats_score` (approx 55% semantic, 45% skill coverage + experience fit), with strong matches landing in the competitive 75–90 range.

Deep analysis is intentionally separate from that hot path. `POST /api/candidate/deep-analysis` can be triggered on demand after scoring and performs one cached LLM call.

## Stack

- **Backend**: FastAPI, SQLModel (SQLite) for users, recruiter requests, companies, JDs, resumes, email tokens, and analysis cache; ChromaDB for vector search; sentence-transformers for embeddings; python-jose + bcrypt for auth; SMTP for email; Ollama or Gemini for optional deep analysis.
- **Frontend**: React + Vite, pure CSS (LinkedIn blue design system).

## Running locally

### Backend
```bash
cd backend
cp .env.example .env   # then edit JWT_SECRET_KEY to a real random value
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
First run will download the embedding model from Hugging Face (~90MB). Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to bootstrap the first admin account.

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

## Running with Docker

```bash
cp .env.example .env   # then edit JWT_SECRET_KEY
docker compose up --build
```
Frontend: `http://localhost:8080` · Backend: `http://localhost:8000`. Data (SQLite + Chroma + uploaded resumes) persists in the `ats_data` volume across restarts.

## Auth And Email

Auth uses the shared `User` table and JWTs with a `role` claim: `candidate`, `recruiter`, or `admin`.

- Candidate signup: `POST /api/auth/register` creates a candidate user and sends a 6-digit OTP.
- OTP verification: `POST /api/auth/verify-otp` verifies the candidate email and returns a bearer token.
- Login: `POST /api/auth/login` accepts email/password and routes by JWT role on the frontend.
- Password reset: `POST /api/auth/password-reset/request` and `POST /api/auth/password-reset/confirm` use 15-minute reset tokens.
- Recruiter access: `POST /api/recruiter-requests` creates a pending request; it does not create a user.
- Admin review: admins approve/reject pending recruiter requests via `AdminPage`. Approval creates a recruiter user with a generated password and emails credentials.

SMTP is configured with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_APP_PASSWORD`, and optional `SMTP_FROM`. `DEV_MODE=false` by default. If `DEV_MODE=true` and SMTP is unset/fails, OTPs/reset tokens/generated recruiter passwords are returned in the API response under `dev_only` for demos.

## Resume upload limits

- Allowed types: `.pdf`, `.docx`, `.doc`, `.txt` (checked by extension; rejected with 400 otherwise)
- Max size: 8MB (streamed to disk in chunks, rejected with 413 if exceeded — never buffers the whole file in memory)
- Duplicate content (same resume text, re-uploaded via either flow) is detected by SHA-256 hash of the extracted text and reuses the existing entry instead of creating a duplicate DB row + vector

## Status / next steps

- **Embedding model**: configurable via `EMBEDDING_MODEL` env var.
- Scoring pipeline features semantic similarity, keyword matching, JD text extraction, experience fit, and score calibration.
- Deep analysis uses Ollama natively (fallback to Gemini).
- UI is upgraded to a professional LinkedIn blue design system.
- Recruiter endpoints require recruiter role auth; admin endpoints require admin role auth.
- Recruiter approval flow is fully implemented and tested.
- File validation, deduplication, Docker, and GitHub Actions CI are present.
- Still unverified: Docker runtime, real SMTP mailbox delivery, and remote CI status.
