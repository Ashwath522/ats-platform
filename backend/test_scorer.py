import os
import sys
import json
from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, os.path.abspath("."))

from app.services.scorer import score_student_job

def test_scorer():
    student = {"name": "Test User", "branch": "CS", "ats_score": 80}
    job = {
        "job_title": "Software Engineer", 
        "company_name": "Tech Corp", 
        "extracted_keywords": ["python", "react", "aws"], 
        "full_jd_text": "We need someone good at Python and React to build web apps. AWS deployment experience is a big plus."
    }
    project_texts = ["I built a web app using Python and React.js. It is very fast and I deployed it on AWS using EC2."]

    print("Running scorer...")
    res = score_student_job(student, project_texts, job)
    print("Scorer output:")
    print(json.dumps(res, indent=2))

if __name__ == "__main__":
    test_scorer()
