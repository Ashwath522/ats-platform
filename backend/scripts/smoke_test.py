"""
End-to-end API smoke test — run it against local dev, a Postgres-backed
instance, or the live Render deployment:

    python scripts/smoke_test.py --base http://localhost:8000 \
        --admin-email admin@corelink.test --admin-password 'AdminPass123!'

Walks the full hiring pipeline: recruiter request (+ business verification)
→ admin approval → job post → candidate signup/profile/resume → apply →
project upload → shortlist → unlock → live AI interview (streamed turns) →
server evaluation → recruiter sees result. Also checks media persistence.
Exits non-zero on the first failure. Creates uniquely-named test users.
"""
import argparse
import io
import json
import sys
import time
import uuid
import zipfile

import httpx

OK = "\033[32m✓\033[0m"


def step(msg):
    print(f"{OK} {msg}")


def must(resp, code=200, what=""):
    if resp.status_code != code:
        print(f"✗ {what}: HTTP {resp.status_code} {resp.text[:400]}")
        sys.exit(1)
    try:
        return resp.json()
    except Exception:
        return resp.text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--admin-email", required=True)
    ap.add_argument("--admin-password", required=True)
    a = ap.parse_args()
    c = httpx.Client(base_url=a.base.rstrip("/"), timeout=60)
    tag = uuid.uuid4().hex[:6]

    h = must(c.get("/health"), what="health")
    step(f"health: db={h['database']['type']} {h['database']['status']}")

    # Recruiter request with business verification
    r = c.post("/api/recruiter-requests/validate", data={"name": "Smoke Recruiter", "email": f"x{tag}@mailinator.com", "phone": "+919845012345"})
    v = must(r, what="validate")
    assert v["blocked"], "disposable email must be blocked"
    step("validator blocks disposable email")
    rec_email = f"smoke.rec.{tag}@tcs.com"
    req = must(c.post("/api/recruiter-requests", data={
        "name": "Smoke Recruiter", "email": rec_email, "phone": "+919845012345",
        "company_name": "Tata Consultancy Services", "company_website": "https://www.tcs.com",
        "cin": "L22210MH1995PLC084781",
    }), what="recruiter request")
    step(f"recruiter request stored, verification={req['verification']}")

    admin = must(c.post("/api/auth/login", data={"email": a.admin_email, "password": a.admin_password}), what="admin login")
    ah = {"Authorization": f"Bearer {admin['access_token']}"}
    pending = must(c.get("/api/admin/recruiter-requests", headers=ah), what="list requests")
    rid = next(p["id"] for p in pending if p["email"] == rec_email)
    appr = must(c.post(f"/api/admin/recruiter-requests/{rid}/approve", headers=ah), what="approve")
    pw = appr.get("temporary_password")
    if not pw:
        print("! approval OK but no temporary password returned (DEV_MODE off) — set one via password reset to continue")
        return
    step("admin approved recruiter")
    rec = must(c.post("/api/auth/login", data={"email": rec_email, "password": pw}), what="recruiter login")
    rh = {"Authorization": f"Bearer {rec['access_token']}"}
    job = must(c.post("/api/recruiter/jobs", headers=rh, data={
        "title": f"Backend Engineer {tag}", "branch": "Mechanical",
        "description": "Build Python FastAPI services with PostgreSQL, Redis and Docker.",
        "requirements": "Python, FastAPI, PostgreSQL, Redis, Docker", "location_text": "Bengaluru",
    }), what="create job")
    job_id = job.get("id") or job.get("job", {}).get("id")
    step(f"job posted (id={job_id})")

    # Candidate
    cand_email = f"smoke.cand.{tag}@gmail.com"
    cand = must(c.post("/api/candidate/auth/register", data={"username": cand_email, "password": "Smoke@12345"}), what="candidate register")
    ch = {"Authorization": f"Bearer {cand['access_token']}"}
    must(c.put("/api/candidate/profile", headers=ch, json={"headline": "Backend Engineer", "branch": "Mechanical",
         "skills": ["Python", "FastAPI", "Redis"], "contact_email": cand_email}), what="profile")
    resume = b"Smoke Candidate\nBackend engineer, 3 years Python, FastAPI, PostgreSQL, Redis, Docker. Cut latency 80%."
    must(c.post("/api/candidate/profile/resume", headers=ch, files={"file": ("resume.txt", resume, "text/plain")}), what="resume upload")
    step("candidate registered, profile + resume uploaded")
    applied = must(c.post(f"/api/candidate/jobs/{job_id}/apply", headers=ch), what="apply")
    app_id = applied.get("application_id") or applied.get("id")
    step(f"applied (application={app_id}, ats={applied.get('ats_score')})")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("README.md", "# OrderTrack\nFastAPI + PostgreSQL + Redis API. Load tested 1200 req/s, p95 85ms.")
        z.writestr("main.py", "from fastapi import FastAPI\napp = FastAPI()\n")
    must(c.post("/api/candidate/score-project", headers=ch, data={"application_id": str(app_id)},
                files={"file": ("project.zip", buf.getvalue(), "application/zip")}), what="project upload")
    step("project uploaded and scored")

    must(c.post(f"/api/recruiter/jobs/applications/{app_id}/status", headers=rh, json={"status": "shortlisted"}), what="shortlist")
    must(c.post(f"/api/recruiter/jobs/{job_id}/applicants/{app_id}/unlock-interview", headers=rh), what="unlock")
    step("recruiter shortlisted + unlocked interview")

    s = must(c.post(f"/api/interview/applications/{app_id}/session", headers=ch), what="session")
    step(f"interview session {s['session_id']} — greeting: {s['greeting'][:70]}…")
    answers = [
        "I'm a backend engineer; I built order tracking APIs in FastAPI at scale and love performance work.",
        "I added a Redis cache which cut p95 latency from 900ms to 120ms; the trade-off was invalidation, validated with load tests.",
        "I'd check traces, find the slow query, add an index, then load test to confirm the fix.",
        "We chose Redis streams over Kafka to cut ops cost; documented the trade-off and shipped on time.",
        "We disagreed on a rewrite, benchmarked both options and the data settled it; we shipped on schedule.",
        "That's all, thanks!",
    ]
    for ans in answers:
        t0 = time.perf_counter()
        first = None
        events = []
        with c.stream("POST", f"/api/interview/sessions/{s['session_id']}/turn", headers=ch, json={"answer": ans}) as resp:
            if resp.status_code != 200:
                print("✗ turn", resp.status_code, resp.read()[:300]); sys.exit(1)
            for line in resp.iter_lines():
                if not line:
                    continue
                e = json.loads(line)
                if e["t"] == "d" and first is None:
                    first = time.perf_counter() - t0
                events.append(e)
        end = next(e for e in events if e["t"] == "end")
        text = "".join(e["v"] for e in events if e["t"] == "d")
        print(f"   [{end['action']:<16}] first words in {first*1000:.0f} ms via {end['provider']}: {text[:90]}")
        if end["done"]:
            break
    fin = must(c.post(f"/api/interview/sessions/{s['session_id']}/finish", headers=ch,
                      json={"proctoring": {"risk_score": 8, "risk_level": "low"}}), what="finish")
    assert "score" not in json.dumps(fin)
    step("interview finished (no score leaked to candidate)")

    apps = must(c.get(f"/api/recruiter/jobs/{job_id}/applicants", headers=rh), what="applicants")
    mine = next(x for x in apps["applicants"] if x["application_id"] == app_id)
    step(f"recruiter sees interview score={mine.get('interview_eval_score')} status={mine.get('interview_status')}")

    png = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000" "1f15c4890000000d49444154789c6300010000050001" "0d0a2db40000000049454e44ae426082")
    up = must(c.post("/api/candidate/profile/avatar", headers=ch, files={"file": ("a.png", png, "image/png")}), what="avatar")
    url = up.get("avatar_url")
    got = c.get(url if url.startswith("/") else "/" + url)
    assert got.status_code == 200, got.status_code
    step(f"avatar upload served back from {url}")
    print("\nALL SMOKE CHECKS PASSED")


if __name__ == "__main__":
    main()
