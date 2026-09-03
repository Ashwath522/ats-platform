# INTEGRATION_NOTES — Repo Verification Integration

## 1. Status Check & Rollback Point
- **Rollback Commit Hash**: `65b91d5` (HEAD on `origin/main`)
- **Working Tree Check**: `git status` confirmed clean working tree before starting.
- **Reversions**: No files required reversion because the working tree was already clean and building on confirmed known-good HEAD.

## 2. Architecture & Design Principles Adhered To
1. **Additive-Only**: Existing scoring routines in `scorer.py` and `scoring.py`, interview logic, and auth decorators were preserved. New project extraction and scoring logic were isolated in dedicated files (`backend/app/services/project_parsers/`, `backend/app/services/project_scorer.py`, `backend/app/config.py`).
2. **Deterministic Fallbacks**: `score_project` and `parse_project_file` never crash or raise unhandled exceptions during batch runs. Graceful fallback operates when Gemini/LLM is absent or unavailable.
3. **Strict Score Leakage Stripping**:
   - Stripped numeric ATS and repo scores from candidate application submission response and `ApplicationsPage.jsx`.
   - Replaced numeric score displays with the simplified status enum (`applied`, `shortlisted`, `not_selected`, `interview`, `final_result`) rendered through `CandidateStatusBanner.jsx`.
4. **Weighted Scoring**:
   - `final_score = round(REPO_WEIGHT_ATS * ats_score + REPO_WEIGHT_PROJECT * project_score, 1)`
   - Configurable via `REPO_WEIGHT_ATS` (default 0.40) and `REPO_WEIGHT_PROJECT` (default 0.60) in `backend/app/config.py`.
5. **Two-Stage Shortlisting**:
   - Stage 1: Recruiter filters applicants by `ats_score` (status = `shortlisted`).
   - Stage 2: `POST /recruiter/jobs/{job_id}/repo-verify` runs exclusively on Stage 1 shortlisted applicants, scores portfolios, ranks candidates, enforces slot caps, marks `candidate_status` as `shortlisted` or `not_selected`, and records immutable audit entries in `DecisionAuditLog`.

## 3. Files Created & Modified

### Created Files
- `backend/app/config.py`: Weight configuration (`REPO_WEIGHT_ATS`, `REPO_WEIGHT_PROJECT`) and candidate status enum constants.
- `backend/app/services/project_parsers/pdf_parser.py`: PyMuPDF (`fitz`) PDF page text extraction with binary text fallback.
- `backend/app/services/project_parsers/docx_parser.py`: `python-docx` extraction of paragraphs and table contents.
- `backend/app/services/project_parsers/zip_parser.py`: Code archive extractor filtering for source code and documentation, ignoring binaries/node_modules/git.
- `backend/app/services/project_parsers/__init__.py`: Router function `parse_project_file(file_path: str) -> str`.
- `backend/app/services/project_scorer.py`: Combined keyword, semantic embedding similarity, and LLM reasoning with deterministic fallback.
- `frontend/src/components/CandidateStatusBanner.jsx`: Candidate-facing status banner displaying only simplified status and friendly status messaging.
- `frontend/src/components/ProjectUploadForm.jsx`: File upload component for PDF, DOCX, ZIP, or code files with project description and technical summary generation.
- `frontend/src/pages/recruiter/JobDetail.jsx`: Job pipeline component with "Run ATS Shortlist" and "Repo Verification" action buttons and Stage 2 ranked shortlist table.
- `backend/tests/fixtures/sample_project.zip`: Test fixture code archive.
- `backend/tests/fixtures/sample_project.docx`: Test fixture DOCX document.
- `backend/tests/fixtures/sample_project.pdf`: Test fixture PDF document.
- `backend/tests/fixtures/sample_project.txt`: Test fixture text notes.
- `backend/tests/test_repo_verification_integration.py`: Integration and unit test suite covering parsers, scoring, fallback paths, candidate endpoints, and recruiter batch ranking.

### Modified Files
- `backend/app/db.py`: Added `candidate_status` to `Application`, added `project_score` and `candidate_status` to `CandidateProfile`, and added SQLite column migration.
- `backend/app/main.py`: Added router aliases for `POST /candidate/project-upload`, `GET /candidate/status`, and `POST /recruiter/jobs/{job_id}/repo-verify`.
- `backend/app/api/candidate_profile.py`: Added `upload_candidate_project` and `get_candidate_status` endpoints.
- `backend/app/api/candidate_jobs.py`: Added `candidate_status` to application responses and sanitized candidate application payload.
- `backend/app/api/recruiter_jobs.py`: Added `POST /{job_id}/repo-verify` batch ranking endpoint with slot caps and audit logging.
- `backend/app/services/gemini_client.py`: Added `generate_project_summary()` with local fallback.
- `frontend/src/pages/candidate/ProfilePage.jsx`: Embedded `ProjectUploadForm`.
- `frontend/src/pages/candidate/ApplicationsPage.jsx`: Embedded `CandidateStatusBanner` and stripped candidate-facing numeric score leakage.
- `frontend/src/pages/recruiter/RecruiterJobs.jsx`: Embedded `JobDetail` with Stage 1 ATS and Stage 2 Repo Verification controls.

## 4. Deferred Items
- **Image & CAD Parsing**: Deferred follow-up per instructions.
- **Vision Model Project Parsing**: Deferred follow-up.

## 5. Verification Results
- **Backend Tests**: 84 passed, 4 skipped (100% passing across the entire test suite including full hiring flow e2e).
- **Frontend Checks**:
  - `npx tsc --noEmit`: 0 errors.
  - `npx vitest run`: 16 passed (100% passing).
  - `npm run build`: Production build succeeded.

## 6. Python Environment Setup
- **Working Python Version**: Python 3.11.15 (macOS arm64).
- **Environment Creation**: Created isolated environment via existing conda installation:
  ```bash
  conda create -n ats-backend python=3.11 -y
  /Users/ashwathm/miniconda3/envs/ats-backend/bin/pip install --upgrade pip
  /Users/ashwathm/miniconda3/envs/ats-backend/bin/pip install -r backend/requirements.txt
  ```
- **Rationale**: Python 3.14 lacks prebuilt wheels for C-extensions such as `PyMuPDF` (mupdf) on macOS arm64, resulting in clang compilation failures in zlib. Python 3.11 ships prebuilt wheels for all dependencies (`PyMuPDF==1.24.5`, `torch`, `sentence-transformers`, `spacy`, `sqlmodel`, `fastapi`, `uvicorn`), ensuring clean and fast installation with zero compilation issues.

