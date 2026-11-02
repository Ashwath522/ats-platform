# CoreLink

**Hiring for core engineering students — mechanical, civil, electrical, electronics, chemical, aerospace, automobile and metallurgy.**

Most job platforms in India are built around software roles. If you study mechanical or civil engineering, you end up scrolling past hundreds of "React developer" posts to find two jobs that fit you. CoreLink started as my final-year project to fix that: one place where core engineering students can find real jobs and internships, check their resume against a specific role, practise interviews with an AI interviewer, and get noticed by recruiters who actually hire for core branches.

- **Website:** https://corelink-pi.vercel.app
- **API:** https://corelink-api-z66r.onrender.com (free tier — the first request after a quiet spell can take ~50 s while the server wakes up)

> Built and maintained by **Ashwath M**. Feedback and issues are welcome.

---

## What you can do

### Students
- **Sign in your way** — email + password, Google, LinkedIn, or Truecaller (one-tap phone verification on Android). A short "you're in" animation plays after sign-in.
- **Import from LinkedIn** — paste your LinkedIn link (saved as a link, never scraped) and upload LinkedIn's *Save to PDF* export; we read it once to fill in headline, education, experience, skills and certifications, and you review everything before it's saved.
- **Resume & ATS check** — upload a PDF/DOCX resume and get a score with clear bars (content, skills, projects, certifications, format) and specific suggestions.
- **Match your resume to a job** — pick any job (or paste a job description from any site) and see your ATS score for *that* role, side by side with your resume: what matches, what's missing, skills that are on your profile but not in your resume, and what to change before applying.
- **Jobs that fit you** — every open job ranked by the same ATS score recruiters see, with one-click apply.
- **Live jobs from official sources** — listings pulled from company career sites and job APIs (Greenhouse, Lever, SmartRecruiters, Adzuna, Jooble). No LinkedIn scraping. They sync automatically every 6 hours.
- **Company directory** — top core-engineering companies with logos and portfolios; follow a company to get notified when it posts a new role.
- **College picker** — 400+ Indian engineering colleges with logos (type "Atria" → *Atria Institute of Technology*).
- **AI interview practice with Aria** — a talking, lip-synced interviewer that asks branch-specific questions, listens to your spoken answers (live captions), and gives rubric-based feedback.
- **Projects** — add projects with images, files and links; they're reviewed and marked verified.

### Recruiters
- Post jobs and internships, see applicants ranked by ATS score with matched / missing skills.
- Run AI interviews with proctoring, review the evidence, shortlist, schedule interviews and send offers.
- Company profile page, team members, notes and a full hiring pipeline.
- Recruiter accounts are approved by an admin after company checks (email domain, website, GSTIN/CIN format).

### Admins
- Approve recruiters, manage users (including setting a one-time temporary password when email can't be delivered), moderate projects, view the audit log.
- Live-data controls (sync now, sources, API keys status) and system settings (announcement banner, support email, test email).
- **Demo data tools** — see [Demo data](#demo-data) below.

### Interview integrity (proctoring)
Camera checks run **in the browser** (face present, more than one person, looking away, phone/book in view, tab switching, pasting). No video is uploaded. We keep a log of alerts and a small number of still snapshots — one at the start and one per flagged event (max 30), visible only to that job's recruiter and admins, deleted after 90 days. Practice interviews never store images.

---

## Tech stack

| Layer | What we use |
|---|---|
| Frontend | React 18, Vite, React Router, Plus Jakarta Sans, lucide icons, Capacitor (Android/iOS shell), installable PWA |
| Backend | FastAPI, SQLModel/SQLAlchemy, Pydantic, slowapi rate limiting |
| Database | PostgreSQL (Supabase in production), SQLite for local dev/tests |
| AI | Groq / Gemini / OpenRouter with automatic model selection and failover; fastembed (ONNX MiniLM) for embeddings; deterministic scoring when no LLM is configured |
| Files | pdfplumber, python-docx, Pillow (images stored compressed in the DB on the free tier) |
| Email | Brevo / Resend HTTP APIs (SMTP is blocked on Render's free plan) |
| Hosting | Vercel (website), Render (API), Supabase (Postgres) — all free tiers |

---

## Running it locally

You need **Python 3.11** and **Node 20+**.

```bash
# Backend
cd backend
python3.11 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill in what you need — everything is optional for local use
uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Without any API keys the app still works: scoring falls back to deterministic rules, the AI interviewer uses a local fallback, and emails are printed to the console (`EMAIL_PROVIDER=console`).

The first admin account comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`.

### Tests

```bash
cd backend && EMBEDDING_BACKEND=hash python -m pytest -q     # ~450 tests
cd frontend && npx vitest run                               # ~100 tests
```

---

## Configuration

All settings are environment variables (see `backend/.env.example` for the full list with comments). The important ones:

| Variable | What it's for |
|---|---|
| `DATABASE_URL` | Postgres connection string (Supabase pooler URL in production) |
| `JWT_SECRET_KEY` | Signs login tokens — use a long random value |
| `CORS_ORIGINS`, `APP_PUBLIC_URL` | The website address(es) allowed to call the API |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin account |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | AI interviewer and resume tips (any one is enough; all have free tiers) |
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

The full walkthrough is in **[DEPLOY.md](DEPLOY.md)**. In short:

1. **Database** — create a free Supabase project and copy the *Session pooler* connection string into `DATABASE_URL`.
2. **API** — create a Render *Web Service* from this repo (Docker, root directory `backend`), add the environment variables, deploy. Turn on **Auto-Deploy** for the `main` branch.
3. **Website** — import the repo into Vercel with root directory `frontend`. Production branch `main`.
4. **Sign-in providers** — add `https://<your-site>` to Google's *Authorized JavaScript origins*, `https://<your-site>/auth/linkedin/callback` to LinkedIn's redirect URLs, and `https://<your-api>/api/auth/truecaller/callback` as the Truecaller callback.
5. **Search** — the site ships with `robots.txt`, `sitemap.xml` and a Google Search Console verification file. Add the site in Search Console (URL-prefix property) and submit the sitemap.

### Mobile app
- **Install from the browser:** on Android, Chrome → ⋮ → *Install app*; on iPhone, Safari → Share → *Add to Home Screen*. It opens full-screen and updates itself.
- **Android APK:** the Capacitor project is in `frontend/android`; `.github/android-apk.yml` contains a GitHub Actions workflow that builds a debug APK on every push (move it into `.github/workflows/` to enable it).

---

## Demo data

To show the recruiter and student flows without waiting for real recruiters, admins can load **clearly fictional** demo data from *Admin → Live Data → Demo companies*:

- **20 demo companies** — every name starts with "Demo ·", each with a recruiter login (password shown once) and 3–4 jobs/internships across branches and cities.
- **24 demo students** — fictional profiles with `…@students.demo.corelink` addresses that apply to the demo jobs at different pipeline stages, so demo recruiters see a realistic applicant list.

Demo data is always labelled, never mixed into real recruiters' pipelines, and **excluded from the public numbers on the homepage**. One click removes all of it. Please don't present it as real usage — it's there for demos, testing and screenshots.

---

## Project structure

```
backend/
  app/
    api/            # FastAPI routers (students, recruiters, admin, auth providers, interview, proctoring, live data…)
    services/       # scoring, embeddings, LLM providers, live-job sources, email, demo data, LinkedIn PDF parser…
    db.py           # SQLModel tables
    main.py         # app factory, routers, background jobs
  tests/            # pytest suite
frontend/
  src/
    portal/         # student / recruiter / admin / public pages
    interview/      # Aria interview room, speech, proctoring
    ui/             # shared components, styles, login animation
    lib/            # API client, LinkedIn & Truecaller helpers
  public/           # icons, manifest, service worker, robots.txt, sitemap.xml
  android/ ios/     # Capacitor native shells
docs/               # design references
```

---

## Known limitations

- **Free hosting:** the API sleeps when idle, so the first request can be slow. The server runs in Oregon and the database in Mumbai, which adds latency — moving both to Singapore/Mumbai would help.
- **Email** needs a Brevo (or Resend) key; until then admins can hand out one-time temporary passwords.
- **Truecaller** works only in Android phone browsers with the Truecaller app. Phone OTP on iPhone/desktop would need Firebase (10 free SMS/day, card required).
- **LinkedIn** only shares name, email and photo through sign-in; the rest of the profile comes from the PDF export.

## Roadmap

### Project analysis (Phase 1)

CoreLink now supports engineering-project domains, YouTube demo links with an owner challenge code, multiple evidence files, and a tracked foundation analysis job. Phase 1 validates uploads and records factual evidence only; AI, video processing, domain analysis, and scoring are planned for later updates. Human reviewer verification remains the only path to a verified project.

Phase 2 adds an optional browser-side extraction engine. Text and image metadata are read in a Web Worker and submitted as untrusted client evidence; the server stores it, re-checks supported formats, and only server-origin or server-confirmed evidence may support verified claims. IndexedDB stores resumable step state, never raw file bytes.

Project analysis is recruiter-safe: recruiters see only completed analysis for candidates already visible through existing application/privacy rules. They receive the domain, human verification status, scores, claim statuses and evidence references; raw files, transcripts, challenge codes and internal warnings remain private. Human admin approval remains the only verification gate.

- Firebase phone OTP for iPhone/desktop
- Moving hosting closer to India
- Recruiter analytics dashboard
- More official job sources

---

## Privacy

What we collect and why is described on the [Privacy page](https://corelink-pi.vercel.app/privacy). In short: no selling of data, no advertising, interview video is never uploaded, and you can download or delete your data from Settings.

## License

This project is for academic and portfolio use. Contact the author before using it commercially.
