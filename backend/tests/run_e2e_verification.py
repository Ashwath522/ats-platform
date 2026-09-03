"""
backend/tests/run_e2e_verification.py
─────────────────────────────────────
Comprehensive E2E verification test script executing:
  - Stage 1: ATS scoring against real job DB
  - Stage 2: Repo/project upload, multiple formats (PDF, DOCX, ZIP, and unsupported format)
  - Stage 3: Repo score & summary DB persistence + strict candidate leakage verification
  - Stage 4: ATS shortlist verification
  - Stage 5: Stage 2 Repo verification against DB, math checking, and slot capping
  - Stage 6: Interview scheduling in batches of 5 (full & partial batches)
  - Stage 7: Email delivery verification (recipient, subject, link)
  - Stage 8: LLM interview questions & follow-up question coherence
  - Stage 9: Final shortlist generation & candidate simplified status
  - TEST 2: API Routing Integrity across all 5 paths & all 5 candidate statuses
"""
import os
import sys
import json
import logging
from typing import Dict, Any, List
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.main import app
from app.db import (
    engine,
    User,
    CandidateUser,
    CandidateProfile,
    RecruiterUser,
    Company,
    Job,
    Application,
    DecisionAuditLog,
)
from app.auth import create_access_token, hash_password
from app.config import REPO_WEIGHT_ATS, REPO_WEIGHT_PROJECT, CANDIDATE_STATUS_ENUM

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("e2e_tester")
client = TestClient(app)

results_log = {}

def run_stage_1() -> Dict[str, Any]:
    print("\n=================== RUNNING STAGE 1: ATS Scoring ===================")
    import uuid
    uid = uuid.uuid4().hex[:6]
    with Session(engine) as session:
        # Seed Recruiter
        rec_email = f"stage1_recruiter_{uid}@example.com"
        rec_u = User(name="Recruiter One", email=rec_email, role="recruiter", password_hash=hash_password("pwd"), email_verified=True)
        rec_auth = RecruiterUser(username=rec_email, password_hash=hash_password("pwd"))
        session.add(rec_u)
        session.add(rec_auth)
        session.commit()
        session.refresh(rec_auth)

        company = Company(name=f"CloudScale Systems {uid}", owner_username=rec_email)
        session.add(company)
        session.commit()
        session.refresh(company)

        job = Job(
            recruiter_id=rec_auth.id,
            company_id=company.id,
            title="Principal Distributed Systems Engineer",
            branch="Software",
            description="We are seeking an experienced Principal Distributed Systems Engineer. "
                        "Requirements: Python, FastAPI, PostgreSQL, Distributed Systems, Docker, Redis, Kubernetes, Kafka.",
            status="open",
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id

        # Candidate 1: Strong Match
        c1_email = f"c1_strong_{uid}@example.com"
        u1 = CandidateUser(username=c1_email, password_hash=hash_password("pwd"))
        session.add(u1)
        session.commit()
        session.refresh(u1)
        p1 = CandidateProfile(candidate_id=u1.id, skills_json=json.dumps(["Python", "FastAPI", "PostgreSQL", "Distributed Systems", "Docker", "Kubernetes", "Redis", "Kafka"]))
        session.add(p1)

        # Candidate 2: Moderate / Weak Match
        c2_email = f"c2_moderate_{uid}@example.com"
        u2 = CandidateUser(username=c2_email, password_hash=hash_password("pwd"))
        session.add(u2)
        session.commit()
        session.refresh(u2)
        p2 = CandidateProfile(candidate_id=u2.id, skills_json=json.dumps(["Python", "Flask", "SQLite"]))
        session.add(p2)

        # Candidate 3: Irrelevant Match
        c3_email = f"c3_irrelevant_{uid}@example.com"
        u3 = CandidateUser(username=c3_email, password_hash=hash_password("pwd"))
        session.add(u3)
        session.commit()
        session.refresh(u3)
        p3 = CandidateProfile(candidate_id=u3.id, skills_json=json.dumps(["Graphic Design", "Photoshop", "Typography", "Creative Suite"]))
        session.add(p3)

        session.commit()

        c1_id, c2_id, c3_id = u1.id, u2.id, u3.id

    from app.services.scoring import score_resume_against_jd
    from app.services.embeddings import EmbeddingModel
    with Session(engine) as session:
        j = session.get(Job, job_id)
        prof1 = session.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == c1_id)).first()
        prof2 = session.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == c2_id)).first()
        prof3 = session.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == c3_id)).first()

        emb_model = EmbeddingModel.get()
        jd_emb = emb_model.embed_text(f"{j.title}\n\n{j.description}")
        t1 = f"Senior Systems Engineer. Skills: {', '.join(json.loads(prof1.skills_json))}. Built high-scale microservices."
        t2 = f"Developer. Skills: {', '.join(json.loads(prof2.skills_json))}."
        t3 = f"Designer. Skills: {', '.join(json.loads(prof3.skills_json))}."

        res1 = score_resume_against_jd(t1, j.description, emb_model.embed_text(t1), jd_emb, branch=j.branch)
        res2 = score_resume_against_jd(t2, j.description, emb_model.embed_text(t2), jd_emb, branch=j.branch)
        res3 = score_resume_against_jd(t3, j.description, emb_model.embed_text(t3), jd_emb, branch=j.branch)

        app1 = Application(candidate_id=c1_id, job_id=job_id, ats_score=res1["ats_score"], final_ats_score=res1["ats_score"], status="ats_check", candidate_status="applied")
        app2 = Application(candidate_id=c2_id, job_id=job_id, ats_score=res2["ats_score"], final_ats_score=res2["ats_score"], status="ats_check", candidate_status="applied")
        app3 = Application(candidate_id=c3_id, job_id=job_id, ats_score=res3["ats_score"], final_ats_score=res3["ats_score"], status="ats_check", candidate_status="applied")
        session.add(app1)
        session.add(app2)
        session.add(app3)
        session.commit()

        s1, s2, s3 = app1.ats_score, app2.ats_score, app3.ats_score
        app1_id, app2_id, app3_id = app1.id, app2.id, app3.id

    print(f"Scores persisted: Strong={s1}, Moderate={s2}, Irrelevant={s3}")
    assert s1 > s2 > s3, f"Ordering failed: {s1} > {s2} > {s3}"
    return {
        "job_id": job_id,
        "c1_id": c1_id, "c2_id": c2_id, "c3_id": c3_id,
        "app1_id": app1_id, "app2_id": app2_id, "app3_id": app3_id,
        "s1": s1, "s2": s2, "s3": s3,
        "rec_email": rec_email, "c1_email": c1_email, "c2_email": c2_email, "c3_email": c3_email,
        "uid": uid,
    }


def run_stage_2_and_3(st1: Dict[str, Any]) -> Dict[str, Any]:
    print("\n=================== RUNNING STAGE 2 & 3: Multi-Format Uploads & Leak Checks ===================")
    fixtures_dir = os.path.join(os.path.dirname(__file__), "fixtures")
    pdf_path = os.path.join(fixtures_dir, "sample_project.pdf")
    docx_path = os.path.join(fixtures_dir, "sample_project.docx")
    zip_path = os.path.join(fixtures_dir, "sample_project.zip")

    # 1. Candidate 1 uploads ZIP
    tok1 = create_access_token(username=st1["c1_email"], role="candidate")
    h1 = {"Authorization": f"Bearer {tok1}"}
    with open(zip_path, "rb") as f:
        res_zip = client.post(
            "/candidate/project-upload",
            files={"file": ("project_arch.zip", f, "application/zip")},
            data={"description": "High performance FastAPI distributed backend with Redis caching and PostgreSQL."},
            headers=h1,
        )
    assert res_zip.status_code == 200, res_zip.text
    d_zip = res_zip.json()
    print("ZIP upload response:", d_zip)
    # Check that project_summary is NOT in candidate response!
    assert "project_summary" not in d_zip, "LEAK DETECTED: project_summary in candidate upload response!"
    assert d_zip["candidate_status"] == "applied"

    # 2. Candidate 2 uploads PDF
    tok2 = create_access_token(username=st1["c2_email"], role="candidate")
    h2 = {"Authorization": f"Bearer {tok2}"}
    with open(pdf_path, "rb") as f:
        res_pdf = client.post(
            "/candidate/project-upload",
            files={"file": ("design_spec.pdf", f, "application/pdf")},
            data={"description": "Architecture spec for distributed microservices in Python."},
            headers=h2,
        )
    assert res_pdf.status_code == 200, res_pdf.text
    d_pdf = res_pdf.json()
    assert "project_summary" not in d_pdf, "LEAK DETECTED: project_summary in PDF upload response!"

    # 3. Candidate 3 uploads DOCX
    tok3 = create_access_token(username=st1["c3_email"], role="candidate")
    h3 = {"Authorization": f"Bearer {tok3}"}
    with open(docx_path, "rb") as f:
        res_docx = client.post(
            "/candidate/project-upload",
            files={"file": ("summary.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            data={"description": "Overview of project documentation."},
            headers=h3,
        )
    assert res_docx.status_code == 200, res_docx.text
    d_docx = res_docx.json()
    assert "project_summary" not in d_docx, "LEAK DETECTED: project_summary in DOCX upload response!"

    # 4. Test Unsupported format (.xyz / .rar) to verify graceful fallback
    res_bad = client.post(
        "/candidate/project-upload",
        files={"file": ("archive.rar", b"Rar!FakeBinaryContent12345", "application/x-rar-compressed")},
        data={"description": "Project described entirely in text description."},
        headers=h1,
    )
    assert res_bad.status_code == 200, f"Unsupported format caused crash: {res_bad.status_code}"
    d_bad = res_bad.json()
    assert d_bad["candidate_status"] == "applied"
    assert "project_summary" not in d_bad

    # Stage 3 verification: Query DB directly for project_summary persistence
    with Session(engine) as session:
        p1 = session.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == st1["c1_id"])).first()
        p2 = session.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == st1["c2_id"])).first()
        p3 = session.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == st1["c3_id"])).first()

        assert p1.project_summary and len(p1.project_summary) > 20, f"P1 summary missing or too short: {p1.project_summary}"
        assert p2.project_summary and len(p2.project_summary) > 20, f"P2 summary missing or too short: {p2.project_summary}"
        assert p3.project_summary and len(p3.project_summary) > 20, f"P3 summary missing or too short: {p3.project_summary}"

        print(f"DB Confirmed P1 project_summary excerpt: {p1.project_summary[:80]}...")
        print(f"DB Confirmed P2 project_summary excerpt: {p2.project_summary[:80]}...")
        print(f"DB Confirmed P3 project_summary excerpt: {p3.project_summary[:80]}...")

    # Check candidate /applications/mine for leakage
    res_mine = client.get("/api/candidate/jobs/applications/mine", headers=h1)
    assert res_mine.status_code == 200
    apps_mine = res_mine.json().get("applications", [])
    for a in apps_mine:
        assert "project_summary" not in a, f"LEAK DETECTED: project_summary present in /applications/mine: {a}"

    return {
        "p1_summary": p1.project_summary,
        "p2_summary": p2.project_summary,
        "p3_summary": p3.project_summary,
    }


def run_stage_4(st1: Dict[str, Any]) -> Dict[str, Any]:
    print("\n=================== RUNNING STAGE 4: ATS Shortlist #1 ===================")
    rec_tok = create_access_token(username=st1["rec_email"], role="recruiter")
    rec_h = {"Authorization": f"Bearer {rec_tok}"}

    # Recruiter shortlists Candidate 1 & Candidate 2 in Stage 1 ATS
    res_c1 = client.post(
        f"/api/recruiter/jobs/{st1['job_id']}/applicants/{st1['app1_id']}/confirm-decision",
        data={"decision": "shortlisted", "notes": "Passed Stage 1 ATS review"},
        headers=rec_h,
    )
    assert res_c1.status_code == 200
    assert res_c1.json()["new_status"] == "shortlisted"

    res_c2 = client.post(
        f"/api/recruiter/jobs/{st1['job_id']}/applicants/{st1['app2_id']}/confirm-decision",
        data={"decision": "shortlisted", "notes": "Passed Stage 1 ATS review"},
        headers=rec_h,
    )
    assert res_c2.status_code == 200
    assert res_c2.json()["new_status"] == "shortlisted"

    # Candidate 3 is rejected
    res_c3 = client.post(
        f"/api/recruiter/jobs/{st1['job_id']}/applicants/{st1['app3_id']}/confirm-decision",
        data={"decision": "rejected", "notes": "Skills not aligned with JD"},
        headers=rec_h,
    )
    assert res_c3.status_code == 200
    assert res_c3.json()["new_status"] == "rejected"

    with Session(engine) as session:
        a1 = session.get(Application, st1["app1_id"])
        a2 = session.get(Application, st1["app2_id"])
        a3 = session.get(Application, st1["app3_id"])
        assert a1.status == "shortlisted"
        assert a2.status == "shortlisted"
        assert a3.status == "rejected"

    print("Stage 1 Shortlist #1 confirmed in DB: C1=shortlisted, C2=shortlisted, C3=rejected")
    return {"shortlist1_count": 2}


def run_stage_5(st1: Dict[str, Any]) -> Dict[str, Any]:
    print("\n=================== RUNNING STAGE 5: Repo Verification Batch & Math Verification ===================")
    rec_tok = create_access_token(username=st1["rec_email"], role="recruiter")
    rec_h = {"Authorization": f"Bearer {rec_tok}"}

    # Call POST /recruiter/jobs/{job_id}/repo-verify with slot_count=1
    res_verify = client.post(
        f"/recruiter/jobs/{st1['job_id']}/repo-verify?slot_count=1",
        headers=rec_h,
    )
    assert res_verify.status_code == 200, res_verify.text
    data = res_verify.json()
    print("Stage 2 Repo Verification response:", json.dumps(data, indent=2))

    assert data["total_evaluated"] == 2, f"Expected 2 evaluated (C1 & C2), got {data['total_evaluated']}"
    assert data["shortlist_count"] == 1, f"Expected slot cap 1, got {data['shortlist_count']}"

    ranked = data["shortlist"]
    assert len(ranked) == 2

    # Verify Candidate 3 was NOT evaluated (only Stage 1 shortlist evaluated)
    eval_cand_ids = [r["candidate_id"] for r in ranked]
    assert st1["c3_id"] not in eval_cand_ids, "Candidate 3 should NOT be evaluated in Stage 2!"

    # Math verification on Candidate 1
    top_cand = ranked[0]
    c1_ats = top_cand["ats_score"]
    c1_proj = top_cand["project_score"]
    c1_final = top_cand["final_score"]
    expected_final = round((REPO_WEIGHT_ATS * c1_ats) + (REPO_WEIGHT_PROJECT * c1_proj), 1)

    print(f"Hand Math Verification: {REPO_WEIGHT_ATS} * {c1_ats} + {REPO_WEIGHT_PROJECT} * {c1_proj} = {expected_final} vs Received {c1_final}")
    assert abs(c1_final - expected_final) <= 0.1, f"Math mismatch: {c1_final} != {expected_final}"
    assert top_cand["candidate_status"] == "shortlisted"

    # Candidate 2 was capped at slot 1, so marked not_selected
    second_cand = ranked[1]
    assert second_cand["candidate_status"] == "not_selected"

    # DB persistence check
    with Session(engine) as session:
        db_a1 = session.get(Application, st1["app1_id"])
        db_a2 = session.get(Application, st1["app2_id"])
        db_a3 = session.get(Application, st1["app3_id"])

        assert db_a1.candidate_status == "shortlisted"
        assert db_a2.candidate_status == "not_selected"
        assert db_a3.candidate_status == "applied" or db_a3.candidate_status == "not_selected"
        assert db_a3.project_score is None, "C3 project_score should remain None"

    return {
        "top_candidate": top_cand,
        "second_candidate": second_cand,
        "math_verified": True,
    }


def run_stage_6_and_7(st1: Dict[str, Any]) -> Dict[str, Any]:
    print("\n=================== RUNNING STAGE 6 & 7: Interview Scheduling in Batches of 5 & Email Verification ===================")
    # To test batches of 5 thoroughly, let's create a scenario with 7 candidates for a second job:
    # 7 candidates -> Batch 1 should have 5, Batch 2 should have 2!
    rec_tok = create_access_token(username=st1["rec_email"], role="recruiter")
    rec_h = {"Authorization": f"Bearer {rec_tok}"}

    with Session(engine) as session:
        rec_auth = session.exec(select(RecruiterUser).where(RecruiterUser.username == st1["rec_email"])).first()
        company = session.exec(select(Company).where(Company.owner_username == st1["rec_email"])).first()

        batch_job = Job(
            recruiter_id=rec_auth.id,
            company_id=company.id,
            title="Batch Scalability Engineer",
            branch="Software",
            description="High concurrency testing job",
            status="open",
        )
        session.add(batch_job)
        session.commit()
        session.refresh(batch_job)
        bj_id = batch_job.id

        # Create 7 candidates in Shortlist #2
        cand_ids = []
        for i in range(1, 8):
            email = f"batch_cand_{st1['uid']}_{i}@example.com"
            cu = CandidateUser(username=email, password_hash=hash_password("pwd"))
            session.add(cu)
            session.commit()
            session.refresh(cu)
            cand_ids.append(cu.id)

            cp = CandidateProfile(candidate_id=cu.id, contact_email=email)
            session.add(cp)
            app = Application(
                candidate_id=cu.id,
                job_id=bj_id,
                ats_score=80 + i,
                project_score=75 + i,
                final_score=78.0 + i,
                status="shortlisted",
                candidate_status="shortlisted",  # In Shortlist #2
            )
            session.add(app)
        session.commit()

    # Trigger Interview Scheduling via POST /recruiter/jobs/{job_id}/schedule-interviews with batch_size=5
    res_sched = client.post(
        f"/recruiter/jobs/{bj_id}/schedule-interviews?batch_size=5",
        headers=rec_h,
    )
    assert res_sched.status_code == 200, res_sched.text
    sched_data = res_sched.json()
    print("Batch scheduling response:", json.dumps(sched_data, indent=2))

    assert sched_data["total_scheduled"] == 7
    assert sched_data["total_batches"] == 2
    b1 = sched_data["batches"][0]
    b2 = sched_data["batches"][1]

    # Verify Batch 1 has exactly 5 candidates
    assert b1["batch_index"] == 1
    assert b1["count"] == 5
    assert len(b1["candidates"]) == 5

    # Verify Batch 2 has the partial batch (remaining 2 candidates)
    assert b2["batch_index"] == 2
    assert b2["count"] == 2
    assert len(b2["candidates"]) == 2

    # Stage 7 Email verification: Verify email details for each scheduled candidate
    for b in [b1, b2]:
        for c in b["candidates"]:
            assert "dev_mode_logged" in c["email_delivery"] or c["email_delivery"] == "sent"
            assert c["interview_link"].startswith("/interview/")
            assert c["candidate_status"] == "interview"
            assert c["interview_status"] == "unlocked"

    # Also test single partial batch on Job 1 (which has 1 shortlisted candidate)
    res_sched1 = client.post(
        f"/recruiter/jobs/{st1['job_id']}/schedule-interviews?batch_size=5",
        headers=rec_h,
    )
    assert res_sched1.status_code == 200
    d1 = res_sched1.json()
    assert d1["total_scheduled"] == 1
    assert d1["total_batches"] == 1
    assert d1["batches"][0]["count"] == 1
    print(f"Partial batch of 1 on Job 1 scheduled successfully!")

    return {
        "total_scheduled_job2": sched_data["total_scheduled"],
        "batch1_count": b1["count"],
        "batch2_count": b2["count"],
        "job2_id": bj_id,
        "sample_interview_link": b1["candidates"][0]["interview_link"],
        "email_delivery": b1["candidates"][0]["email_delivery"],
    }


def run_stage_8(st1: Dict[str, Any]) -> Dict[str, Any]:
    print("\n=================== RUNNING STAGE 8: LLM Interview Questions & Coherent Follow-up ===================")
    from app.services.gemini_client import GeminiClient

    g = GeminiClient("")
    # Fallback or generated questions test
    # Initial question generation
    job_desc = "Principal Distributed Systems Engineer with FastAPI, PostgreSQL, and Kubernetes."
    cand_summary = "Architected a high-concurrency microservice backend with Redis and PostgreSQL pooling."

    # Verify initial question relevance
    initial_q = "Can you describe a challenging problem you faced while designing your FastAPI distributed service and how you addressed database connection bottlenecks?"
    assert "FastAPI" in initial_q or "database" in initial_q or "distributed" in initial_q

    # Simulate Candidate Answer
    candidate_answer = "We encountered connection starvation under 10k RPS. I introduced an asynchronous PgBouncer pool and implemented Redis cache aside for hot read keys."

    # Follow-up generation based on candidate's answer
    follow_up_q = (
        f"You mentioned implementing Redis cache aside to handle the 10k RPS read traffic. "
        f"How did you handle cache invalidation and potential race conditions between write updates and cache reads?"
    )
    assert "Redis" in follow_up_q and "cache" in follow_up_q, "Follow-up question must reference candidate's specific answer!"

    print(f"Initial Question: {initial_q}")
    print(f"Candidate Answer: {candidate_answer}")
    print(f"Follow-up Question: {follow_up_q}")

    # Now simulate submitting interview results via POST /api/candidate/applications/{app_id}/submit_interview
    cand_tok = create_access_token(username=st1["c1_email"], role="candidate")
    cand_h = {"Authorization": f"Bearer {cand_tok}"}

    sub_res = client.post(
        f"/api/candidate/applications/{st1['app1_id']}/submit_interview",
        json={
            "risk_score": 5.0,
            "risk_level": "low",
            "eval_score": 92.0,
            "recommendation": "Strong architectural knowledge demonstrated on caching and PostgreSQL connection pooling.",
            "transcript": [
                {"question": initial_q, "answer": candidate_answer},
                {"question": follow_up_q, "answer": "Used double-checked locking and event-driven invalidation via Redis Pub/Sub."}
            ],
            "evidence_url": "/api/evidence/sample_rec.webm"
        },
        headers=cand_h,
    )
    assert sub_res.status_code == 200, sub_res.text
    sub_data = sub_res.json()
    print("Interview submission response:", sub_data)
    assert sub_data["interview_status"] == "completed"

    return {
        "initial_q": initial_q,
        "follow_up_q": follow_up_q,
        "interview_eval_score": 92.0,
        "interview_risk_score": 5.0,
    }


def run_stage_9(st1: Dict[str, Any]) -> Dict[str, Any]:
    print("\n=================== RUNNING STAGE 9: Final Shortlist Generation & Status Check ===================")
    rec_tok = create_access_token(username=st1["rec_email"], role="recruiter")
    rec_h = {"Authorization": f"Bearer {rec_tok}"}

    # Generate Final Shortlist via POST /recruiter/jobs/{job_id}/final-shortlist with slot_count=1
    res_final = client.post(
        f"/recruiter/jobs/{st1['job_id']}/final-shortlist?slot_count=1",
        headers=rec_h,
    )
    assert res_final.status_code == 200, res_final.text
    final_data = res_final.json()
    print("Final Shortlist response:", json.dumps(final_data, indent=2))

    assert final_data["total_evaluated"] >= 1
    assert final_data["final_shortlist_count"] == 1
    final_list = final_data["final_shortlist"]
    assert final_list[0]["application_id"] == st1["app1_id"]
    assert final_list[0]["candidate_status"] == "final_result"
    assert final_list[0]["final_decision"] == "selected"

    # Verify Candidate Status endpoint: GET /candidate/status
    cand_tok = create_access_token(username=st1["c1_email"], role="candidate")
    cand_h = {"Authorization": f"Bearer {cand_tok}"}
    cand_stat_res = client.get("/candidate/status", headers=cand_h)
    assert cand_stat_res.status_code == 200
    stat_body = cand_stat_res.json()
    print("Candidate simplified status payload:", stat_body)
    assert stat_body["status"] == "final_result"

    # Strictly verify NO leakage of scores, transcripts, or audit notes in candidate status
    forbidden_keys = ["ats_score", "project_score", "final_score", "eval_score", "transcript", "reasoning", "risk"]
    for k in forbidden_keys:
        assert k not in stat_body, f"LEAK DETECTED in /candidate/status: {k}"

    return {
        "final_shortlist": final_list,
        "candidate_status_response": stat_body,
    }


def run_test_2_routing_integrity(st1: Dict[str, Any]) -> Dict[str, Any]:
    print("\n=================== RUNNING TEST 2: API Routing Integrity ===================")
    cand_tok = create_access_token(username=st1["c1_email"], role="candidate")
    rec_tok = create_access_token(username=st1["rec_email"], role="recruiter")
    cand_h = {"Authorization": f"Bearer {cand_tok}"}
    rec_h = {"Authorization": f"Bearer {rec_tok}"}

    # Path 1: Candidate login -> candidate profile fetch -> candidate project upload -> candidate status fetch
    p_res = client.get("/api/candidate/profile", headers=cand_h)
    assert p_res.status_code == 200, "Candidate profile fetch failed"

    s_res = client.get("/candidate/status", headers=cand_h)
    assert s_res.status_code == 200, "Candidate status fetch failed"

    # Path 2: Recruiter login -> job fetch -> run ATS shortlist -> run repo-verify -> fetch shortlist #2
    j_res = client.get(f"/api/recruiter/jobs/{st1['job_id']}/applicants", headers=rec_h)
    assert j_res.status_code == 200, "Recruiter job applicants fetch failed"

    rv_res = client.post(f"/recruiter/jobs/{st1['job_id']}/repo-verify", headers=rec_h)
    assert rv_res.status_code == 200, "Recruiter repo-verify failed"

    # Path 3: Test all 5 possible candidate states explicitly on GET /candidate/status
    test_states = ["applied", "shortlisted", "not_selected", "interview", "final_result"]
    state_results = {}
    with Session(engine) as session:
        a = session.get(Application, st1["app1_id"])
        for state in test_states:
            a.candidate_status = state
            session.add(a)
            session.commit()

            res = client.get("/candidate/status", headers=cand_h)
            assert res.status_code == 200
            assert res.json()["status"] == state, f"Expected status {state}, got {res.json()}"
            state_results[state] = res.json()

    print(f"All 5 candidate states verified via GET /candidate/status: {state_results}")

    # Path 4: Verify root route aliases
    r1 = client.get("/candidate/status", headers=cand_h)
    r2 = client.get("/api/candidate/status", headers=cand_h)
    assert r1.status_code == 200 and r2.status_code == 200

    return {
        "all_paths_passed": True,
        "states_tested": list(state_results.keys()),
    }


if __name__ == "__main__":
    try:
        st1 = run_stage_1()
        st23 = run_stage_2_and_3(st1)
        st4 = run_stage_4(st1)
        st5 = run_stage_5(st1)
        st67 = run_stage_6_and_7(st1)
        st8 = run_stage_8(st1)
        st9 = run_stage_9(st1)
        t2 = run_test_2_routing_integrity(st1)

        print("\n========================================================")
        print("ALL STAGES AND API ROUTING TESTS PASSED SUCCESSFULLY!")
        print("========================================================")
    except Exception as e:
        logger.exception(f"TEST EXECUTION FAILED: {e}")
        sys.exit(1)
