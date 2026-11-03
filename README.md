# CoreLink

**Hiring for core engineering students — mechanical, civil, electrical, electronics, chemical, aerospace, automobile and metallurgy.**

Most job platforms in India are built around software roles. If you study mechanical or civil engineering, you end up scrolling past hundreds of "React developer" posts to find two jobs that fit you. CoreLink started as my final-year project to fix that: one place where core engineering students can find real jobs and internships, check their resume against a specific role, practise interviews with an AI interviewer, prove their projects with evidence, and get noticed by recruiters who actually hire for core branches.

- **Website:** https://corelink-pi.vercel.app
- **API:** https://corelink-api-z66r.onrender.com (free tier — the first request after a quiet spell can take ~50 s while the server wakes up)
- **Cost to run:** ₹0 — every service used has a free tier.

> Built and maintained by **Ashwath M**. Feedback and issues are welcome.

---

## Contents

1. [What you can do](#what-you-can-do)
2. [Evidence-based project analysis](#evidence-based-project-analysis)
3. [Interview integrity (proctoring)](#interview-integrity-proctoring)
4. [Evaluation and accuracy](#evaluation-and-accuracy)
5. [Tech stack and architecture](#tech-stack-and-architecture)
6. [Running it locally](#running-it-locally)
7. [Configuration](#configuration)
8. [Deploying (free)](#deploying-free)
9. [Demo data](#demo-data)
10. [Project structure](#project-structure)
11. [Known limitations](#known-limitations) · [Roadmap](#roadmap) · [Privacy](#privacy) · [License](#license)

---

## What you can do

### Students
- **Sign in your way** — email + password, Google, LinkedIn, or Truecaller (one-tap phone verification on Android).
- **Import from LinkedIn** — paste your LinkedIn link (saved as a link, never scraped) and upload LinkedIn's *Save to PDF* export; we read it once to fill in headline, education, experience, skills and certifications, and you review everything before it's saved.
- **Resume & ATS check** — upload a PDF/DOCX resume and get a score with clear bars (content, skills, projects, certifications, format) and specific suggestions. Your last analysis and best-fit jobs show instantly and refresh in the background.
- **Match your resume to a job** — pick any job (or paste a job description from any site) and see your ATS score for *that* role: what matches, what's missing, skills on your profile but not in your resume, and what to change before applying.
- **Jobs that fit you** — every open job ranked by the same ATS score recruiters see, with one-click apply. Search and filters run in the database, with paging.
- **Live jobs from official sources** — Greenhouse, Lever, SmartRecruiters, Adzuna and Jooble. No LinkedIn scraping. Synced automatically every 6 hours.
- **Company directory** — top core-engineering companies with logos; follow a company to get notified when it posts a new role.
- **College picker** — 400+ Indian engineering colleges with logos.
- **AI interview practice with Aria** — a talking, lip-synced interviewer that asks branch-specific questions, listens to spoken answers (live captions) and gives rubric-based feedback.
- **Projects with evidence** — upload CAD files, drawings, circuits, code, notebooks, datasets, photos and a demo video, then press **Analyse project** to get an explainable report (see below).

### Recruiters
- Post jobs and internships; see applicants ranked by ATS score with matched / missing skills and real applicant names.
- Run AI interviews with proctoring, review the evidence timeline and trust panel, shortlist, schedule interviews and send offers.
- See a reduced project report for each applicant (scores, verified claims, findings — never raw files or video).
- Recruiter accounts are approved by an admin after company checks (email domain, website, GSTIN/CIN format).

### Admins
- Approve recruiters, manage users (including one-time temporary passwords when email can't be delivered), moderate projects, re-run project analysis, view the audit log.
- Live-data controls (sync now, sources, API key status) and system settings (announcement banner, support email, test email).
- **Demo data tools** — see [Demo data](#demo-data).

---

## Evidence-based project analysis

Students pick the project's engineering domain, upload evidence and press **Analyse project**. CoreLink reads every file, watches the demo video, checks every claim in the description against the evidence and builds **one report** (15 sections, downloadable as PDF) with an explainable score.

### What is read from the files

| Domain | Evidence understood |
|---|---|
| Mechanical | DXF drawings (layers, dimension values, notes such as material, tolerance, surface finish), STEP (part names, solids, assembly links, units), STL/OBJ (size, closed-solid check, volume). |
| Civil | IFC/BIM (walls, slabs, beams, columns, storeys, materials), DXF and PDF drawings. Safety and code-compliance claims are never marked verified. |
| Electronics | KiCad schematic / netlist / PCB, Wokwi `diagram.json`, TinkerCAD JSON, Arduino/ESP code (pins, libraries, serial, Wi-Fi/MQTT). Code pins are cross-checked against the real wiring. |
| Robotics / IoT | Electronics + software, plus MQTT topics and the sensor → controller → actuator chain. |
| Software | Source files and ZIPs (imports, API routes, tests, TODOs), dependency files and the linked GitHub repo (languages, tests, CI, commit authors, forks). |
| AI / ML | Notebooks (models, metrics printed in outputs, leakage/evaluation risks) and CSV datasets (rows, missing values, duplicates, class balance). Claimed metrics are compared with the real outputs. |

### Pipeline

```
files ──► validate ──► extract facts (server-side parsers, code never executed)
photos/video ──► Gemini vision (YouTube link, or 12 key frames chosen in the browser)
                       │
                       ▼
          domain analyser → engineering findings
                       │
description ──► claims: extract (AI, or sentence rules) ──► verify against evidence (AI, or keyword rules)
                       │
                       ▼
   deterministic rules ALWAYS run last and override the AI:
   • claimed metric ≠ measured metric           → contradicted
   • claimed size ≠ size written on the drawing → contradicted
   • civil safety / code claims                 → never verified
   • "verified" needs at least one server-parsed, high-confidence fact
                       │
                       ▼
       rubric scoring per domain (same input → same score) → report + PDF
```

### How it stays honest
- Every fact in the report links back to a file, a video timestamp or the student's own words. Values read by AI from photos or video are marked *medium confidence*.
- **Verified** = server-parsed evidence supports the claim. **Partially verified** = some support. **Unverified** = no evidence (never treated as a fail). **Contradicted** = the files say something different.
- AI is used only to list claims, match claims to evidence and watch photos/video. Without AI keys everything still works with simpler claim matching.
- AI model names are discovered from each provider's live model list, so retired models (for example `gemini-2.5-flash`, `llama-3.3-70b-versatile`) are replaced automatically and the request is retried once.
- Demo videos: an Unlisted YouTube link is watched directly, or only 12 key frames chosen in the browser are uploaded. A random 4-digit challenge code must be said or shown in the video.
- Jobs are de-duplicated by an input hash; re-analysing unchanged evidence returns the same report.
- The **Verified** badge on a profile is still given by a human admin.
- Limits: 10 files per project, 15 MB each, 60 MB total; 40 AI calls per day and 5 analyses per student per day by default. Not supported: DWG and native SolidWorks/Fusion files (export DXF/STEP/STL instead).

### Run an analysis without the website

```bash
cd backend
python scripts/analyse_local.py --domain mechanical --title "Motor Mounting Flange Plate" \
  --desc path/to/description.txt path/to/drawing.dxf path/to/model.stl --out ./analysis_out
```

Prints the evidence, every claim with its status and reason, findings and scores, and writes `report.json` and `report.pdf`. It uses a scratch database, so your real data is never touched. AI keys are read from `backend/.env`.

---

## Interview integrity (proctoring)

Camera checks run **in the browser** (face present, more than one person, looking away, phone/book in view, tab switching, pasting). **No video is uploaded.** CoreLink keeps an alert log and a small number of still snapshots — one at the start and one per flagged event (max 32 per session, 600 events) — visible only to that job's recruiter and admins and deleted after 90 days. Practice interviews never store images.

Reliability design:
- Evidence is queued in IndexedDB, survives refreshes and network loss, and is uploaded with retries and back-off. Corrupted queue records are dropped and counted; if storage is full the queue falls back to memory and reports it.
- The server answers per record: `persisted`, `duplicate`, `invalid` or `failed`. The browser deletes only what was acknowledged.
- A PostgreSQL transaction-scoped advisory lock per session makes quotas and duplicate checks safe under concurrent uploads.
- Uploads are accepted for 30 minutes after an interview ends (marked *synced after finish*) and the server risk score is recomputed.
- The risk score shown to recruiters is computed on the server from stored rows (low = 2, medium = 8, high = 18, capped at 100). The browser's own estimate is stored but never used.
- Access follows the full chain recruiter → owned job → application → session → snapshot; any mismatch is refused.
- Database migrations run with Alembic at start-up and **fail closed** — if a migration fails, the API does not start.

---

## Evaluation and accuracy

All numbers below were measured on this codebase and can be reproduced with the commands shown. Anything not measured is listed as such.

### 1. Mechanical analysis benchmark (synthetic, reproducible)

`backend/scripts/eval_project_analysis.py` generates parts with random plate size (60–240 × 40–160 mm), thickness (4–20 mm), central bore (12–52 mm) and hole pattern, writes each as a dimensioned DXF drawing and an STL mesh (one third of the meshes are deliberately opened), and creates three true and three wrong claims per part (wrong bore, wrong thickness, wrong hole size).

```bash
cd backend
python scripts/eval_project_analysis.py --n 300 --seed 2026      # deterministic, no API keys
python scripts/eval_project_analysis.py --n 20  --ai             # full AI pipeline (uses API calls)
```

Deterministic mode, 300 parts (seed 2026); the same results were obtained with 100 parts (seed 7):

| Measure | Result |
|---|---|
| DXF dimension recall (1,800 dimensions) | **100 %** |
| DXF note / annotation recall (1,200 notes) | **100 %** |
| STL bounding-box error | **0.0 mm** (max) |
| STL volume error (closed meshes) | **0.0 %** (mean relative) |
| Open-mesh (watertight) detection — 300 meshes | precision **1.00**, recall **1.00**, accuracy **100 %** |
| Wrong-claim detection — 1,800 claims (900 wrong) | precision **1.00**, recall **1.00**, F1 **1.00**, false positives **0** |
| True claims supported by evidence without AI | **42 %** (keyword matching only — this is why the AI step exists) |

**Error analysis.** The first benchmark run found a real defect: a quantity prefix such as `4X HOLE DIA 8` was read as a size, so a wrong claim of "4 mm holes" was missed (recall 91.3 %, 26 of 300 wrong claims missed). Quantity prefixes are now ignored, a regression test was added, and recall rose to 100 %.

**Threats to validity.** The synthetic drawings use one note style, so 100 % here means the parsers and the contradiction rule are correct on well-formed input — not that they reach 100 % on arbitrary student drawings. Real drawings with different note wording, unit systems or exploded dimensions will score lower. The next step is a hand-labelled set of real student DXF/STEP files.

### 2. End-to-end case study with AI (real run)

One full run on the flange-plate test project (DXF + STL, description with 3 deliberate errors) using `openai/gpt-oss-120b` via Groq:

| | Count |
|---|---|
| Claims extracted | 11 |
| Correctly verified (part number, size, thickness, material, bore, hole pattern, ISO 2768-m, Ra 1.6) | 7 / 7 |
| Correctly left unverified (FEA result, 35 % weight reduction, CNC-gantry use — no evidence uploaded) | 3 / 3 |
| Correctly contradicted (bore "enlarged to 52 mm" vs drawing 40 mm) | 1 / 1 |
| **Agreement with the expected labels** | **11 / 11** |

This is a single case (n = 11 claims) and is reported as a qualitative check, not a statistical accuracy figure. Before the fixes in this release the same project scored 4 claims extracted and 0 contradictions found, because retired model names failed and evidence lines were cut at 220 characters.

### 3. Software tests

| Suite | Result |
|---|---|
| Backend (pytest, SQLite) | **507 passed**, 9 skipped (PostgreSQL-only) |
| Proctoring + migrations against PostgreSQL 16 | **9 passed**; concurrency subset repeated 3× with identical results |
| Proctoring / interview suites run fully on PostgreSQL 16 | **25 passed**, 1 skipped (SQLite-only trigger) |
| Frontend (Vitest) | **119 passed** (12 files) |
| Frontend production build | passes |

Measured defects fixed with tests (details in `docs/proctoring-staging-readiness.md`): before the fix, 40 proctoring events were stored against a quota of 30 under concurrent uploads, because the advisory lock was released immediately; after the fix the quota holds exactly.

### Not measured yet
- ATS resume-score agreement with human recruiters.
- Proctoring detector precision/recall (face, gaze, phone detection) on labelled video.
- Load beyond 2 server workers / 12 parallel requests.
- Project analysis accuracy on a hand-labelled set of real student projects in every domain.

---

## Tech stack and architecture

| Layer | What we use |
|---|---|
| Frontend | React 18, Vite, React Router, lucide icons, idb-keyval (offline queue), Capacitor (Android/iOS shell), installable PWA |
| Backend | FastAPI, SQLModel/SQLAlchemy, Pydantic, Alembic migrations, slowapi rate limiting |
| Database | PostgreSQL (Supabase in production), SQLite for local dev/tests |
| AI | Groq / Gemini / OpenRouter with automatic model discovery, health-based failover and request hedging; Gemini REST client for vision; fastembed (ONNX MiniLM) embeddings; deterministic scoring when no LLM is configured |
| Engineering files | ezdxf (DXF), custom STEP/STL/OBJ/IFC parsers, KiCad/Wokwi/TinkerCAD parsers |
| Documents | pdfplumber, python-docx, Pillow, reportlab (PDF reports) |
| Email | Brevo / Resend HTTP APIs with background retries (SMTP is blocked on Render's free plan) |
| Hosting | Vercel (website), Render (API, Docker), Supabase (Postgres) — all free tiers |

```
Browser (React PWA) ──HTTPS──► FastAPI on Render ──► PostgreSQL (Supabase)
   │  camera checks, key-frame picking,          │
   │  offline evidence queue (IndexedDB)         ├──► Groq / Gemini / OpenRouter (free tiers)
   └──────────────────────────────────────────── └──► job sources (Greenhouse, Lever, …)
```

---

## Running it locally

You need **Python 3.11** and **Node 20+**.

```bash
# Backend
cd backend
python3.11 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-nlp.txt     # optional: spaCy English model (falls back without it)
cp .env.example .env                     # everything is optional for local use
uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev                              # http://localhost:5173
```

Without any API keys the app still works: scoring falls back to deterministic rules, the AI interviewer uses a local fallback, and emails are printed to the console (`EMAIL_PROVIDER=console`). The first admin account comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`.

### Tests

```bash
cd backend  && EMBEDDING_BACKEND=hash python -m pytest -q                 # 507 tests
cd frontend && npx vitest run                                             # 119 tests

# whole backend suite on PostgreSQL (scratch database, wiped per test)
ATS_TEST_DATABASE_URL=postgresql://user@localhost:5432/corelink_test python -m pytest -q
# PostgreSQL concurrency and migration tests
ATS_PG_ADMIN_URL=postgresql://postgres@localhost:5432/postgres python -m pytest -q tests/test_postgres_proctoring.py
```

### Docker (same image as production)

```bash
cd backend
docker build -t corelink-api .
docker run -p 8000:8000 --env-file .env corelink-api   # runs migrations, then starts uvicorn
```

---

## Configuration

All settings are environment variables (see `backend/.env.example`). The important ones:

| Variable | What it's for |
|---|---|
| `DATABASE_URL` | Postgres connection string (Supabase *Session pooler* URL in production) |
| `JWT_SECRET_KEY` | Signs login tokens — use a long random value |
| `CORS_ORIGINS`, `APP_PUBLIC_URL` | The website address(es) allowed to call the API |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin account |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | AI interviewer, resume tips and project analysis (any one is enough; Gemini is needed for photos/video) |
| `PROJECT_ANALYSIS_GEMINI_MODEL` | Pin a Gemini vision model (default: discovered automatically) |
| `PROJECT_ANALYSIS_MAX_LLM_CALLS_PER_DAY`, `PROJECT_ANALYSIS_MAX_PER_STUDENT_DAILY` | AI budget (default 40) and analyses per student per day (default 5) |
| `SCORER_LLM_TIMEOUT` | Seconds to wait for the AI resume review (default 60) |
| `PROCTOR_MAX_SNAPSHOTS`, `PROCTOR_MAX_EVENTS` | Evidence caps per session (default 32 / 600) |
| `PROCTOR_LATE_SYNC_MINUTES`, `PROCTOR_RETENTION_DAYS` | Upload grace window after finish (default 30) and evidence retention (default 90) |
| `EMAIL_PROVIDER`, `BREVO_API_KEY`, `EMAIL_FROM` | Account and password-reset emails |
| `GOOGLE_CLIENT_ID` | Sign in with Google (public value) |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Sign in with LinkedIn (OpenID Connect) |
| `TRUECALLER_PARTNER_KEY` | Truecaller phone verification (Android mobile web) |
| `LIVE_SYNC_AUTO`, `LIVE_SYNC_INTERVAL_HOURS` | Automatic live-job sync (default on, every 6 h) |
| `ADZUNA_APP_ID/KEY`, `JOOBLE_API_KEY` | Extra official job sources (optional) |
| `VECTOR_BACKEND=db`, `MEDIA_STORE=db` | Keep embeddings and images in Postgres (needed on free hosts with no disk) |

Secrets never go in the repo. Put them in Render → Environment (or your local `.env`, which is git-ignored).

---

## Deploying (free)

The full walkthrough is in **[DEPLOY.md](DEPLOY.md)**; database migrations are explained in **[backend/MIGRATIONS.md](backend/MIGRATIONS.md)**. In short:

1. **Database** — create a free Supabase project and copy the *Session pooler* connection string into `DATABASE_URL`.
2. **API** — create a Render *Web Service* from this repo (Docker, root directory `backend`), add the environment variables, deploy. `start.sh` applies migrations before starting; if they fail, the service does not start. Turn on **Auto-Deploy** for `main`.
3. **Website** — import the repo into Vercel with root directory `frontend`. Production branch `main`.
4. **Sign-in providers** — add `https://<your-site>` to Google's *Authorized JavaScript origins*, `https://<your-site>/auth/linkedin/callback` to LinkedIn's redirect URLs, and `https://<your-api>/api/auth/truecaller/callback` as the Truecaller callback.
5. **Search** — the site ships with `robots.txt`, `sitemap.xml` and a Google Search Console verification file.

### Mobile app
- **Install from the browser:** Android Chrome → ⋮ → *Install app*; iPhone Safari → Share → *Add to Home Screen*.
- **Android APK:** the Capacitor project is in `frontend/android`; `.github/android-apk.yml` builds a debug APK (move it into `.github/workflows/` to enable it).

---

## Demo data

Admins can load **clearly fictional** demo data from *Admin → Live Data → Demo companies*:

- **20 demo companies** — every name starts with "Demo ·", each with a recruiter login (password shown once) and 3–4 jobs/internships.
- **24 demo students** — fictional profiles with `…@students.demo.corelink` addresses that apply to the demo jobs at different pipeline stages.

Demo data is always labelled, never mixed into real recruiters' pipelines, **excluded from the public numbers on the homepage**, and removed with one click. Please don't present it as real usage.

---

## Project structure

```
backend/
  app/
    api/                    # routers: students, recruiters, admin, auth, interview, proctoring, project_analysis, live data…
    services/
      project_analysis/     # extractors/, analysers/, claims, scoring, report, pdf, jobs, pipeline
      llm_stream.py         # multi-provider LLM client with model discovery and failover
      gemini_rest.py        # minimal Gemini REST client
      …                     # scoring, embeddings, live-job sources, email, demo data, LinkedIn PDF parser
    db.py, db_pool.py       # SQLModel tables, connection handling
    main.py                 # app factory, routers, background jobs
  alembic/                  # migrations (0000 baseline, 0001 proctoring idempotency)
  scripts/                  # analyse_local.py, eval_project_analysis.py, seed and smoke-test scripts
  tests/                    # pytest suite (SQLite and PostgreSQL)
frontend/
  src/
    portal/                 # student / recruiter / admin / shared pages (ProjectReport, ProctoringReview…)
    interview/              # Aria interview room, speech, proctoring queue
    lib/                    # API client, project analysis + video key-frame helpers
    ui/                     # shared components and styles
  public/                   # icons, manifest, service worker, robots.txt, sitemap.xml
  android/ ios/             # Capacitor native shells
docs/                       # design references, proctoring staging-readiness report
```

---

## Known limitations

- **Free hosting:** the API sleeps when idle, so the first request can be slow. The server runs in Oregon and the database in Mumbai, which adds latency.
- **Project analysis** checks evidence, not the physical project: a verified claim means the uploaded files agree with it. The drawing and the 3D model are not yet compared with each other (a plain block STL next to a drawing with holes is not flagged).
- **Proctoring** severities are classified in the browser; the server validates them against an allow-list but cannot confirm what the camera saw. Evidence still queued after the 30-minute grace window uploads only if the candidate reopens the page.
- **Email** needs a Brevo (or Resend) key; until then admins can hand out one-time temporary passwords.
- **Truecaller** works only in Android phone browsers with the Truecaller app.
- **LinkedIn** shares only name, email and photo through sign-in; the rest comes from the PDF export.

## Roadmap

- Hand-labelled benchmark of real student projects in every domain
- Drawing ↔ 3D-model consistency check (holes, bores, overall size)
- Firebase phone OTP for iPhone/desktop
- Moving hosting closer to India
- Recruiter analytics dashboard
- More official job sources

---

## Privacy

What we collect and why is described on the [Privacy page](https://corelink-pi.vercel.app/privacy). In short: no selling of data, no advertising, interview video is never uploaded, project files are never executed, and you can download or delete your data (including project files and analysis reports) from Settings.

## License

This project is for academic and portfolio use. Contact the author before using it commercially.
