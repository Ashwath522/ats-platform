import pytest
from sqlmodel import Session, select
from app.db import RecruiterPost, RecruiterUser
import sys
import os
import uuid

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_recruiter_posts():
    uname = f"post_tester_{uuid.uuid4().hex[:8]}@example.com"
    
    from app.db import User, engine, init_db
    from app.auth import hash_password
    init_db()
    with Session(engine) as session:
        user = User(
            name=uname,
            email=uname,
            role="recruiter",
            password_hash=hash_password("password"),
            email_verified=True,
        )
        session.add(user)
        session.add(RecruiterUser(username=uname, password_hash=user.password_hash))
        session.commit()
    
    login_res = client.post("/api/auth/login", data={
        "email": uname,
        "password": "password"
    })
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # 1. Create a post
    post_res = client.post("/api/recruiter/posts", json={
        "content": "We are hiring for a Senior Data Scientist."
    }, headers=headers)
    
    assert post_res.status_code == 200
    data = post_res.json()
    assert data["content"] == "We are hiring for a Senior Data Scientist."
    assert data["recruiter_username"] == uname
    
    # 2. Get posts
    get_res = client.get("/api/recruiter/posts", headers=headers)
    assert get_res.status_code == 200
    posts = get_res.json()
    assert len(posts) >= 1
    assert any(p["content"] == "We are hiring for a Senior Data Scientist." for p in posts)
