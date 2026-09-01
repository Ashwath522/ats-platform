import os
import sys
import random
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from sqlmodel import Session, select
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

from app.main import app
from app.db import engine, User, RecruiterUser, CandidateUser, Job, Application, CandidateProfile, Resume, init_db
from app.auth import hash_password

client = TestClient(app)

ADMIN_EMAIL = "ashwathsam521+admin@gmail.com"
ADMIN_PASSWORD = "DemoAdmin123!"

RECRUITERS = [
    {"email": "ashwathsam521+recruiter1@gmail.com", "name": "Alice Core", "company": "Global Core Engineering", "password": "DemoRecruiter1!"}
]

# Generate 20 candidates across Civil, Mechanical, Chemical
CANDIDATES = []

mech_skills = ["SolidWorks", "AutoCAD", "MATLAB", "Finite Element Analysis", "Thermodynamics", "Fluid Mechanics", "HVAC", "ANSYS", "CAD"]
civil_skills = ["AutoCAD", "Revit", "STAAD Pro", "Surveying", "Structural Analysis", "Geotechnical Engineering", "Construction Management"]
chem_skills = ["Aspen Plus", "Chemical Engineering", "Mass Transfer", "Heat Transfer", "Process Design", "Fluid Dynamics", "P&ID"]

for i in range(1, 8):
    CANDIDATES.append({
        "email": f"ashwathsam521+mech{i}@gmail.com",
        "name": f"Mech Candidate {i}",
        "password": f"DemoMech{i}!",
        "type": "mechanical",
        "headline": "Mechanical Engineer",
        "resume_content": [
            f"Mech Candidate {i}",
            "Mechanical Engineer",
            f"Skills: {', '.join(random.sample(mech_skills, 5))}",
            "Experience:",
            f"- Mechanical Engineer at Company {i} (2020 - Present)",
            "  Designed and analyzed mechanical systems.",
            "  Worked on thermal management and HVAC systems."
        ],
        "project_description": "Designed a high-efficiency HVAC system for a commercial building. Used AutoCAD and MATLAB for thermal simulations."
    })
    
for i in range(1, 8):
    CANDIDATES.append({
        "email": f"ashwathsam521+civil{i}@gmail.com",
        "name": f"Civil Candidate {i}",
        "password": f"DemoCivil{i}!",
        "type": "civil",
        "headline": "Civil / Structural Engineer",
        "resume_content": [
            f"Civil Candidate {i}",
            "Civil Engineer",
            f"Skills: {', '.join(random.sample(civil_skills, 5))}",
            "Experience:",
            f"- Structural Engineer at BuildCorp {i} (2019 - Present)",
            "  Designed high-rise residential buildings. Conducted structural integrity analysis using STAAD Pro."
        ],
        "project_description": "Structural analysis of a 10-story building subjected to seismic loads using STAAD Pro."
    })

for i in range(1, 7):
    CANDIDATES.append({
        "email": f"ashwathsam521+chem{i}@gmail.com",
        "name": f"Chem Candidate {i}",
        "password": f"DemoChem{i}!",
        "type": "chemical",
        "headline": "Chemical Process Engineer",
        "resume_content": [
            f"Chem Candidate {i}",
            "Chemical Engineer",
            f"Skills: {', '.join(random.sample(chem_skills, 5))}",
            "Experience:",
            f"- Process Engineer at ChemCo {i} (2021 - Present)",
            "  Optimized distillation column efficiency by 15%. Process simulation using Aspen Plus."
        ],
        "project_description": "Simulation and optimization of a multicomponent distillation column using Aspen Plus."
    })

JOBS = [
    {"recruiter_idx": 0, "title": "Senior Mechanical Engineer", "desc": "Looking for a seasoned mechanical engineer to design and test HVAC and thermal management systems.", "reqs": "Mechanical Engineering, HVAC, SolidWorks, Thermodynamics, MATLAB", "type": "mechanical"},
    {"recruiter_idx": 0, "title": "Structural Engineer", "desc": "Join our civil engineering team to design and evaluate structural integrity of modern commercial buildings against seismic loads.", "reqs": "Civil Engineering, STAAD Pro, Structural Analysis, AutoCAD", "type": "civil"},
    {"recruiter_idx": 0, "title": "Chemical Process Safety Engineer", "desc": "We need a chemical engineer focused on process safety and distillation column optimization.", "reqs": "Chemical Engineering, Aspen Plus, P&ID, Mass Transfer", "type": "chemical"},
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
    if user: return user
    user = User(name=name, email=email, role=role, password_hash=hash_password(password), email_verified=True)
    session.add(user)
    if role == "recruiter":
        session.add(RecruiterUser(username=email, password_hash=hash_password(password), company=company, name=name))
    elif role == "candidate":
        session.add(CandidateUser(username=email, password_hash=hash_password(password), name=name))
    session.commit()
    session.refresh(user)
    return user

def login(email, password):
    resp = client.post("/api/auth/login", data={"email": email, "password": password})
    if resp.status_code != 200:
        # Fallback to candidate auth if needed
        resp = client.post("/api/candidate/auth/login", data={"username": email, "password": password})
    return resp.json()["access_token"]

def clear_db():
    print("Clearing database...")
    db_path = os.path.join(os.environ.get("ATS_DATA_DIR", os.path.join(os.path.dirname(__file__), "../data")), "ats.db")
    if os.path.exists(db_path):
        os.remove(db_path)
    chroma_path = os.path.join(os.environ.get("ATS_DATA_DIR", os.path.join(os.path.dirname(__file__), "../data")), "chroma_db")
    import shutil
    if os.path.exists(chroma_path):
        shutil.rmtree(chroma_path)

def seed():
    clear_db()
    print("Initializing Database...")
    init_db()
    
    with Session(engine) as session:
        print("Creating Admin & Recruiters...")
        create_user_direct(session, ADMIN_EMAIL, "admin", ADMIN_PASSWORD, name="Admin")
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
        my_jobs = [j for j in JOBS if j["recruiter_idx"] == idx]
        for job in my_jobs:
            j_resp = client.post(
                "/api/recruiter/jobs",
                data={
                    "title": job["title"],
                    "description": job["desc"],
                    "requirements": job["reqs"],
                    "branch": job["type"],
                    "location_text": "Remote",
                    "remote_type": "remote"
                },
                headers=headers
            )
            created_jobs.append(j_resp.json())

    print("Generating Resumes and Project Summaries...")
    os.makedirs("/tmp/ats_demo_resumes", exist_ok=True)
    
    for c in CANDIDATES:
        token = login(c["email"], c["password"])
        headers = {"Authorization": f"Bearer {token}"}
        
        client.put("/api/candidate/profile", json={"headline": c["headline"], "contact_email": c["email"], "branch": c["type"]}, headers=headers)
            
        pdf_path = f"/tmp/ats_demo_resumes/{c['name'].replace(' ', '_')}.pdf"
        generate_pdf_resume(c["resume_content"], pdf_path)
        
        print(f"Uploading resume for {c['name']}...")
        with open(pdf_path, "rb") as f:
            res_resp = client.post("/api/candidate/profile/resume", files={"file": (f"{c['name']}.pdf", f, "application/pdf")}, headers=headers)
        
        print(f"Uploading project description for {c['name']}...")
        proj_resp = client.post("/api/candidate/profile/project", data={"description": c["project_description"]}, headers=headers)
        
        jobs_to_apply = random.sample(created_jobs, 3)
        for job in jobs_to_apply:
            apply_resp = client.post(f"/api/candidate/jobs/{job['id']}/apply", headers=headers)

    print("Generating credentials report...")
    creds = f"""# CoreLink Demo Credentials

## Admin
- **Email:** {ADMIN_EMAIL}
- **Password:** {ADMIN_PASSWORD}

## Recruiters
- **Email:** {RECRUITERS[0]['email']}
- **Password:** {RECRUITERS[0]['password']}

## Candidates
Total: 20 Core Branch Candidates
(Passwords are DemoMechX!, DemoCivilX!, DemoChemX! depending on their branch)
"""
    with open("../demo_credentials.md", "w") as f:
        f.write(creds)
        
    print("Done! Seed data created.")

if __name__ == "__main__":
    seed()
