# ATS Platform

An AI-assisted, proctor-verified Applicant Tracking & Candidate Evaluation Platform with immutable decision audit logging, plain-language score explainability, multi-stage project verification, and real-time computer vision proctoring.

## ⚡ 5-Minute Zero-Cost Quickstart

The entire platform runs **100% locally with zero cloud API keys and zero paid dependencies** using local Ollama (or deterministic fallback scoring):

```bash
# 1. (Optional for local AI analysis) Start Ollama
ollama run llama3.2    # Or lightweight models: phi3:mini / qwen2.5:3b

# 2. Backend Setup
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
pytest -v                               # Run test suite (78 tests)
uvicorn app.main:app --reload --port 8000

# 3. Frontend Setup (in a separate terminal)
cd frontend
npm install
npm run build                           # Verify production build
npm run dev                             # Start UI at http://localhost:5173
```

Open `http://localhost:5173` to explore the Candidate Portal, Recruiter Dashboard, and Admin Approval Queue.

---

## 🌟 Local-First Architecture & Zero-Cost Operation

- **Local-First Default**: You can run the entire platform offline for free by starting Ollama with `llama3.2` (or smaller models like `phi3:mini` or `qwen2.5:3b` on memory-constrained machines). No external API signups or keys required.
- **Optional Cloud Free Tiers**: If `GROQ_API_KEY` or `GEMINI_API_KEY` is provided, the platform can utilize Groq or Google Gemini free tiers for deep resume insights and portfolio evaluation.
- **Deterministic Graceful Degradation**: If no cloud keys are configured and Ollama is not running, the platform seamlessly falls back to deterministic embedding and keyword scoring (`sentence-transformers` + skill taxonomy) without failing.
- **Runtime Startup Log**: On startup, the backend outputs a clear one-line operational status (e.g. `[STARTUP] LLM Mode: Running with local Ollama — zero-cost operation, no external LLM calls`).

---

## 🏗️ Architecture & Stack Decisions

### Database & Scalability
- **Default Engine**: SQLite (`backend/data/ats.db`) is used by default for zero-setup local development, automated testing, and demonstrations.
- **PostgreSQL Compatibility**: The data layer is built with SQLModel/SQLAlchemy. Setting `DATABASE_URL` (e.g. `DATABASE_URL=postgresql://user:pass@localhost:5432/ats_db`) connects directly to PostgreSQL with native table creation (`create_all`).
- *Honest ceiling caveat*: The schema and models are PostgreSQL-compatible via `DATABASE_URL` for concurrent-write scale, but have not yet been load-tested at massive multi-node scale.

### Frontend Type System & Styling
- **Page & Navigation Layer (`.jsx`)**: React components in `src/pages/` and navigation elements use `.jsx` with vanilla CSS for rapid interactivity, standard routing, and zero heavy component-library overhead.
- **Proctoring, Computer Vision & Interview Engine (`.ts`/`.tsx`)**: Core behavioral signals, tensor/frame sampling (`frame-sampler.ts`), eye-gaze and head-pose estimation (`gaze-headpose.ts`), liveness analysis, and risk scoring (`risk-engine.ts`) are strictly typed in TypeScript for safety over numerical thresholds and audio/video streams.

### Email Delivery (SMTP & Dev Mode)
- **Production / Sandbox SMTP**: Configured via standard environment variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_APP_PASSWORD`, `SMTP_FROM`). Verified with free SMTP providers (e.g. Gmail App Passwords on free accounts with `smtp.gmail.com:587` or Mailtrap's free sandbox tier).
- **Development Fallback**: In development mode (`DEBUG=1` or `ENV=development`), if SMTP is unconfigured, authentication and password-reset endpoints automatically return a dev payload (`{"email_sent": false, "dev_only": {"token": "..."}}`) so all user flows remain testable without mail server setup.

### Containerization (Docker)
- `backend/Dockerfile` (Python 3.11 with `libmagic1` and uvicorn), `frontend/Dockerfile` (multi-stage Node build + Nginx Alpine), `frontend/nginx.conf` (API reverse proxy & SPA routing), and `docker-compose.yml` with persistent volume `ats_data` at `/app/data` are configured for containerized deployment.

---

## 🛡️ AI Hiring Compliance & Governance Features

- **Decision Audit Trail (`DecisionAuditLog`)**: Append-only, immutable audit logging in `backend/app/db.py` and `backend/app/services/audit.py`. Every scoring event (ATS match, project/repo verification, AI interview evaluation), candidate deletion request, and recruiter confirmation is permanently recorded with full input signals, LLM verdicts, timestamps, and reviewer attribution (aligned with NYC Local Law 144 / EU AI Act high-risk AI governance requirements).
- **Candidate Score Explainability**: `GET /api/candidate/jobs/applications/{app_id}/explainability` provides candidates with a plain-language breakdown of their score components (semantic fit, matched vs missing skills, project code depth, proctoring status) and actionable improvement advice generated deterministically without additional LLM calls.
- **Human-in-the-Loop Confirmation Gate**: Any auto-generated rejection or high-risk proctoring flag sets `pending_human_review = True`, requiring explicit human recruiter review and confirmation via `POST /api/recruiter/jobs/{job_id}/applicants/{app_id}/confirm-decision` or status updates before becoming final.
- **Proctoring Consent & Data Retention**: 
  - Mandatory pre-interview consent disclosure screen in `frontend/src/components/AIInterviewModal.jsx` disclosing recorded media, computer vision signals analyzed, and data retention terms before camera/microphone initialization.
  - 30-day raw proctoring media retention policy with automated purge utility in `backend/app/services/retention.py` and `POST /api/admin/retention/purge` preserving aggregate scores and audit records.
  - Candidate right-to-be-forgotten via `POST /api/candidate/applications/{app_id}/request-data-deletion` accessible directly in the candidate portal.
- **Operational Health & Structured Telemetry**:
  - Active `GET /health` endpoint in `backend/app/main.py` verifying database read/write connectivity and checking reachability of optional AI providers (Groq, Gemini, Ollama).
  - Structured JSON telemetry logging in `backend/app/services/llm_telemetry.py` capturing provider, model, latency, status, and payload length for all LLM calls.

---

## 🔬 Core Engineering Disciplines & Role Templates

The platform includes 33 verified role templates exceeding 250 words each across 7 core engineering branches:
- **Software** (CS / Software)
- **Mechanical** (Mechanical Engineering)
- **Civil** (Civil & Structural)
- **Chemical** (Chemical & Process)
- **ECE** (Electronics & Communication)
- **EEE** (Electrical & Electronics)
- **Aerospace** (Aerospace Engineering)

Blended Candidate Scoring Formula:
$$\text{Final Score} = 0.40 \times \text{ATS Score} + 0.60 \times \text{Project Score}$$

---

## 🧪 Test Suites

### Backend Tests (Pytest)
```bash
cd backend
backend/venv/bin/pytest -v
```
**Status**: 78 passed, 4 skipped (0 failures).

### Frontend Tests (Vitest)
```bash
cd frontend
npx vitest run
```
**Status**: 4 test files passed, 16 tests passed (0 failures).

### Production Frontend Build
```bash
cd frontend
npm run build
```
**Status**: Clean production bundle generated in `dist/`.
