# Deploying CoreLink for free

| Piece | Free service | Why |
|---|---|---|
| Backend API (FastAPI, Docker) | **Render** free web service, region **Singapore** | Docker support, HTTPS, closest free region to India (lower interview latency) |
| Database | **Neon** free Postgres | Render's free disk is wiped on every restart/sleep — all state (users, jobs, resume vectors, avatars) lives in Postgres instead |
| Web app (React) | **Render** static site | Free, global CDN, same Blueprint |
| Email | **Brevo** HTTP API (300/day free) | Render free blocks SMTP ports 25/465/587, so SMTP can't work there |
| AI | **Groq** (free tier) + **Gemini** (free tier) as fallback | Groq gives ~150–300 ms time-to-first-token for live interview turns |
| Android APK | **GitHub Actions** | `.github/workflows/android-apk.yml` builds a debug APK on every push |

Everything is pre-configured in [`render.yaml`](render.yaml). You only paste secrets.

## 1. Create the free accounts / keys (≈10 min)

1. **Neon** → https://neon.tech → New project (region: *Asia Pacific (Singapore)*) → copy the connection string (`postgresql://…?sslmode=require`).
2. **Groq** → https://console.groq.com → API Keys → create key.
3. **Gemini** (optional fallback) → https://aistudio.google.com/apikey.
4. **Brevo** → https://app.brevo.com → *Senders, domains & dedicated IPs* → add & verify your sender email → *SMTP & API → API keys* → create key.

## 2. Deploy with the Blueprint

1. Push this branch to GitHub and merge it to `main`.
2. Render dashboard → **New → Blueprint** → select the repo. Render reads `render.yaml` and creates `corelink-api` and `corelink-web`.
3. When prompted, fill in:
   - `DATABASE_URL` = Neon string
   - `GROQ_API_KEY`, `GEMINI_API_KEY`
   - `BREVO_API_KEY`, `EMAIL_FROM` (the verified sender)
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` (your first admin login)
4. If Render gives your services different URLs than `corelink-api.onrender.com` / `corelink-web.onrender.com`, update:
   - on **corelink-web**: `VITE_API_URL` → your API URL, then *Manual Deploy → Clear cache & deploy*
   - on **corelink-api**: `CORS_ORIGINS` and `APP_PUBLIC_URL` → your web URL

First build takes ~6–8 minutes (it bakes the embedding model into the image).

## 3. Verify like a user

```bash
cd backend
pip install httpx
python scripts/smoke_test.py --base https://corelink-api.onrender.com \
  --admin-email you@company.com --admin-password '…'
```

It walks the full pipeline (recruiter request + business verification → admin approval → job → candidate → resume → project → shortlist → unlock → streamed AI interview → evaluation → media upload) and prints first-word latency for every interview turn. (The approval step needs `DEV_MODE=true` to read the temporary password from the API; otherwise it stops there and you finish by hand from the emailed password.)

Then open the web URL on your phone and in the admin panel → **Email Delivery** tab → *Send test email*.

## 4. Free-tier caveats (honest list)

- **Cold starts**: a free Render service sleeps after 15 min idle; the first request then takes ~50 s. For demos, wake it a minute before, or add a free uptime pinger (e.g. UptimeRobot hitting `/health` every 10 min — keeps it awake within Render's 750 free hours/month).
- **RAM 512 MB**: the backend uses fastembed (ONNX) instead of PyTorch so it fits: ~170 MB measured locally without the model; the ONNX model should add roughly 100–150 MB (estimate — check *Metrics* in Render after deploy). Keep `--workers 1`.
- **Neon** free compute auto-suspends; the app uses `pool_pre_ping` so the first query after idle reconnects transparently (adds ~0.5 s once).
- **Brevo** free: 300 emails/day, small "Sent with Brevo" footer.

## 5. Mobile apps

```bash
cd frontend
cp .env.mobile.example .env.mobile      # set VITE_API_URL to your API
npm run android                          # builds, syncs, opens Android Studio → Run
npm run ios                              # macOS + Xcode; then `cd ios/App && pod install` once
```

Or let CI build it: in GitHub → *Settings → Secrets and variables → Actions → Variables* add `VITE_API_URL`, push to `main`, and download **corelink-debug-apk** from the workflow run.

For Play Store / App Store releases you still need a signing key (Android) and an Apple developer account (iOS, $99/yr) — not free.

## Alternative: one-box Docker

`docker compose up --build` (fill `.env` from `.env.example`) runs API + nginx-served web app with SQLite on a volume — good for a ₹0 college server or a free Oracle Cloud VM.
## Frontend on Vercel (free)

```bash
npm i -g vercel
cd frontend
vercel login
vercel link                      # create project "corelink", root = frontend
vercel env add VITE_API_URL production
vercel --prod
```

After deployment, set `CORS_ORIGINS=https://corelink.vercel.app` and `APP_PUBLIC_URL=https://corelink.vercel.app` in Render and redeploy. Preview URLs should be added explicitly when needed. To keep the free Render instance warm, create a cron-job.org job for `https://corelink-api.onrender.com/health` with a 10-minute interval and GET method.

## Supabase instead of Neon

1. Supabase → your project → **Connect** (top bar) → **Connection string** → **Session pooler** (works on Render's IPv4 network). Copy the `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres` value.
2. Replace `[YOUR-PASSWORD]` (brackets included) with your database password. URL-encode special characters: `@`→`%40`, `#`→`%23`, `:`→`%3A`, `/`→`%2F`, `%`→`%25`, `?`→`%3F`, `&`→`%26`.
3. Render → `corelink-api` → **Environment** → `DATABASE_URL` = that single line (no quotes, no `DATABASE_URL=`, no `psql`). The app adds `sslmode=require` and keeps a small connection pool for the pooler automatically.

## Live jobs & resources

Students see live job listings from **official, ToS-compliant APIs only** (no scraping of LinkedIn/Naukri/Indeed) next to CoreLink jobs, plus fresh papers/lectures per branch. Students apply on the company site; links are https-only on the provider's own domain, re-checked every sync, and removed when a listing closes.

| Source | Key | What it gives |
| --- | --- | --- |
| SmartRecruiters Posting API | none | India postings of the company ids set in Admin → Live Data (default `BoschGroup`, `Wabtec`, `Continental`) |
| Greenhouse / Lever job boards | none | India postings of the board tokens you add in Admin → Live Data (off when empty) |
| Adzuna | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` — free at https://developer.adzuna.com | core-engineering searches in India (≤30 days old) |
| Jooble | `JOOBLE_API_KEY` — free at https://jooble.org/api/about | core-engineering searches in India |
| arXiv | none | newest 5 papers per branch |
| YouTube Data API v3 | `YOUTUBE_API_KEY` — free at https://console.cloud.google.com (APIs & Services → enable "YouTube Data API v3" → Credentials → API key) | newest lectures per branch (8 searches ≈ 800 quota units per sync; free quota is 10,000/day) |

Sources whose key is missing are skipped and shown as "not configured" in **Admin → Live Data**; key values are never displayed.

Hygiene rules (backend/app/services/live_sync.py): non-core roles (HR, finance, sales, marketing, legal, pure IT/software) are dropped and every job is classified into one of the 8 core branches; duplicates are collapsed (same source id, or same company + title + city — official boards win over aggregators); a job missing from 2 consecutive successful syncs of its source, or reported inactive, is expired; postings older than 45 days are hidden; expired rows are pruned after 30 days; at most 2,000 active external jobs.

### Scheduling (Render free sleeps — use cron-job.org)

1. Set `LIVE_SYNC_TOKEN` on the API service to a long random string (e.g. `openssl rand -hex 32`).
2. Create a free job at https://cron-job.org:
   - URL: `https://<your-render-api-url>/api/internal/live-sync`, method **POST**, every **6 hours**
   - Header `X-Sync-Token: <LIVE_SYNC_TOKEN>` and `Content-Type: application/json`
   - Body: `{"kind":"all"}`
   - Timeout: 30 s is enough — the endpoint returns `202` immediately and syncs in the background (it also wakes the sleeping service). Overlapping runs are refused (`started: false`).
   - Responses: `403` wrong token, `503` token not configured on the server.
3. Check **Admin → Live Data → Run history** after the first run. "Sync now" there triggers the same sync manually.

Test locally without network: `cd backend && python scripts/load_live_fixtures.py [--with-doc-samples]` loads the saved fixtures through the real pipeline (dev DB only — doc samples are fictional companies).
