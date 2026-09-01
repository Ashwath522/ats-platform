import os
import sys
import random
import io
from pathlib import Path

# Add backend dir to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from sqlmodel import Session, select
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

from app.main import app
from app.db import engine, User, RecruiterUser, CandidateUser, Job, Application, init_db
from app.auth import hash_password

client = TestClient(app)

ADMIN_EMAIL = "ashwathsam521+admin@gmail.com"
ADMIN_PASSWORD = "DemoAdmin123!"

RECRUITERS = [
    {"email": "ashwathsam521+recruiter1@gmail.com", "name": "Alice Recruiter", "company": "Tech Innovators Inc", "password": "DemoRecruiter1!"},
    {"email": "ashwathsam521+recruiter2@gmail.com", "name": "Bob Hiring", "company": "Data Driven LLC", "password": "DemoRecruiter2!"},
    {"email": "ashwathsam521+recruiter3@gmail.com", "name": "Charlie Talent", "company": "Cloud Systems Co", "password": "DemoRecruiter3!"},
]

CANDIDATES = [
    {
        "email": "ashwathsam521+candidate1@gmail.com",
        "name": "David Python",
        "password": "DemoCandidate1!",
        "type": "backend",
        "headline": "Backend Engineer",
        "resume_content": [
            "David Python",
            "Backend Engineer",
            "Skills: Python, FastAPI, Django, PostgreSQL, Docker, AWS, REST APIs, System Design, Microservices, Flask, SQLAlchemy, Redis",
            "Experience:",
            "- Senior Backend Engineer at TechCorp (2020 - Present)",
            "  Built scalable REST APIs using FastAPI and PostgreSQL. Deployed on AWS via Docker. Improved API latency by 40%.",
            "- Backend Developer at StartupX (2017 - 2020)",
            "  Developed Django-based monolithic applications. Managed MySQL databases and Redis caches."
        ]
    },
    {
        "email": "ashwathsam521+candidate2@gmail.com",
        "name": "Eve React",
        "password": "DemoCandidate2!",
        "type": "frontend",
        "headline": "Frontend Developer",
        "resume_content": [
            "Eve React",
            "Frontend / Full Stack Developer",
            "Skills: React, JavaScript, TypeScript, Node.js, Next.js, MongoDB, HTML, CSS, TailwindCSS, AWS, Redux, GraphQL",
            "Experience:",
            "- Frontend Engineer at WebWizards (2021 - Present)",
            "  Developed dynamic single-page applications using React and Next.js. Integrated GraphQL APIs and optimized page load times.",
            "- Web Developer at StudioY (2018 - 2021)",
            "  Built responsive UI components with TailwindCSS. Backend API development using Node.js and Express."
        ]
    },
    {
        "email": "ashwathsam521+candidate3@gmail.com",
        "name": "Frank Data",
        "password": "DemoCandidate3!",
        "type": "data",
        "headline": "Data & ML Engineer",
        "resume_content": [
            "Frank Data",
            "Machine Learning Engineer",
            "Skills: Python, Machine Learning, SQL, Pandas, NumPy, Scikit-learn, TensorFlow, PyTorch, Keras, AWS SageMaker, Deep Learning, NLP",
            "Experience:",
            "- ML Engineer at DataMinds (2019 - Present)",
            "  Built predictive models using PyTorch and Scikit-learn. Deployed ML pipelines to production.",
            "- Data Analyst at InsightsCo (2016 - 2019)",
            "  Performed data analysis using Pandas and SQL. Created dashboards for stakeholders."
        ]
    },
    {
        "email": "ashwathsam521+candidate4@gmail.com",
        "name": "Grace Chemical",
        "password": "DemoCandidate4!",
        "type": "chemical",
        "headline": "Process Engineer",
        "resume_content": [
            "Grace Chemical",
            "Process Safety Engineer",
            "Skills: Chemical Engineering, Aspen Plus, HAZOP, P&ID, Mass Transfer, Heat Transfer",
            "Experience:",
            "- Chemical Engineer at ChemCorp (2020 - Present)",
            "  Designed and optimized P&ID for new distillation columns.",
            "- Junior Process Engineer at PlantY (2018 - 2020)",
            "  Conducted HAZOP studies."
        ]
    },
]

JOBS = [
    {"recruiter_idx": 0, "title": "Senior Python Backend Engineer", "desc": "We are looking for a Senior Backend Engineer proficient in Python, FastAPI, and PostgreSQL. Must have experience with Docker and AWS.", "reqs": "Python, FastAPI, PostgreSQL, Docker, AWS, Microservices", "type": "backend"},
    {"recruiter_idx": 0, "title": "Backend Developer (Django)", "desc": "Join our team to maintain and build new features on our Django monolithic architecture. Redis and MySQL experience is a plus.", "reqs": "Python, Django, Redis, MySQL", "type": "backend"},
    {"recruiter_idx": 0, "title": "API Systems Engineer", "desc": "Design and build RESTful APIs and Microservices at scale. Strong Python and System Design skills required.", "reqs": "Python, REST APIs, System Design, Microservices", "type": "backend"},
    {"recruiter_idx": 0, "title": "Full Stack Engineer (Node/React)", "desc": "We need a versatile full-stack engineer. Node.js on the backend, React on the frontend. TypeScript required.", "reqs": "Node.js, React, TypeScript, Full Stack", "type": "frontend"},
    {"recruiter_idx": 0, "title": "Cloud Infrastructure Engineer", "desc": "Help us manage our AWS cloud. Docker, Kubernetes, Terraform, and Python scripting.", "reqs": "AWS, Docker, Kubernetes, Python", "type": "backend"},
    
    {"recruiter_idx": 1, "title": "Frontend React Developer", "desc": "Looking for a UI wizard. React, TailwindCSS, and Next.js. You will build our core customer portals.", "reqs": "React, TailwindCSS, Next.js, JavaScript, HTML, CSS", "type": "frontend"},
    {"recruiter_idx": 1, "title": "UI/UX Developer", "desc": "Focus on building beautiful interfaces. Strong CSS, JavaScript, and accessibility knowledge.", "reqs": "CSS, JavaScript, UI/UX, HTML", "type": "frontend"},
    {"recruiter_idx": 1, "title": "Lead Frontend Engineer", "desc": "Lead our frontend team. Deep React ecosystem knowledge, GraphQL, Redux, and TypeScript.", "reqs": "React, TypeScript, GraphQL, Redux", "type": "frontend"},
    {"recruiter_idx": 1, "title": "Data Scientist", "desc": "Extract insights from big data. Python, Pandas, NumPy, and basic machine learning skills.", "reqs": "Python, Pandas, NumPy, SQL", "type": "data"},
    {"recruiter_idx": 1, "title": "Machine Learning Engineer", "desc": "Deploy ML models to production. PyTorch, TensorFlow, Scikit-learn, and AWS SageMaker.", "reqs": "Machine Learning, PyTorch, TensorFlow, Scikit-learn", "type": "data"},
    
    {"recruiter_idx": 2, "title": "Senior NLP Engineer", "desc": "Work on LLMs and NLP tasks. Deep learning, PyTorch, Transformers, Python.", "reqs": "NLP, Deep Learning, PyTorch, Python, Transformers", "type": "data"},
    {"recruiter_idx": 2, "title": "Data Engineer", "desc": "Build robust data pipelines. SQL, Python, Airflow, Snowflake.", "reqs": "SQL, Python, Data Pipelines", "type": "data"},
    {"recruiter_idx": 2, "title": "Database Administrator", "desc": "Manage large PostgreSQL databases. Performance tuning, replication, backups.", "reqs": "PostgreSQL, SQL, Database Administration", "type": "backend"},
    {"recruiter_idx": 2, "title": "Full Stack Developer", "desc": "React on the frontend, Python/FastAPI on the backend. A true generalist.", "reqs": "React, Python, FastAPI, JavaScript", "type": "frontend"},
    {"recruiter_idx": 2, "title": "Software Engineer, Core Services", "desc": "Build the foundational microservices for our platform. Python, Docker, AWS.", "reqs": "Python, Docker, AWS, Microservices", "type": "backend"},
    {"recruiter_idx": 2, "title": "Chemical Process Engineer", "desc": "Optimize our chemical processing plant operations. Requires strong background in fluid dynamics and Aspen Plus.", "reqs": "Chemical Engineering, Aspen Plus, Fluid Dynamics, P&ID", "type": "chemical"},
]

def generate_pdf_resume(content_lines: list, filepath: str):
    c = canvas.Canvas(filepath, pagesize=letter)
    width, height = letter
    y = height - 50
    for line in content_lines:
        c.drawString(50, y, line)
        y -= 20
        if y < 50:
            c.showPage()
            y = height - 50
    c.save()

def create_user_direct(session: Session, email: str, role: str, password: str, name: str = "", company: str = ""):
    user = session.exec(select(User).where(User.email == email)).first()
    if user:
        return user
    
    user = User(name=name, email=email, role=role, password_hash=hash_password(password), email_verified=True)
    session.add(user)
    
    if role == "recruiter":
        rec = RecruiterUser(username=email, password_hash=hash_password(password), company=company, name=name)
        session.add(rec)
    elif role == "candidate":
        cand = CandidateUser(username=email, password_hash=hash_password(password), name=name)
        session.add(cand)
        
    session.commit()
    session.refresh(user)
    return user

def login(email, password):
    resp = client.post("/api/auth/login", data={"email": email, "password": password})
    assert resp.status_code == 200, f"Login failed for {email}: {resp.text}"
    return resp.json()["access_token"]

def seed():
    print("Initializing Database...")
    init_db()
    
    with Session(engine) as session:
        print("Creating Admin...")
        create_user_direct(session, ADMIN_EMAIL, "admin", ADMIN_PASSWORD, name="Admin")
        
        print("Creating Recruiters...")
        for r in RECRUITERS:
            create_user_direct(session, r["email"], "recruiter", r["password"], name=r["name"], company=r["company"])
            
        print("Creating Candidates...")
        for c in CANDIDATES:
            create_user_direct(session, c["email"], "candidate", c["password"], name=c["name"])

    print("Generating Jobs via API...")
    created_jobs = []
    for idx, r in enumerate(RECRUITERS):
        token = login(r["email"], r["password"])
        headers = {"Authorization": f"Bearer {token}"}
        
        # Check existing jobs for this recruiter
        resp = client.get("/api/recruiter/jobs", headers=headers)
        existing_jobs = resp.json()
        
        my_jobs = [j for j in JOBS if j["recruiter_idx"] == idx]
        for job in my_jobs:
            if not any(ej["title"] == job["title"] for ej in existing_jobs):
                j_resp = client.post(
                    "/api/recruiter/jobs",
                    data={
                        "title": job["title"],
                        "description": job["desc"],
                        "requirements": job["reqs"],
                        "branch": "software" if job["type"] in ["backend", "frontend", "data"] else "chemical",
                        "location_text": "Remote",
                        "remote_type": "remote"
                    },
                    headers=headers
                )
                assert j_resp.status_code == 200, j_resp.text
                created_jobs.append(j_resp.json())
            else:
                created_jobs.append(next(ej for ej in existing_jobs if ej["title"] == job["title"]))

    print("Generating Resumes and Submitting Applications...")
    os.makedirs("/tmp/ats_demo_resumes", exist_ok=True)
    
    for c in CANDIDATES:
        token = login(c["email"], c["password"])
        headers = {"Authorization": f"Bearer {token}"}
        
        # Profile setup
        client.put("/api/candidate/profile", json={"headline": c["headline"], "contact_email": c["email"]}, headers=headers)
        
        # Check if already applied
        apps_resp = client.get("/api/candidate/applications", headers=headers)
        if apps_resp.json().get("applications"):
            print(f"Candidate {c['email']} already has applications, skipping.")
            continue
            
        pdf_path = f"/tmp/ats_demo_resumes/{c['name'].replace(' ', '_')}.pdf"
        generate_pdf_resume(c["resume_content"], pdf_path)
        
        print(f"Uploading resume for {c['name']}...")
        with open(pdf_path, "rb") as f:
            res_resp = client.post("/api/candidate/profile/resume", files={"file": (f"{c['name']}.pdf", f, "application/pdf")}, headers=headers)
            assert res_resp.status_code == 200, res_resp.text
            
        # Select jobs to apply (some strong match, some weak)
        # Apply to 5-6 jobs
        jobs_to_apply = random.sample(created_jobs, 6)
        
        for job in jobs_to_apply:
            apply_resp = client.post(f"/api/candidate/jobs/{job['id']}/apply", headers=headers)
            assert apply_resp.status_code == 200, apply_resp.text

    print("Updating Application Statuses...")
    status_options = ["reviewed", "shortlisted", "rejected", "pending"]
    
    for r in RECRUITERS:
        token = login(r["email"], r["password"])
        headers = {"Authorization": f"Bearer {token}"}
        
        jobs_resp = client.get("/api/recruiter/jobs", headers=headers)
        for job in jobs_resp.json():
            apps_resp = client.get(f"/api/recruiter/jobs/{job['id']}/applicants", headers=headers)
            for app in apps_resp.json().get("applicants", []):
                # Update status randomly
                if app["status"] == "applied":
                    new_status = random.choice(status_options)
                    if new_status != "pending":
                        status_str = "applied" if new_status == "pending" else new_status
                        client.put(
                            f"/api/recruiter/jobs/{job['id']}/applicants/{app['application_id']}/status",
                            data={"status": status_str},
                            headers=headers
                        )
                        
    print("Generating credentials report...")
    creds = f"""# ATS Platform Demo Credentials

## Admin
- **Email:** {ADMIN_EMAIL}
- **Password:** {ADMIN_PASSWORD}

## Recruiters
"""
    for i, r in enumerate(RECRUITERS):
        creds += f"""### Recruiter {i+1}
- **Name:** {r['name']}
- **Company:** {r['company']}
- **Email:** {r['email']}
- **Password:** {r['password']}
"""
    creds += "\n## Candidates\n"
    for i, c in enumerate(CANDIDATES):
        creds += f"""### Candidate {i+1}
- **Name:** {c['name']}
- **Profile:** {c['headline']}
- **Email:** {c['email']}
- **Password:** {c['password']}
"""
    
    with open("../demo_credentials.md", "w") as f:
        f.write(creds)
        
    print("Done! Seed data created. Credentials written to demo_credentials.md")

if __name__ == "__main__":
    seed()
