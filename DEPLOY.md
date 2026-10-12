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

Or let CI build it: move `docs/ci/android-apk.yml` to `.github/workflows/`, then in GitHub → *Settings → Secrets and variables → Actions → Variables* add `VITE_API_URL`, push to `main`, and download **corelink-debug-apk** from the workflow run.

For Play Store / App Store releases you still need a signing key (Android) and an Apple developer account (iOS, $99/yr) — not free.

## Alternative: one-box Docker

`docker compose up --build` (fill `.env` from `.env.example`) runs API + nginx-served web app with SQLite on a volume — good for a ₹0 college server or a free Oracle Cloud VM.
