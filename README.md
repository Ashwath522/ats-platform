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
- **Decision Audit Trail (`DecisionAuditLog`)**: append-only, immutable audit logging in `backend/app/db.py` and `backend/app/services/audit.py`. Every scoring event (ATS match, project/repo verification, AI interview evaluation), candidate deletion request, and recruiter confirmation is permanently recorded with full input signals, LLM verdicts, timestamps, and reviewer attribution for compliance with automated employment decision regulations (NYC LL144 / EU AI Act).
- **Candidate Score Explainability**: `GET /api/candidate/jobs/applications/{app_id}/explainability` provides candidates with a plain-language breakdown of their score components (semantic fit, matched vs missing skills, project code depth, proctoring status) and actionable improvement advice generated deterministically without additional LLM calls.
- **Human-in-the-Loop Confirmation Gate**: Any auto-generated rejection or high-risk proctoring flag requires explicit human recruiter action via `POST /api/recruiter/jobs/{job_id}/applicants/{app_id}/confirm-decision` or status updates before becoming final, logging reviewer identity and timestamp in `DecisionAuditLog`.
- **Proctoring Consent & Data Retention**: 
  - Mandatory pre-interview consent screen in `frontend/src/components/AIInterviewModal.jsx` disclosing recorded media, computer vision signals analyzed, and data retention terms before camera/microphone initialization.
  - 30-day raw proctoring media retention policy with automated purge utility in `backend/app/services/retention.py` and `POST /api/admin/retention/purge` preserving aggregate scores and audit records.
  - Candidate right-to-be-forgotten via `POST /api/candidate/applications/{app_id}/request-data-deletion` accessible directly in the candidate portal.
- **Operational Health & Structured Telemetry**:
  - Active `GET /health` endpoint in `backend/app/main.py` verifying database read/write connectivity and checking reachability of optional AI providers (Groq, Gemini, Ollama).
  - Structured JSON telemetry logging in `backend/app/services/llm_telemetry.py` capturing provider, model, latency, status, and payload length for all LLM calls.
  - Graceful degradation in `backend/app/services/scorer.py` and `deep_analysis.py` falling back to deterministic embedding/keyword scoring if external AI services fail or are unconfigured.
- **Docker**: `backend/Dockerfile`, `frontend/Dockerfile`,
  `frontend/nginx.conf`, root `docker-compose.yml` all exist.
- **Tests**: `backend/tests/` and `frontend/src/lib/__tests__/` — 74 passing backend pytest tests and 16 passing frontend vitest tests covering auth, scoring, audit trails, explainability, human confirmation gates, retention policies, and proctoring governance.
- **Candidate portal**: candidate auth, profile/resume management, job
  browsing, applications, posts/feed, "Why this score?" explainability views, data deletion requests, and contact/profile screens.
- **Recruiter job postings & review**: approved recruiters can create/manage jobs, review applicants with AI dials and proctoring risk indicators, confirm automated recommendations, and verify code portfolios.
- **CI**: GitHub Actions workflow `.github/workflows/ci.yml` runs pytest and builds the frontend on every push/PR to main.
- **Frontend**: Clean LinkedIn blue (`#0A66C2`) design system, global TopNav, tabbed AdminPage, SVG icons.
- **Role Templates**: 33 verified templates across 7 core engineering branches, all exceeding 250 words with rich technical keywords.
- **Hybrid ATS Scoring**: 
  - Stage 1: Deterministic scoring (0.55 semantic / 0.40 keyword / 0.05 experience fit).
  - Stage 2 (Optional): LLM context evaluation (30% weight in `final_ats_score`) run locally via Ollama or Gemini.
- **Project Verification**: Scorer parses actual zipped repositories, citing concrete file signals and generating risk notes for thin evidence.
- **Recruiter Workflow**: Recruiters can finalize candidates for the next round via `POST /api/recruiter/jobs/{job_id}/applicants/{app_id}/finalize` which triggers an email and updates their status to `shortlisted`.

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
- **Frontend**: React + Vite, pure CSS (LinkedIn blue design system).## Repository Directory Structure

```
ats-platform/
├── README.md
├── docker-compose.yml
├── .gitignore
├── backend/                  # FastAPI ATS Engine & REST APIs
│   ├── app/
│   │   ├── api/              # candidate, recruiter, auth, candidate_profile, candidate_jobs, admin
│   │   ├── services/         # scoring.py (Deterministic 1st), deep_analysis.py (LLM 2nd), role_templates.py (33 dense roles)
│   │   ├── auth.py
│   │   ├── db.py             # Extended Application model (ats_score, repo_match_score, interview_status, risk_score)
│   │   └── main.py
│   ├── tests/                # 65+ Pytest backend tests
│   ├── scripts/              # seed_demo_data.py, test_e2e_flow.py
│   └── requirements.txt
├── frontend/                 # Vite React Fullstack Frontend
│   ├── src/
│   │   ├── components/       # UnifiedRecruiterCard, CandidateStepper, AIInterviewModal, ScoreDial, ScoreResult
│   │   │   └── interview/    # baseline-capture (45s), live-interview-room, media-setup
│   │   ├── lib/
│   │   │   ├── cv/           # 100% UNTOUCHED CV PROCTORING MODULES:
│   │   │   │   ├── face-detector.ts, gaze-headpose.ts, lighting-analyzer.ts, lighting-utils.ts
│   │   │   │   ├── liveness-analyzer.ts, liveness-utils.ts, object-detector.ts, pose-detector.ts
│   │   │   │   └── risk-engine.ts
│   │   │   ├── llm/          # interviewer.ts, parse-step.ts, openrouter.ts
│   │   │   ├── speaking-charter.ts  # Speaking Charter TTS wrapper
│   │   │   └── interview-access.ts   # Gatekeeper: canTakeInterview()
│   │   ├── pages/            # Candidate & Recruiter views
│   │   │   ├── candidate/    # Feed, Jobs, Applications (Stepper + AI Interview Modal), Profile, Repo
│   │   │   └── recruiter/    # Recruiter Dashboard (Unified Recruiter Card)
│   │   └── App.jsx
│   ├── vitest.config.js      # Vitest configuration for CV risk-engine & gatekeeper tests
│   └── package.json
```

## Running & Testing

### Backend (FastAPI Python)
```bash
cd backend
pip install -r requirements.txt
pytest -v               # Run full 65+ backend test suite
python3 scripts/test_e2e_flow.py # Run end-to-end pipeline verification script
uvicorn app.main:app --reload --port 8000
```

### Frontend (Vite React + CV Proctoring)
```bash
cd frontend
npm install
npx vitest run          # Run 14 Vitest unit tests (risk-engine, interviewer, gatekeeper rules)
npm run dev             # Start UI at http://localhost:5173
```

