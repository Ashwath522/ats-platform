"""
Development seed for the v2 portal: realistic students across core branches,
jobs, applications in every pipeline stage, human interviews and offers.

    cd backend && python scripts/seed_portal_demo.py            # uses DATABASE_URL / ATS_DATA_DIR
    python scripts/seed_portal_demo.py --recruiter rahul.v@tcs.com

Idempotent-ish: skips users that already exist. NEVER run against production.
Logins created (password for all: Demo@12345):
  students  : <first>.<last>@demo.corelink.dev
  recruiter : the --recruiter account (created if missing, password Demo@12345)
"""
import argparse
import json
import os
import random
import sys
from datetime import timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlmodel import Session, select  # noqa: E402

from app.auth import hash_password  # noqa: E402
from app.db import (  # noqa: E402
    Application, CandidateProfile, CandidateUser, CompanyProfile, Job, Offer, RecruiterUser,
    ScheduledInterview, StudentProject, User, engine, init_db, utc_now,
)

PW = "Demo@12345"
random.seed(7)

STUDENTS = [
    ("Rahul", "Sharma", "NIT Trichy", "mechanical", 8.6, ["SolidWorks", "ANSYS", "CAD", "CAE", "MATLAB"]),
    ("Priya", "Nair", "VIT Vellore", "eee", 8.4, ["MATLAB", "Power Systems", "Control Systems", "PLC Programming"]),
    ("Aditya", "Kulkarni", "PES University", "mechanical", 8.2, ["AutoCAD", "Manufacturing Processes", "CNC Machining"]),
    ("Sneha", "Reddy", "RVCE", "ece", 8.1, ["Embedded Systems", "PCB Design", "VLSI", "Verilog"]),
    ("Karthik", "S", "Anna University", "civil", 8.0, ["Structural Design", "AutoCAD", "STAAD.Pro"]),
    ("Neha", "Gupta", "IIT Madras", "chemical", 8.3, ["Aspen Plus", "HYSYS", "Process Design", "HAZOP"]),
    ("Arjun", "Mehta", "BITS Pilani", "aerospace", 7.9, ["CFD", "ANSYS Fluent", "CATIA", "Propulsion Systems"]),
    ("Rohit", "Verma", "DTU", "automobile", 7.8, ["Vehicle Dynamics", "EV Powertrain", "CATIA", "DFMEA"]),
    ("Ananya", "Iyer", "NIT Surathkal", "eee", 8.1, ["Power Systems", "MATLAB/Simulink", "SCADA"]),
    ("Vikram", "Rao", "IIIT Hyderabad", "ece", 7.6, ["Embedded C", "Arduino", "IoT", "PCB Design"]),
    ("Meera", "Krishnan", "College of Engineering Pune", "metallurgy", 8.0, ["Heat Treatment", "Metallography", "SEM", "NDT"]),
    ("Pooja", "Desai", "MIT Manipal", "civil", 7.7, ["Revit", "Primavera", "Concrete Design"]),
]

JOBS = [
    ("Mechanical Design Intern", "mechanical", "internship", "Bangalore", "SolidWorks, ANSYS, GD&T, CAD"),
    ("CAE Engineer Trainee", "mechanical", "full-time", "Bangalore", "ANSYS, FEA, CAE, MATLAB"),
    ("Embedded Systems Intern", "ece", "internship", "Bangalore", "Embedded C, Arduino, PCB Design, IoT"),
    ("Electrical Design Engineer", "eee", "full-time", "Bangalore", "Power Systems, MATLAB/Simulink, PLC Programming"),
    ("Process Engineer", "chemical", "full-time", "Hyderabad", "Aspen Plus, HYSYS, HAZOP, Process Design"),
    ("Automotive Systems Intern", "automobile", "internship", "Bangalore", "Vehicle Dynamics, CATIA, EV Powertrain"),
    ("Site Engineer – Structures", "civil", "full-time", "Pune", "STAAD.Pro, AutoCAD, Structural Design"),
    ("Materials Engineer", "metallurgy", "full-time", "Chennai", "Heat Treatment, Metallography, NDT"),
]

STAGES = ["ats_check", "ats_check", "repo_verification", "shortlisted", "shortlisted", "automated_interview", "rejected"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--recruiter", default="rahul.v@tcs.com")
    a = ap.parse_args()
    init_db()
    now = utc_now()
    with Session(engine) as s:
        rec = s.exec(select(RecruiterUser).where(RecruiterUser.username == a.recruiter)).first()
        if not rec:
            rec = RecruiterUser(username=a.recruiter, password_hash=hash_password(PW))
            s.add(rec)
            if not s.exec(select(User).where(User.email == a.recruiter)).first():
                s.add(User(name="Demo Recruiter", email=a.recruiter, role="recruiter", password_hash=hash_password(PW), email_verified=True))
            s.commit(); s.refresh(rec)
        if not s.exec(select(CompanyProfile).where(CompanyProfile.owner_recruiter_id == rec.id)).first():
            s.add(CompanyProfile(owner_recruiter_id=rec.id, name="Tata Consultancy Services", tagline="Building on belief",
                                 industries_json=json.dumps(["Engineering Services", "Technology", "Manufacturing"]),
                                 headquarters="Mumbai, India", location_text="Bangalore, Karnataka, India", website="https://www.tcs.com",
                                 size="10,001+ employees", founded="1968",
                                 about="Global engineering and technology services company hiring core engineers for design, manufacturing and R&D programmes.",
                                 hiring_focus_json=json.dumps(["Mechanical Engineering", "Electrical Engineering", "Electronics & Communication", "Automotive Engineering", "Manufacturing", "R&D"])))
        jobs = []
        for i, (title, branch, jt, loc, req) in enumerate(JOBS):
            j = s.exec(select(Job).where(Job.recruiter_id == rec.id, Job.title == title)).first()
            if not j:
                j = Job(recruiter_id=rec.id, title=title, branch=branch, job_type=jt, location_text=f"{loc}, India",
                        description=f"{title} at our {loc} engineering centre. Work with cross-functional teams on real {branch} engineering programmes. Requirements: {req}.",
                        requirements=req, remote_type="onsite" if i % 3 else "hybrid", status="open" if i != 6 else "paused",
                        salary_min=400000 + i * 50000, salary_max=800000 + i * 60000, openings=random.randint(1, 6),
                        created_at=now - timedelta(days=30 - i * 3))
                s.add(j); s.commit(); s.refresh(j)
            jobs.append(j)

        for idx, (first, last, college, branch, cgpa, skills) in enumerate(STUDENTS):
            email = f"{first.lower()}.{last.lower()}@demo.corelink.dev"
            cu = s.exec(select(CandidateUser).where(CandidateUser.username == email)).first()
            if cu:
                continue
            cu = CandidateUser(username=email, password_hash=hash_password(PW), created_at=now - timedelta(days=40 - idx))
            s.add(cu); s.commit(); s.refresh(cu)
            s.add(CandidateProfile(candidate_id=cu.id, full_name=f"{first} {last}", headline=f"Final year {branch.title()} Engineering student",
                                   branch=branch, college=college, degree=f"B.Tech in {branch.title()} Engineering", grad_year=2027, current_year="Final Year",
                                   cgpa=cgpa, location_text="Bangalore, Karnataka", contact_email=email, skills_json=json.dumps(skills),
                                   bio=f"Final year {branch} engineering student at {college} who enjoys hands-on projects."))
            s.add(StudentProject(candidate_id=cu.id, title=f"{skills[0]} capstone project", description=f"Applied {', '.join(skills[:3])} to a real problem.",
                                 category="academic", tags_json=json.dumps(skills[:3]), status=random.choice(["verified", "verified", "under_review"]), month="Apr 2026", team_size=3))
            matching = [j for j in jobs if j.branch == branch] or jobs[:1]
            for k, job in enumerate(matching[:2]):
                stage = STAGES[(idx + k) % len(STAGES)]
                ats = random.randint(68, 93)
                proj = random.randint(60, 90) if stage not in ("ats_check",) else None
                app = Application(candidate_id=cu.id, job_id=job.id, ats_score=ats, matched_skills_json=json.dumps(skills[:3]),
                                  missing_skills_json=json.dumps([]), status=stage, applied_at=now - timedelta(days=12 - idx % 10, hours=idx),
                                  project_score=proj, repo_match_score=int(proj) if proj else None,
                                  final_score=round(0.4 * ats + 0.6 * proj, 1) if proj else None,
                                  interview_status="completed" if stage == "automated_interview" else ("unlocked" if stage == "shortlisted" and idx % 2 else "locked"),
                                  interview_eval_score=random.randint(65, 88) if stage == "automated_interview" else None,
                                  candidate_status="interview" if stage in ("shortlisted", "automated_interview") else ("not_selected" if stage == "rejected" else "applied"))
                s.add(app); s.commit(); s.refresh(app)
                if stage in ("shortlisted", "automated_interview"):
                    s.add(ScheduledInterview(application_id=app.id, job_id=job.id, candidate_id=cu.id, recruiter_id=rec.id,
                                             round_name=random.choice(["Technical Round 1", "Technical Round 2", "HR Round", "Project Discussion"]),
                                             starts_at=now + timedelta(days=idx % 6 + 1, hours=10 + idx % 5), mode="online" if idx % 3 else "onsite",
                                             meeting_link="https://meet.example.com/corelink-demo", interviewers="P. Kumar, S. Iyer"))
                if stage == "automated_interview" and idx % 2 == 0:
                    s.add(Offer(application_id=app.id, job_id=job.id, candidate_id=cu.id, recruiter_id=rec.id, ctc=f"₹{5 + idx % 3}.5 LPA",
                                ctc_amount=5.5 + idx % 3, offer_date=now - timedelta(days=idx % 7),
                                joining_date=(now + timedelta(days=60 + idx)).date().isoformat(),
                                status=random.choice(["accepted", "sent", "negotiation"])))
        s.commit()
    print("Seeded demo portal data (password for all demo users: Demo@12345)")


if __name__ == "__main__":
    main()
