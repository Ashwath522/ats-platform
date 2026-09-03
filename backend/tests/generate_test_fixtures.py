import os
import zipfile
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

def create_fixtures():
    os.makedirs("/tmp/testproj/cands", exist_ok=True)

    # 1. Candidate 2: Strong Distributed Systems Architect
    c2 = canvas.Canvas("/tmp/testproj/cands/resume_strong.pdf", pagesize=letter)
    c2.drawString(100, 750, "Alex Rivera - Principal Distributed Architect")
    c2.drawString(100, 720, "Skills: Python, FastAPI, PostgreSQL, Redis, Docker, Kubernetes, Kafka, Distributed Systems")
    c2.drawString(100, 690, "Experience: 10+ years architecting high-throughput distributed microservices.")
    c2.drawString(100, 660, "Scaled order processing engines to 50k RPS with Redis caching and PostgreSQL sharding.")
    c2.save()

    with zipfile.ZipFile("/tmp/testproj/cands/project_strong.zip", "w") as z:
        z.writestr("main.py", """
from fastapi import FastAPI, Depends, BackgroundTasks
import asyncio, redis, psycopg2

app = FastAPI(title="High-Throughput Distributed Engine")

@app.post("/orders/process")
async def process_order(order_data: dict):
    # Asynchronous event streaming and atomic transaction processing
    return {"status": "success", "distributed_trace_id": "trace-9912", "partition": 3}
""")
        z.writestr("README.md", """
# Production High-Throughput Distributed Microservice
Enterprise-grade distributed order processing engine built with FastAPI, PostgreSQL, Redis, and Docker.
Includes distributed lock management, transactional outbox pattern, and Kubernetes Helm charts.
""")

    # 2. Candidate 3: Medium / Mid-level Developer
    c3 = canvas.Canvas("/tmp/testproj/cands/resume_medium.pdf", pagesize=letter)
    c3.drawString(100, 750, "Jordan Taylor - Python Developer")
    c3.drawString(100, 720, "Skills: Python, Django, SQLite, Basic Docker, REST APIs, Git, HTML, CSS")
    c3.drawString(100, 690, "Experience: Built internal inventory and blog portals using Django and SQLite.")
    c3.drawString(100, 660, "Familiar with containerizing web apps with Docker.")
    c3.save()

    with zipfile.ZipFile("/tmp/testproj/cands/project_medium.zip", "w") as z:
        z.writestr("app.py", """
from flask import Flask
app = Flask(__name__)
@app.route("/")
def home():
    return "Simple blog portal"
""")
        z.writestr("README.md", """
# Simple Web App
Monolithic blog portal with SQLite database and HTML templates.
""")

    # 3. Candidate 4: Weak / Graphic Designer
    c4 = canvas.Canvas("/tmp/testproj/cands/resume_weak.pdf", pagesize=letter)
    c4.drawString(100, 750, "Morgan Lee - Senior Graphic & UI Designer")
    c4.drawString(100, 720, "Skills: Figma, Adobe Illustrator, Photoshop, Creative Suite, Brand Design, UI Wireframing")
    c4.drawString(100, 690, "Experience: Designed visual branding and UI mockups for mobile and web products.")
    c4.save()

    with zipfile.ZipFile("/tmp/testproj/cands/project_weak.zip", "w") as z:
        z.writestr("design.txt", "UI Wireframe specifications and brand color palettes in Figma.")
        z.writestr("README.md", "Portfolio of branding assets and vector illustrations.")

    # 4. Candidate 5: Backend Engineer
    c5 = canvas.Canvas("/tmp/testproj/cands/resume_cand5.pdf", pagesize=letter)
    c5.drawString(100, 750, "Taylor Swift - Backend Engineer")
    c5.drawString(100, 720, "Skills: Python, FastAPI, PostgreSQL, Docker, Redis")
    c5.save()

    with zipfile.ZipFile("/tmp/testproj/cands/project_cand5.zip", "w") as z:
        z.writestr("main.py", "from fastapi import FastAPI\napp = FastAPI()\n@app.get('/')\ndef index(): return {'status': 'ok'}")
        z.writestr("README.md", "FastAPI service with Docker deployment.")

    # 5. Candidate 6: DevOps Engineer
    c6 = canvas.Canvas("/tmp/testproj/cands/resume_cand6.pdf", pagesize=letter)
    c6.drawString(100, 750, "Sam River - Cloud & Platform Engineer")
    c6.drawString(100, 720, "Skills: Docker, Kubernetes, Python, Redis, Microservices")
    c6.save()

    with zipfile.ZipFile("/tmp/testproj/cands/project_cand6.zip", "w") as z:
        z.writestr("infra.py", "import docker\nprint('Docker orchestrator')\n")
        z.writestr("README.md", "Docker and Kubernetes orchestration tools.")

    print("All candidate test fixtures created successfully!")

if __name__ == "__main__":
    create_fixtures()
