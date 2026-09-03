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

---

# INTEGRATION_NOTES — LinkedIn-Style Education, Certifications & Profile Media

## 1. Rollback Point
- **Starting Commit**: Post repo-verification feature.
- **Working Tree Check**: Clean before starting.
- **Additive-Only**: No existing auth, scoring, or ATS logic modified. New fields, endpoints, and components added alongside existing ones.

## 2. Architecture & Design Principles
1. **Additive Data Model**: Extended `CandidateProfile` and created new `RecruiterProfile` table without modifying existing fields.
   - `CandidateProfile`: Added `education_json`, `certifications_json`, `avatar_path`, `cover_photo_path`.
   - `RecruiterProfile`: New table with `headline`, `bio`, `company_name`, `avatar_path`, `cover_photo_path` (kept separate from auth table `RecruiterUser`, mirroring candidate pattern).
2. **JSON Array Pattern**: Education and certifications stored as JSON arrays (no new tables needed), following existing `skills_json`, `experience_json` convention.
   - Education shape: `{ level: "school"|"pu"|"degree"|"pg", institution, field_of_study?, start_year?, end_year?, grade? }`
   - Certifications shape: `{ name, issuing_organization, issue_date?, credential_url?, file_path? }`
3. **Static File Serving**: Media directory mounted at `/media` for public access to avatars, covers, and certificate files. Profile response includes `avatar_url` and `cover_photo_url` as full URLs.
4. **Image Validation**: Uploads validated using magic byte headers and file size limits (5MB for images, 10MB for certificates) via `media_utils.py`.
5. **Reusable Frontend Components**: `AvatarUpload` and `CoverPhotoUpload` components accept endpoint props, allowing both candidate and recruiter sides to use the same component.

## 3. Files Created & Modified

### Backend Files Created
- `backend/app/services/media_utils.py`: Image/certificate validation (magic bytes, size), upload handlers `validate_and_save_image()`, `validate_and_save_cert_file()`, and `delete_media_file()`.

### Backend Files Modified
- `backend/app/db.py`:
  - Extended `CandidateProfile` with `education_json`, `certifications_json`, `avatar_path`, `cover_photo_path`.
  - Created new `RecruiterProfile` table with recruiter-specific profile fields.
- `backend/app/main.py`:
  - Mounted `/media` static route for serving uploaded files.
  - Registered `recruiter_profile` router (was imported but not included).
- `backend/app/api/candidate_profile.py`:
  - Updated `_profile_to_dict()` to include `certifications`, `avatar_url`, `cover_photo_url`.
  - Added `PUT /profile/education` — replace full education list.
  - Added `POST /profile/certifications` — add certification with optional file.
  - Added `DELETE /profile/certifications/{index}` — remove certification.
  - Added `POST /profile/avatar` — upload avatar image.
  - Added `POST /profile/cover-photo` — upload cover photo.
- `backend/app/api/recruiter_profile.py` (already existed, verified complete):
  - `GET /api/recruiter/profile` — fetch profile with avatar/cover URLs.
  - `PUT /api/recruiter/profile` — update headline, bio, company.
  - `POST /api/recruiter/profile/avatar` — upload avatar.
  - `POST /api/recruiter/profile/cover-photo` — upload cover.

### Frontend Files Created
- `frontend/src/components/EducationSection.jsx` & `.css`: Timeline component grouping education by level (School → PU → Degree → PG) with add/edit/delete form.
- `frontend/src/components/CertificationsSection.jsx` & `.css`: Card list of certifications with file links, add/delete form.
- `frontend/src/components/AvatarUpload.jsx` & `.css`: Reusable circular avatar with upload overlay, initials fallback, configurable endpoint.
- `frontend/src/components/CoverPhotoUpload.jsx` & `.css`: Reusable banner upload with gradient placeholder, configurable endpoint.

### Frontend Files Modified
- `frontend/src/pages/candidate/ProfilePage.jsx`:
  - Added imports for new components.
  - Added `CoverPhotoUpload` above profile card (full-width banner).
  - Replaced static initials avatar with `AvatarUpload` component.
  - Inserted `EducationSection` and `CertificationsSection` after resume section.
- `frontend/src/pages/recruiter/RecruiterProfile.jsx`:
  - Added imports for new components.
  - Added `CoverPhotoUpload` banner at top.
  - Replaced static initials avatar with `AvatarUpload`.
  - Added editable headline/bio/company form section.

### Backend Tests Created
- `backend/tests/test_profile_features.py`:
  - Tests for education PUT (single entry, multiple levels).
  - Tests for certifications add/delete.
  - Tests for avatar/cover photo storage.
  - Tests for recruiter profile CRUD.
  - Integration test ensuring response shape includes all new fields.
  - Regression test confirming existing fields unchanged.
  - **Result**: 10 tests, 10 passed ✓

## 4. API Response Shape (Additive)
**Candidate Profile GET** (`/api/candidate/profile`):
```json
{
  "headline": "...",
  "bio": "...",
  "education": [
    { "level": "degree", "institution": "...", ... }
  ],
  "certifications": [
    { "name": "...", "issuing_organization": "...", ... }
  ],
  "avatar_url": "/media/avatars/abc123.jpg" or null,
  "cover_photo_url": "/media/covers/abc456.jpg" or null,
  "skills": [...],
  "experience": [...],
  ... (all existing fields remain unchanged)
}
```

## 5. Zero Regressions
- **Existing Candidate Tests**: All pass (test_candidate_api.py).
- **New Profile Tests**: 10 passed (test_profile_features.py).
- **No Score/Auth Leakage**: Education, certifications, and photos are profile data only — not exposed in simplified status endpoints or between candidates.

