"""Demo students and applications on the DEMO companies (for demos and testing).

Everything created here is clearly fictional and easy to spot and remove:
  * student logins live under  …@students.demo.corelink  (no real inbox),
  * they only apply to the DEMO companies' jobs, so real recruiters never see
    them, and
  * public landing-page numbers exclude all demo data (admin_portal.public_stats).

create_or_refresh() is idempotent (students matched by email, applications by
student + job). remove() deletes the demo students and everything they created.
"""
from __future__ import annotations

import json
import random
import secrets
from datetime import timedelta
from typing import Dict, List

from sqlalchemy import delete as sa_delete, or_
from sqlmodel import Session, select

from ..auth import hash_password
from ..db import (
    Application, CandidateProfile, CandidateUser, InterviewSession, Job, Offer, RecruiterNote, SavedJob,
    ScheduledInterview, engine, utc_now,
)
from .demo_company_data import DEMO_EMAIL_DOMAIN

STUDENT_DOMAIN = f"students.{DEMO_EMAIL_DOMAIN}"

# Fictional names, spread across states. (first, last, city, college, branch, grad_year, cgpa)
STUDENTS = [
    ("Aarav", "Nair", "Kochi", "Government Engineering College, Thrissur", "mechanical", 2026, 8.2),
    ("Diya", "Kulkarni", "Pune", "PES University", "civil", 2026, 8.7),
    ("Kabir", "Sethi", "Delhi", "Netaji Subhas University of Technology", "eee", 2027, 7.9),
    ("Ishita", "Rao", "Bengaluru", "Atria Institute of Technology", "ece", 2026, 8.9),
    ("Rohan", "Patil", "Kolhapur", "KIT's College of Engineering", "mechanical", 2025, 7.4),
    ("Meera", "Iyer", "Chennai", "SSN College of Engineering", "chemical", 2026, 8.5),
    ("Arjun", "Reddy", "Hyderabad", "CBIT Hyderabad", "automobile", 2027, 7.8),
    ("Sneha", "Ghosh", "Kolkata", "Heritage Institute of Technology", "civil", 2025, 8.1),
    ("Vivaan", "Mehta", "Ahmedabad", "Nirma University", "mechanical", 2026, 8.0),
    ("Ananya", "Pillai", "Thiruvananthapuram", "College of Engineering Trivandrum", "eee", 2026, 8.8),
    ("Yash", "Agarwal", "Jaipur", "Malaviya National Institute of Technology", "metallurgy", 2026, 7.6),
    ("Riya", "Shetty", "Mangaluru", "NMAM Institute of Technology", "aerospace", 2027, 8.3),
    ("Karthik", "Subramanian", "Coimbatore", "PSG College of Technology", "mechanical", 2026, 8.6),
    ("Pooja", "Yadav", "Lucknow", "Institute of Engineering and Technology, Lucknow", "civil", 2026, 7.7),
    ("Aditya", "Joshi", "Nagpur", "VNIT Nagpur", "chemical", 2025, 8.0),
    ("Nandini", "Hegde", "Mysuru", "The National Institute of Engineering", "ece", 2026, 8.4),
    ("Siddharth", "Das", "Bhubaneswar", "KIIT University", "eee", 2027, 7.5),
    ("Tanvi", "Deshmukh", "Nashik", "K. K. Wagh Institute", "mechanical", 2026, 8.2),
    ("Harsh", "Verma", "Bhopal", "MANIT Bhopal", "automobile", 2026, 7.9),
    ("Lakshmi", "Narayanan", "Madurai", "Thiagarajar College of Engineering", "civil", 2027, 8.9),
    ("Farhan", "Qureshi", "Aligarh", "Zakir Husain College of Engineering", "eee", 2026, 7.8),
    ("Neha", "Bansal", "Chandigarh", "Punjab Engineering College", "aerospace", 2026, 8.6),
    ("Manish", "Gowda", "Bengaluru", "RV College of Engineering", "mechanical", 2025, 8.1),
    ("Aisha", "Khan", "Mumbai", "VJTI Mumbai", "chemical", 2026, 8.3),
]

SKILLS = {
    "mechanical": ["SolidWorks", "AutoCAD", "ANSYS", "GD&T", "CATIA", "MATLAB", "CNC Programming", "Creo", "Thermal Analysis"],
    "civil": ["AutoCAD", "STAAD.Pro", "ETABS", "Revit", "Primavera", "Surveying", "Estimation", "Concrete Design"],
    "eee": ["MATLAB/Simulink", "PLC Programming", "ETAP", "SCADA", "Power Systems", "AutoCAD Electrical", "Control Systems"],
    "ece": ["Verilog", "Embedded C", "Arduino", "PCB Design", "MATLAB", "IoT", "VHDL", "Cadence"],
    "chemical": ["Aspen HYSYS", "Aspen Plus", "DWSIM", "HAZOP", "P&ID", "MATLAB", "Process Simulation"],
    "aerospace": ["ANSYS Fluent", "CFD", "CATIA", "MATLAB", "XFLR5", "Composites", "NASTRAN"],
    "automobile": ["CATIA", "NX", "MATLAB/Simulink", "Vehicle Dynamics", "Battery Systems", "DFMEA", "CAN Bus"],
    "metallurgy": ["Metallography", "Heat Treatment", "NDT", "Welding", "SEM/XRD", "Materials Testing", "Casting"],
}
HEADLINES = {
    "mechanical": "Mechanical engineering student · design & manufacturing",
    "civil": "Civil engineering student · structural design",
    "eee": "Electrical engineering student · power & automation",
    "ece": "Electronics student · embedded systems & VLSI",
    "chemical": "Chemical engineering student · process simulation",
    "aerospace": "Aerospace student · aerodynamics & CFD",
    "automobile": "Automobile engineering student · EV & powertrain",
    "metallurgy": "Metallurgy student · materials testing",
}
DEGREE = {
    "mechanical": "B.E. Mechanical Engineering", "civil": "B.E. Civil Engineering",
    "eee": "B.E. Electrical & Electronics Engineering", "ece": "B.E. Electronics & Communication Engineering",
    "chemical": "B.Tech Chemical Engineering", "aerospace": "B.E. Aeronautical Engineering",
    "automobile": "B.E. Automobile Engineering", "metallurgy": "B.Tech Metallurgical & Materials Engineering",
}
# Pipeline mix (most applications stay early, a few move further)
STAGES = ["ats_check"] * 5 + ["repo_verification"] * 3 + ["automated_interview"] * 2 + ["shortlisted"] * 2 + ["rejected"] * 2


def student_email(first: str, last: str) -> str:
    return f"{first.lower()}.{last.lower()}@{STUDENT_DOMAIN}"


def is_demo_student(username: str) -> bool:
    return bool(username) and username.lower().endswith("@" + STUDENT_DOMAIN)


def _demo_jobs(s: Session) -> List[Job]:
    from .demo_companies import _demo_recruiters
    rids = list(_demo_recruiters(s)) or [-1]
    return list(s.exec(select(Job).where(Job.recruiter_id.in_(rids), Job.status == "open").order_by(Job.id)).all())


def _req_skills(job: Job) -> List[str]:
    return [x.strip() for x in (job.requirements or "").replace(";", ",").split(",") if x.strip()][:12]


def create_or_refresh() -> Dict:
    created = applications = 0
    now = utc_now()
    with Session(engine) as s:
        jobs = _demo_jobs(s)
        if not jobs:
            return {"error": "no_demo_companies"}
        by_branch: Dict[str, List[Job]] = {}
        for j in jobs:
            by_branch.setdefault(j.branch or "", []).append(j)

        for i, (first, last, city, college, branch, grad, cgpa) in enumerate(STUDENTS):
            email = student_email(first, last)
            rnd = random.Random(email)          # same choices every refresh
            user = s.exec(select(CandidateUser).where(CandidateUser.username == email)).first()
            if user is None:
                # Random password nobody knows: these accounts are for display only.
                user = CandidateUser(username=email, password_hash=hash_password(secrets.token_urlsafe(24)))
                user.last_login_at = now - timedelta(days=(i * 7) % 6, hours=(i * 5) % 20)
                s.add(user)
                s.flush()
                created += 1
            skills = rnd.sample(SKILLS[branch], k=min(len(SKILLS[branch]), rnd.randint(4, 6)))
            prof = s.exec(select(CandidateProfile).where(CandidateProfile.candidate_id == user.id)).first() or CandidateProfile(candidate_id=user.id)
            prof.full_name = f"{first} {last}"
            prof.branch = branch
            prof.headline = HEADLINES[branch]
            prof.bio = f"Final-year {DEGREE[branch].split(' ', 1)[1]} student at {college}. (Demo profile — not a real person.)"
            prof.college = college
            prof.degree = DEGREE[branch]
            prof.grad_year = grad
            prof.current_year = "4th year" if grad <= 2026 else "3rd year"
            prof.cgpa = cgpa
            prof.location_text = f"{city}, India"
            prof.contact_email = email
            prof.skills_json = json.dumps(skills)
            prof.updated_at = now
            s.add(prof)
            s.flush()

            pool = by_branch.get(branch) or jobs
            picks = rnd.sample(pool, k=min(len(pool), rnd.randint(2, 3)))
            if len(picks) < 2:
                picks += rnd.sample([j for j in jobs if j not in picks], k=1)
            have = {x.lower() for x in skills}
            for j in picks:
                app = s.exec(select(Application).where(Application.candidate_id == user.id, Application.job_id == j.id)).first()
                req = _req_skills(j)
                matched = [x for x in req if x.lower() in have]
                missing = [x for x in req if x.lower() not in have]
                score = int(max(38, min(93, 46 + 40 * (len(matched) / (len(req) or 1)) + (cgpa - 7.5) * 6 + rnd.randint(-6, 8))))
                if app is None:
                    app = Application(candidate_id=user.id, job_id=j.id)
                    app.applied_at = now - timedelta(days=rnd.randint(0, 24), hours=rnd.randint(0, 23))
                    app.status = rnd.choice(STAGES) if score >= 55 else rnd.choice(["ats_check", "ats_check", "rejected"])
                    applications += 1
                app.ats_score = score
                app.baseline_ats_score = score
                app.matched_skills_json = json.dumps(matched)
                app.missing_skills_json = json.dumps(missing)
                app.parse_method = "demo"
                if app.status in ("automated_interview", "shortlisted"):
                    app.interview_status = "completed" if app.status == "shortlisted" else "unlocked"
                    if app.status == "shortlisted":
                        app.interview_eval_score = min(95, score + rnd.randint(-4, 6))
                s.add(app)
        s.commit()
    return {"students": len(STUDENTS), "students_created": created, "applications_created": applications, **status()}


def _demo_student_ids(s: Session) -> List[int]:
    return list(s.exec(select(CandidateUser.id).where(CandidateUser.username.like(f"%@{STUDENT_DOMAIN}"))).all())


def status() -> Dict:
    with Session(engine) as s:
        ids = _demo_student_ids(s)
        apps = len(s.exec(select(Application.id).where(Application.candidate_id.in_(ids or [-1]))).all())
    return {"demo_students": len(ids), "demo_student_applications": apps}


def remove() -> Dict:
    with Session(engine) as s:
        ids = _demo_student_ids(s) or [-1]
        app_ids = list(s.exec(select(Application.id).where(Application.candidate_id.in_(ids))).all()) or [-1]
        n_students = len([i for i in ids if i != -1])
        n_apps = len([a for a in app_ids if a != -1])
        from ..db import DecisionAuditLog
        for row in s.exec(select(DecisionAuditLog).where(DecisionAuditLog.application_id.in_(app_ids))).all():
            row.application_id = None
            s.add(row)
        s.flush()
        try:
            from ..db import ProctorEvent, ProctorSnapshot
            sess_ids = list(s.exec(select(InterviewSession.id).where(InterviewSession.application_id.in_(app_ids))).all()) or [-1]
            s.execute(sa_delete(ProctorEvent).where(ProctorEvent.session_id.in_(sess_ids)))
            s.execute(sa_delete(ProctorSnapshot).where(ProctorSnapshot.session_id.in_(sess_ids)))
        except ImportError:  # pragma: no cover
            pass
        s.execute(sa_delete(Offer).where(Offer.application_id.in_(app_ids)))
        s.execute(sa_delete(ScheduledInterview).where(ScheduledInterview.application_id.in_(app_ids)))
        s.execute(sa_delete(InterviewSession).where(InterviewSession.application_id.in_(app_ids)))
        s.execute(sa_delete(RecruiterNote).where(RecruiterNote.application_id.in_(app_ids)))
        s.execute(sa_delete(Application).where(Application.id.in_(app_ids)))
        s.execute(sa_delete(SavedJob).where(SavedJob.candidate_id.in_(ids)))
        s.execute(sa_delete(CandidateProfile).where(CandidateProfile.candidate_id.in_(ids)))
        s.execute(sa_delete(CandidateUser).where(CandidateUser.id.in_(ids)))
        s.commit()
    return {"deleted": True, "demo_students": n_students, "demo_student_applications": n_apps}
