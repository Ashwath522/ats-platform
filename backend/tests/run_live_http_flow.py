"""
Live HTTP Test Flow Runner for ATS Platform.
Executes all steps 0 through 12 against the running uvicorn server at http://localhost:8000.
Captures raw HTTP requests and responses and prints comprehensive evidence.
"""
import json
import os
import sys
import time
import httpx
from sqlmodel import Session, select
from app.db import engine, CandidateProfile, Application, CandidateUser

BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:8000")

def run():
    client = httpx.Client(base_url=BASE_URL, timeout=60.0)
    uid = str(int(time.time()))
    print("=" * 70)
    print(f"STARTING LIVE HTTP FLOW AGAINST {BASE_URL} (RUN ID: {uid})")
    print("=" * 70)

    # -------------------------------------------------------------------------
    # STEP 0: Build a test project zip
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("STEP 0: Build a test project zip")
    print("=" * 70)
    zip_path = "/tmp/testproj/test_project.zip"
    resume_path = "/tmp/testproj/test_resume.pdf"
    assert os.path.exists(zip_path), f"Missing {zip_path}"
    assert os.path.exists(resume_path), f"Missing {resume_path}"
    print(f"Verified test project zip exists: {zip_path} ({os.path.getsize(zip_path)} bytes)")
    print(f"Verified test resume pdf exists: {resume_path} ({os.path.getsize(resume_path)} bytes)")
    print("STEP 0: PASS")

    # -------------------------------------------------------------------------
    # STEP 1: Register + log in a test candidate
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("STEP 1: Register + log in a test candidate")
    print("=" * 70)
    cand_username = f"cand_test_{uid}@example.com"
    cand_password = "CandidatePass123!"

    print(f"--> POST /api/candidate/auth/register (username={cand_username})")
    res_reg = client.post(
        "/api/candidate/auth/register",
        data={"username": cand_username, "password": cand_password}
    )
    print(f"Response ({res_reg.status_code}): {res_reg.text}")
    assert res_reg.status_code == 200, f"Candidate registration failed: {res_reg.text}"

    print(f"--> POST /api/candidate/auth/login (username={cand_username})")
    res_login = client.post(
        "/api/candidate/auth/login",
        data={"username": cand_username, "password": cand_password}
    )
    print(f"Response ({res_login.status_code}): {res_login.text}")
    assert res_login.status_code == 200, f"Candidate login failed: {res_login.text}"
    cand_token = res_login.json()["access_token"]
    cand_headers = {"Authorization": f"Bearer {cand_token}"}
    print(f"Captured candidate access token: {cand_token[:30]}...")
    print("STEP 1: PASS")

    # -------------------------------------------------------------------------
    # STEP 2: Upload a resume to the candidate profile
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("STEP 2: Upload a resume to the candidate profile")
    print("=" * 70)
    print("--> POST /api/candidate/profile/resume")
    with open(resume_path, "rb") as f:
        res_resume = client.post(
            "/api/candidate/profile/resume",
            headers=cand_headers,
            files={"file": ("test_resume.pdf", f, "application/pdf")}
        )
    print(f"Response ({res_resume.status_code}): {res_resume.text}")
    assert res_resume.status_code == 200, f"Resume upload failed: {res_resume.text}"
    resume_data = res_resume.json()
    assert resume_data.get("resume") is not None, "Resume object missing from profile"
    print(f"Resume uploaded and linked successfully. Resume DB ID: {resume_data['resume']['id']}")
    print("STEP 2: PASS")

    # -------------------------------------------------------------------------
    # STEP 3: Register + log in a test recruiter, post a job
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("STEP 3: Register + log in a test recruiter, post a job")
    print("=" * 70)
    # A) Demonstrate behavior of POST /api/recruiter/auth/register (admin approval requirement)
    print("--> POST /api/recruiter/auth/register (Checking admin approval enforcement)")
    rec_reg_direct = client.post("/api/recruiter/auth/register")
    print(f"Response ({rec_reg_direct.status_code}): {rec_reg_direct.text}")
    assert rec_reg_direct.status_code == 403, "Expected 403 for recruiter direct registration"
    print("Admin approval requirement confirmed as designed.")

    # B) Onboard recruiter via the admin workflow
    recruiter_email = f"recruiter_{uid}@company.com"
    recruiter_pass = "RecruiterPass123!"

    print(f"--> POST /api/recruiter-requests (email={recruiter_email})")
    req_res = client.post(
        "/api/recruiter-requests",
        data={"name": f"Recruiter {uid}", "email": recruiter_email, "phone": "555-0100"}
    )
    print(f"Response ({req_res.status_code}): {req_res.text}")
    assert req_res.status_code == 200, f"Recruiter request failed: {req_res.text}"
    req_id = req_res.json()["id"]

    # Admin approves request
    print("--> Admin login: POST /api/auth/login")
    admin_login = client.post(
        "/api/auth/login",
        data={"email": "admin@example.com", "password": "AdminPassword123"}
    )
    assert admin_login.status_code == 200, f"Admin login failed: {admin_login.text}"
    admin_token = admin_login.json()["access_token"]

    print(f"--> POST /api/admin/recruiter-requests/{req_id}/approve")
    approve_res = client.post(
        f"/api/admin/recruiter-requests/{req_id}/approve",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    print(f"Response ({approve_res.status_code}): {approve_res.text}")
    assert approve_res.status_code == 200, f"Approval failed: {approve_res.text}"
    temp_pass = approve_res.json().get("temporary_password")
    assert temp_pass, "Temporary password missing in dev mode response"

    print(f"--> POST /api/recruiter/auth/login (email={recruiter_email})")
    rec_login = client.post(
        "/api/recruiter/auth/login",
        data={"username": recruiter_email, "password": temp_pass}
    )
    print(f"Response ({rec_login.status_code}): {rec_login.text}")
    assert rec_login.status_code == 200, f"Recruiter login failed: {rec_login.text}"
    recruiter_token = rec_login.json()["access_token"]
    recruiter_headers = {"Authorization": f"Bearer {recruiter_token}"}

    # C) Recruiter posts a job
    print("--> POST /api/recruiter/jobs")
    jd_text = (
        "We are looking for a Senior Distributed Systems Engineer with expertise in Python, "
        "FastAPI, PostgreSQL, Redis caching, Docker microservices, and asynchronous architecture."
    )
    job_res = client.post(
        "/api/recruiter/jobs",
        headers=recruiter_headers,
        data={
            "title": "Senior Distributed Systems Engineer - Order Processing",
            "description": jd_text,
            "branch": "Engineering",
            "salary_min": "1500000",
            "salary_max": "2500000",
            "currency": "INR",
            "location_text": "Bengaluru, India",
            "requirements": "Python, FastAPI, PostgreSQL, Docker, Redis",
            "remote_type": "onsite"
        }
    )
    print(f"Response ({job_res.status_code}): {job_res.text}")
    assert job_res.status_code == 200, f"Job creation failed: {job_res.text}"
    job_id = job_res.json()["id"]
    print(f"Job created successfully with ID: {job_id}")
    print("STEP 3: PASS")

    # -------------------------------------------------------------------------
    # STEP 4: Candidate applies to the job
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print(f"STEP 4: Candidate applies to Job {job_id}")
    print("=" * 70)
    print(f"--> POST /api/candidate/jobs/{job_id}/apply")
    apply_res = client.post(
        f"/api/candidate/jobs/{job_id}/apply",
        headers=cand_headers
    )
    print(f"Response ({apply_res.status_code}): {apply_res.text}")
    assert apply_res.status_code == 200, f"Job apply failed: {apply_res.text}"
    apply_data = apply_res.json()
    application_id = apply_data.get("application_id") or apply_data.get("id")
    stage1_ats_score = apply_data.get("ats_score")
    print(f"Captured Application ID: {application_id}, Real Stage 1 ATS Score: {stage1_ats_score}")
    assert stage1_ats_score is not None, "ATS score is null"
    print("STEP 4: PASS")

    # -------------------------------------------------------------------------
    # STEP 5: Candidate uploads the project zip + description
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("STEP 5: Candidate uploads the project zip + description")
    print("=" * 70)
    proj_desc = "FastAPI order processing microservice with JWT auth, Redis caching, PostgreSQL, deployed via Docker"
    print(f"--> POST /api/candidate/profile/project-upload")
    with open(zip_path, "rb") as f:
        upload_res = client.post(
            "/api/candidate/profile/project-upload",
            headers=cand_headers,
            data={"description": proj_desc},
            files={"file": ("test_project.zip", f, "application/zip")}
        )
    print(f"Response ({upload_res.status_code}): {upload_res.text}")
    assert upload_res.status_code == 200, f"Project upload failed: {upload_res.text}"
    assert upload_res.json().get("filename") == "test_project.zip"
    # Ensure project_summary is NOT leaked to candidate
    assert "project_summary" not in upload_res.json(), "LEAK DETECTED: project_summary in upload response"
    print("STEP 5: PASS")

    # -------------------------------------------------------------------------
    # STEP 6: Confirm the backend-generated project summary actually exists
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("STEP 6: Confirm backend-generated project summary exists in DB")
    print("=" * 70)
    with Session(engine) as session:
        cand_user = session.exec(select(CandidateUser).where(CandidateUser.username == cand_username)).first()
        profile = session.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == cand_user.id)).first()
        summary_text = profile.project_summary if profile else None

    print(f"Database Project Summary Query Result:\n{summary_text}")
    assert summary_text and len(summary_text.strip()) > 20, "Project summary missing or empty in DB"
    # Sanity check content
    summary_lower = summary_text.lower()
    has_keywords = any(k in summary_lower for k in ["fastapi", "docker", "order", "redis", "postgres", "microservice"])
    print(f"Sanity check keywords present: {has_keywords}")
    assert has_keywords, f"Project summary does not mention relevant keywords: {summary_text}"
    print("STEP 6: PASS")

    # -------------------------------------------------------------------------
    # STEP 7: Run the JD-vs-summary matching score
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("STEP 7: Run JD-vs-summary matching score (POST /api/candidate/score-project)")
    print("=" * 70)
    print(f"--> POST /api/candidate/score-project (application_id={application_id})")
    with open(zip_path, "rb") as f:
        score_proj_res = client.post(
            "/api/candidate/score-project",
            headers=cand_headers,
            data={
                "application_id": str(application_id),
                "ats_score": str(stage1_ats_score),
            },
            files={"file": ("test_project.zip", f, "application/zip")}
        )
    print(f"Response ({score_proj_res.status_code}): {score_proj_res.text}")
    assert score_proj_res.status_code == 200, f"Score project failed: {score_proj_res.text}"
    score_proj_data = score_proj_res.json()
    project_score = score_proj_data.get("project_score")
    final_score = score_proj_data.get("final_score")
    priority_level = score_proj_data.get("priority_level")
    ai_recommendation = score_proj_data.get("ai_recommendation")
    print(f"Captured: project_score={project_score}, final_score={final_score}, priority={priority_level}")
    print(f"Recommendation: {ai_recommendation}")
    assert project_score is not None, "project_score is None"
    assert final_score is not None, "final_score is None"
    print("STEP 7: PASS")

    # -------------------------------------------------------------------------
    # STEP 8: Recruiter view — confirm both scores are visible together
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("STEP 8: Recruiter view — confirm scores match in applicants endpoint")
    print("=" * 70)
    print(f"--> GET /api/recruiter/jobs/{job_id}/applicants")
    applicants_res = client.get(
        f"/api/recruiter/jobs/{job_id}/applicants",
        headers=recruiter_headers
    )
    print(f"Response ({applicants_res.status_code}): {applicants_res.text}")
    assert applicants_res.status_code == 200, f"Applicants fetch failed: {applicants_res.text}"
    resp_data = applicants_res.json()
    applicants_list = resp_data.get("applicants", []) if isinstance(resp_data, dict) else resp_data
    this_app = next((a for a in applicants_list if a["id"] == application_id), None)
    assert this_app is not None, f"Application {application_id} not found in recruiter applicants list"
    rec_ats = this_app.get("ats_score")
    rec_proj = this_app.get("project_score")
    rec_final = this_app.get("final_score")
    print(f"Recruiter View for App {application_id}:")
    print(f"  ats_score:     {rec_ats} (Expected: {stage1_ats_score})")
    print(f"  project_score: {rec_proj} (Expected: {project_score})")
    print(f"  final_score:   {rec_final} (Expected: {final_score})")
    assert rec_ats == stage1_ats_score, f"ATS score mismatch: {rec_ats} != {stage1_ats_score}"
    assert rec_proj == project_score, f"Project score mismatch: {rec_proj} != {project_score}"
    assert rec_final == final_score, f"Final score mismatch: {rec_final} != {final_score}"
    print("STEP 8: PASS")

    # -------------------------------------------------------------------------
    # STEP 9: Move the applicant to Stage 1 'shortlisted'
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("STEP 9: Move applicant to Stage 1 shortlisted")
    print("=" * 70)
    print(f"--> PUT /api/recruiter/jobs/{job_id}/applicants/{application_id}/status (status=shortlisted)")
    status_update_res = client.put(
        f"/api/recruiter/jobs/{job_id}/applicants/{application_id}/status",
        headers=recruiter_headers,
        data={"status": "shortlisted", "notes": "Approved for Stage 2 Repo Verification"}
    )
    print(f"Response ({status_update_res.status_code}): {status_update_res.text}")
    assert status_update_res.status_code == 200, f"Status update failed: {status_update_res.text}"
    print("STEP 9: PASS")

    # -------------------------------------------------------------------------
    # STEP 10: Run the actual repo-verify batch & verify math
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("STEP 10: Run repo-verify batch & verify final_score math")
    print("=" * 70)
    print(f"--> POST /api/recruiter/jobs/{job_id}/repo-verify?slot_count=5")
    repo_verify_res = client.post(
        f"/api/recruiter/jobs/{job_id}/repo-verify?slot_count=5",
        headers=recruiter_headers
    )
    print(f"Response ({repo_verify_res.status_code}): {repo_verify_res.text}")
    assert repo_verify_res.status_code == 200, f"Repo verify failed: {repo_verify_res.text}"
    verify_data = repo_verify_res.json()
    shortlist = verify_data.get("shortlist", [])
    verified_cand = next((c for c in shortlist if c["application_id"] == application_id), None)
    assert verified_cand is not None, f"Candidate {application_id} not in repo-verify shortlist"

    cand_ats = verified_cand["ats_score"]
    cand_proj = verified_cand["project_score"]
    cand_final = verified_cand["final_score"]
    # Formula: 0.4 * ats + 0.6 * project
    expected_final = round(0.4 * cand_ats + 0.6 * cand_proj, 1)
    print(f"Math check: 0.4 * {cand_ats} + 0.6 * {cand_proj} = {expected_final} vs Received {cand_final}")
    assert abs(cand_final - expected_final) <= 0.1, f"Math discrepancy: {cand_final} != {expected_final}"
    print("STEP 10: PASS")

    # -------------------------------------------------------------------------
    # STEP 11: Confirm candidate-facing status is simplified correctly
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("STEP 11: Confirm candidate-facing status is simplified correctly")
    print("=" * 70)
    print("--> GET /api/candidate/profile/status")
    status_res = client.get("/api/candidate/profile/status", headers=cand_headers)
    print(f"Response ({status_res.status_code}): {status_res.text}")
    assert status_res.status_code == 200, f"Status check failed: {status_res.text}"
    status_payload = status_res.json()
    assert status_payload == {"status": "shortlisted"}, f"Unexpected payload: {status_payload}"

    # Also test /candidate/status alias
    print("--> GET /candidate/status")
    alias_res = client.get("/candidate/status", headers=cand_headers)
    print(f"Response ({alias_res.status_code}): {alias_res.text}")
    assert alias_res.status_code == 200
    assert alias_res.json() == {"status": "shortlisted"}

    # Confirm zero leak of score/analysis fields
    forbidden = ["ats_score", "project_score", "final_score", "reasoning", "transcript", "log"]
    for f_key in forbidden:
        assert f_key not in status_payload, f"LEAK DETECTED: {f_key} in status payload"
    print("Zero information leakage verified: candidate sees ONLY simplified status.")
    print("STEP 11: PASS")

    # -------------------------------------------------------------------------
    # STEP 12: LLM interview follow-up questions — backend-testable parts
    # -------------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("STEP 12: LLM interview access gating & submission test")
    print("=" * 70)
    # Check interview access before unlocked:
    # Notice: Stage 2 verified applicant has repo_match_score, but recruiter hasn't scheduled/unlocked yet
    print(f"--> GET /api/candidate/applications/{application_id}/interview_access (Before unlock)")
    access_before = client.get(f"/api/candidate/applications/{application_id}/interview_access")
    print(f"Response ({access_before.status_code}): {access_before.text}")
    assert access_before.status_code == 200
    # can_take_interview checks interview_status == 'unlocked'
    assert access_before.json().get("allowed") is False, "Interview should be locked before recruiter unlocks it"
    print("Gating verified: allowed=false before recruiter explicit unlock.")

    # Now unlock interview via recruiter batch schedule endpoint
    print(f"--> POST /recruiter/jobs/{job_id}/schedule-interviews?batch_size=5")
    sched_res = client.post(
        f"/recruiter/jobs/{job_id}/schedule-interviews?batch_size=5",
        headers=recruiter_headers
    )
    print(f"Response ({sched_res.status_code}): {sched_res.text}")
    assert sched_res.status_code == 200, f"Interview schedule failed: {sched_res.text}"

    # Check interview access after unlock
    print(f"--> GET /api/candidate/applications/{application_id}/interview_access (After unlock)")
    access_after = client.get(f"/api/candidate/applications/{application_id}/interview_access")
    print(f"Response ({access_after.status_code}): {access_after.text}")
    assert access_after.status_code == 200
    assert access_after.json().get("allowed") is True, f"Expected allowed=True after unlock: {access_after.text}"
    print("Interview access unlocked verified: allowed=true.")

    # Submit interview results
    print(f"--> POST /api/candidate/applications/{application_id}/submit_interview")
    sub_payload = {
        "risk_score": 4.0,
        "risk_level": "low",
        "eval_score": 94.0,
        "recommendation": "Candidate demonstrated deep mastery of asynchronous order processing, Redis cache eviction, and PostgreSQL locking.",
        "transcript": [
            {
                "question": "Can you explain how your FastAPI service prevents race conditions when multiple orders claim the same inventory item?",
                "answer": "We utilize PostgreSQL row-level locks (SELECT FOR UPDATE) within an atomic transaction combined with a Redis distributed lock for immediate rejection when inventory is zero."
            },
            {
                "question": "How did you configure Redis persistence to ensure inventory consistency during a Redis restart?",
                "answer": "We configured Redis with AOF (append-only file) set to everysec and treated PostgreSQL as the authoritative source of truth for inventory balance."
            }
        ],
        "evidence_url": "/api/evidence/sample_rec.webm"
    }
    sub_res = client.post(
        f"/api/candidate/applications/{application_id}/submit_interview",
        json=sub_payload
    )
    print(f"Response ({sub_res.status_code}): {sub_res.text}")
    assert sub_res.status_code == 200, f"Interview submission failed: {sub_res.text}"
    assert sub_res.json().get("interview_status") == "completed"
    print("Interview submission recorded successfully with completed status.")
    print("STEP 12: PASS")

    print("\n" + "=" * 70)
    print("ALL 12 STEPS EXECUTED AND PASSED AGAINST LIVE BACKEND!")
    print("=" * 70)

if __name__ == "__main__":
    run()
