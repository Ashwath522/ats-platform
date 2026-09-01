# Integrated Hiring & AI Interview Platform

A single, unified, production-grade hiring repository combining **ATS Resume & Project Verification** (`ats-platform`) with **Real-Time Computer Vision AI Interview Proctoring** (`ai-interview-automated`).

---

## Architecture & Features

### 1. ATS Scoring Engine (Deterministic First → LLM Second)
- **Deterministic Match**: Cosine similarity between resume and job embeddings ($55\%$), vocabulary-driven skill coverage ($40\%$), and experience fit ($5\%$).
- **LLM Deep Analysis**: Gemini / Ollama integration for grammar score, technical depth rating, and actionable resume improvement suggestions.

### 2. Repo & Project Verification
- **Automated Code Parsing**: Parses candidate project zips, code repos, CAD/Tinkercad files, and PDFs against job description requirements.
- **Match Score & Reasoning**: Generates `repo_match_score` (0–100) and structured suitability verdict.

### 3. Interview Gatekeeper Rule
- **Strict Progression**:
  `Applied` $\rightarrow$ `ATS Scored` $\rightarrow$ `Shortlisted` $\rightarrow$ `Repo Verified` $\rightarrow$ `Interview Unlocked` $\rightarrow$ `Completed`
- Enforces `canTakeInterview()`: Candidates can only enter the AI Interview room **AFTER** they are shortlisted and their project/repo has been verified.

### 4. Computer Vision Proctoring Engine (CV Risk First → LLM Next-Step Second)
- **100% Untouched CV Modules**:
  `face-detector`, `gaze-headpose`, `lighting-analyzer`, `liveness-analyzer`, `object-detector`, `pose-detector`, `risk-engine`.
- **Signal Weights & Thresholds**:
  - `phoneDetected`: $50$
  - `spoofSuspected`: $50$
  - `multipleFaces`: $30$
  - `faceLeftFrame`: $20$
  - `personAbsent`: $20$
  - `repeatedOffScreenGaze`: $15$
  - `tabSwitched`: $15$
- **45-Second Baseline Capture**: Preserves exact 45-second timer calibration prior to question delivery.
- **Speaking Charter Interviewer**: Natural, concise spoken AI interviewer prompt wrapping browser TTS (`speakText()`).

### 5. Unified Recruiter Dashboard
Single unified card displaying:
- Candidate Info & ATS Score + `suitability_verdict` + `ai_recommendation`
- Repo Match Score & Code Analysis
- AI Interview Score + Proctoring Risk Level (`low`/`medium`/`high`) + Risk Score
- Full Transcript & Video/Audio Evidence Links

---

## Getting Started

### Backend Setup (FastAPI Python)
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pytest # Run full 65+ test suite
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup (Vite React + CV Proctoring)
```bash
cd frontend
npm install
npm test # Run 14 Vitest unit tests for CV risk-engine & gatekeeper
npm run dev # Starts dev server at http://localhost:5173
```

---

## License & Compliance
This repository strictly preserves all scoring orders, computer vision risk calculations, and baseline calibration logic from the source projects.
