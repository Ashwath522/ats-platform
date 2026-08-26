from fastapi.testclient import TestClient
from app.main import app
import json

client = TestClient(app)

def test_score_project():
    print("Testing /api/candidate/score-project...")
    
    # Create a dummy file
    with open("dummy_project.txt", "w") as f:
        f.write("I built a web app using Python and React.js. It is very fast and I deployed it on AWS using EC2.")
    
    with open("dummy_project.txt", "rb") as f:
        response = client.post(
            "/api/candidate/score-project",
            data={"job_description": "We need a backend developer with Python, React and AWS skills."},
            files={"file": ("dummy_project.txt", f, "text/plain")}
        )
    
    print("Status:", response.status_code)
    try:
        print(json.dumps(response.json(), indent=2))
    except:
        print(response.text)

if __name__ == "__main__":
    test_score_project()
