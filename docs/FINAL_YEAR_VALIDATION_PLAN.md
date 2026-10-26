# CoreLink Final-Year Validation & Demo Plan

This plan turns the existing feature set into a defensible final-year project submission. It is a checklist and protocol, not a claim that these experiments have already been run.

## Goals

1. Demonstrate one complete hiring workflow from job creation through human-reviewed decision.
2. Measure resume-to-job matching against labelled examples and a simple baseline.
3. Evaluate reliability and false-positive behaviour of interview risk flags.
4. Capture reproducible test, deployment, privacy, and performance evidence.

## 1. End-to-end demo runbook

Use fictional candidate and company data only. Never demo with real applicant resumes, personal contact details, or real interview recordings.

### Before the demo
- [ ] Deploy the current commit and record the commit SHA.
- [ ] Confirm API health, database connectivity, email configuration, and AI-provider status.
- [ ] Prepare a recruiter account, admin account, and candidate account with synthetic data.
- [ ] Prepare one sample job description and two fictional resumes: one strong match and one clear mismatch.
- [ ] Confirm the consent notice is visible before recording/interview capture.
- [ ] Check that secrets, tokens, and personal data are not visible in the browser, terminal, logs, or recording.
- [ ] Run backend tests, frontend tests, type-check, and production build; save the exact output.

### Candidate-to-recruiter path
1. Admin reviews and approves the fictional recruiter/company.
2. Recruiter creates a job and adds a clear job description and skill requirements.
3. Candidate registers, reviews the privacy notice, and uploads a synthetic resume.
4. Candidate checks the ATS score and its explanation, including matched and missing skills.
5. Candidate submits an application and project/repository evidence, if enabled for that job.
6. Candidate completes the interview using voice or typed-answer fallback.
7. Recruiter reviews the resume score, project evidence, interview result, and any risk flags.
8. Recruiter explicitly confirms or overrides the recommendation and records a reason.
9. Show the audit trail and candidate-facing explanation where appropriate.
10. Demonstrate candidate data deletion/retention behaviour in a test account.

### Record these outcomes
- [ ] Screenshots of candidate, recruiter, and admin workflows.
- [ ] Screen recording with synthetic data.
- [ ] Test command output and deployment commit SHA.
- [ ] API response times and first-response latency for interview turns.
- [ ] Known limitations and any failed or skipped steps.

## 2. Resume-matching evaluation protocol

### Dataset design
Create a versioned CSV with one row per resume/job-description pair. Suggested fields:

| Field | Meaning |
|---|---|
| case_id | Stable, anonymous test-case identifier |
| resume_text | Synthetic or appropriately licensed/de-identified resume text |
| job_description | Matching job description |
| domain | Example: software, mechanical, civil, ECE, data/ML |
| human_relevance_label | Predefined relevance label, such as 0 = poor, 1 = partial, 2 = strong |
| annotator_count | Number of independent human annotators |
| adjudication_note | Short explanation for disagreements; no personal data |

Start with at least 100 varied pairs if practical, including strong matches, partial matches, unrelated resumes, career changers, sparse resumes, and JDs with ambiguous or missing requirements. Have two reviewers label cases independently and resolve disagreements before scoring. Do not use the current model's score to create the ground-truth label.

Keep a held-out test set that is not used to tune weights or thresholds. Split by candidate/resume identity where possible to reduce leakage. Record dataset version, annotation rules, and limitations.

### Baselines and metrics
Compare the current scorer against at least one transparent baseline, such as keyword/skill overlap. If feasible, include a semantic-only baseline to measure whether skill coverage adds value.

Report:
- Spearman rank correlation between system scores and human relevance labels.
- Precision@K and Recall@K for a clearly defined relevant/not-relevant threshold.
- NDCG@K when using graded relevance labels.
- Results by domain and by scenario type.
- Confidence intervals or bootstrap ranges where practical.
- Error analysis: false high scores, false low scores, and why each occurred.

Do not describe an ATS score as a probability of job success unless a separate, validated calibration study supports that interpretation. A 0–100 score is a ranking/matching signal, not a hiring verdict.

### Suggested acceptance gates
Set targets before looking at held-out results. A reasonable initial gate is that the model should beat the keyword baseline on a primary ranking metric, avoid catastrophic performance in any tested domain, and have documented examples of both successes and failures. Treat these as project criteria to agree with the supervisor, not as established results.

## 3. Interview risk-engine evaluation

The existing risk thresholds are heuristic signals, not proof that a candidate cheated. Keep human review mandatory.

Build a consented, controlled test matrix with volunteers or staged synthetic scenarios. Cover:
- Normal interview behaviour: natural gaze shifts, blinking, head turns, and looking away briefly.
- Camera conditions: low light, backlight, glasses, varied camera quality, and different seating positions.
- Multiple-face events and temporary face-detection loss.
- Liveness/spoofing test cases only where lawful, consented, and safe to stage.

Record scenario label, whether the signal fired, severity, and reason. Do not store identifiable video longer than needed; use the project's retention controls and document consent. Report false-positive rate on normal behaviour, detection rate on staged events, and results by condition. Do not infer dishonesty from gaze or appearance alone.

## 4. Reliability, security, and privacy checklist

- [ ] Candidate, recruiter, and admin permissions are tested for both allowed and denied actions.
- [ ] Recruiters cannot access another company's applicants or jobs.
- [ ] Upload validation covers file type, size, malformed files, and parsing errors.
- [ ] Rate limits and authentication failures behave safely.
- [ ] AI-provider failure/fallback paths return a clear status and do not expose secrets.
- [ ] Database persistence survives service restart/redeploy.
- [ ] Audit records cannot be silently overwritten through normal application flows.
- [ ] Candidate deletion and media-retention jobs are verified with test data.
- [ ] Logs avoid full resume text, credentials, tokens, and unnecessary personal data.
- [ ] CORS, production debug settings, and environment secrets are checked.
- [ ] Accessibility and mobile layout are tested at common viewport sizes.

## 5. Submission evidence pack

Prepare these artefacts for the project report and viva:
1. Problem statement, objectives, scope, and limitations.
2. Architecture diagram and key data-flow diagram.
3. Database schema and API summary.
4. Model/scoring explanation, formula, and baseline comparison.
5. Dataset and annotation protocol, with no personal data.
6. Test results, evaluation tables, error analysis, and reproducibility details.
7. Security, consent, retention, and human-review safeguards.
8. End-to-end demo recording and screenshots.
9. Deployment instructions, environment-variable list without secret values, and known free-tier limitations.
10. Future work, especially larger labelled evaluation and fairness/reliability testing.

## 6. Final readiness gate

Do not claim the project is fully validated until the team has:
- completed the end-to-end demo,
- rerun tests on the final commit,
- evaluated the matcher on held-out labelled data,
- measured risk-engine false positives under normal behaviour,
- verified deletion/retention and access-control paths, and
- documented failures and limitations honestly.

Update this file with actual results only after running the corresponding experiments.
