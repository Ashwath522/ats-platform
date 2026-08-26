import os
import sys
import json
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.abspath("."))

from app.services.groq_client import GroqClient
from app.services.gemini_client import GeminiClient

def test_llm():
    groq_key = os.environ.get("GROQ_API_KEY")
    gemini_key = os.environ.get("GEMINI_API_KEY")

    if not groq_key or not gemini_key:
        print("Error: Missing API keys in environment.")
        return

    groq_client = GroqClient(groq_key)
    gemini_client = GeminiClient(gemini_key)

    student = {"name": "Test User", "branch": "CS", "ats_score": 80}
    job = {
        "job_title": "Software Engineer", 
        "company_name": "Tech Corp", 
        "required_skills": ["Python", "React", "AWS"], 
        "full_jd_text": "We need someone good at Python and React to build web apps. AWS deployment experience is a big plus."
    }
    project_text = "I built a web app using Python and React.js. It is very fast and I deployed it on AWS using EC2."

    print("Testing Groq...")
    groq_res = groq_client.analyze_project(student, project_text, job)
    print(json.dumps(groq_res, indent=2))

    print("\nTesting Gemini...")
    gemini_res = gemini_client.analyze_project(student, project_text, job)
    print(json.dumps(gemini_res, indent=2))

if __name__ == "__main__":
    test_llm()
