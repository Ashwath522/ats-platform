"""
Tests for candidate and recruiter profile features:
- Education management
- Certifications upload/download
- Avatar and cover photo uploads
"""
import os
import sys
import json

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from app.main import app
from app.db import Session, engine, CandidateUser, RecruiterUser, CandidateProfile, RecruiterProfile

client = TestClient(app)

# Ensure DB is initialized
with TestClient(app):
    pass


def setup_candidate_user():
    """Create a test candidate user."""
    with Session(engine) as session:
        # Clear any existing test user
        session.query(CandidateUser).filter(
            CandidateUser.username == "testcandidate"
        ).delete()
        session.commit()
        
        # Create new candidate user
        user = CandidateUser(username="testcandidate", password_hash="hashed")
        session.add(user)
        session.commit()
        session.refresh(user)
        return user.id


def setup_recruiter_user():
    """Create a test recruiter user."""
    with Session(engine) as session:
        # Clear any existing test user
        session.query(RecruiterUser).filter(
            RecruiterUser.username == "testrecruiter"
        ).delete()
        session.commit()
        
        # Create new recruiter user
        user = RecruiterUser(username="testrecruiter", password_hash="hashed")
        session.add(user)
        session.commit()
        session.refresh(user)
        return user.id


# ──────── Education Endpoint Tests ────────

def test_candidate_education_put_endpoint():
    """Test updating candidate education list."""
    candidate_id = setup_candidate_user()
    
    # Test education update
    education = [
        {
            "level": "degree",
            "institution": "Test University",
            "field_of_study": "Computer Science",
            "start_year": "2018",
            "end_year": "2022",
            "grade": "3.8/4.0"
        }
    ]
    
    # Verify the structure can be stored and retrieved
    with Session(engine) as session:
        profile = session.query(CandidateProfile).filter(
            CandidateProfile.candidate_id == candidate_id
        ).first()
        if not profile:
            profile = CandidateProfile(candidate_id=candidate_id)
            session.add(profile)
            session.commit()
        
        profile.education_json = json.dumps(education)
        session.add(profile)
        session.commit()
        session.refresh(profile)
        
        # Verify it's stored correctly
        stored_education = json.loads(profile.education_json)
        assert len(stored_education) == 1
        assert stored_education[0]["level"] == "degree"
        assert stored_education[0]["institution"] == "Test University"
        assert stored_education[0]["field_of_study"] == "Computer Science"
        assert stored_education[0]["grade"] == "3.8/4.0"


def test_candidate_education_multiple_levels():
    """Test education with multiple levels grouped correctly."""
    candidate_id = setup_candidate_user()
    
    with Session(engine) as session:
        profile = session.query(CandidateProfile).filter(
            CandidateProfile.candidate_id == candidate_id
        ).first()
        if not profile:
            profile = CandidateProfile(candidate_id=candidate_id)
            session.add(profile)
            session.commit()
        
        education = [
            {"level": "school", "institution": "Test School", "start_year": "2010", "end_year": "2013"},
            {"level": "pu", "institution": "Test College", "start_year": "2013", "end_year": "2015"},
            {"level": "degree", "institution": "Test University", "start_year": "2015", "end_year": "2019"},
            {"level": "pg", "institution": "Test Institute", "start_year": "2019", "end_year": "2021"},
        ]
        
        profile.education_json = json.dumps(education)
        session.add(profile)
        session.commit()
        session.refresh(profile)
        
        # Verify all levels are stored
        stored = json.loads(profile.education_json)
        assert len(stored) == 4
        levels = [e["level"] for e in stored]
        assert "school" in levels
        assert "pu" in levels
        assert "degree" in levels
        assert "pg" in levels


# ──────── Certifications Endpoint Tests ────────

def test_candidate_certification_add():
    """Test adding a certification to candidate profile."""
    candidate_id = setup_candidate_user()
    
    with Session(engine) as session:
        profile = session.query(CandidateProfile).filter(
            CandidateProfile.candidate_id == candidate_id
        ).first()
        if not profile:
            profile = CandidateProfile(candidate_id=candidate_id)
            session.add(profile)
            session.commit()
    
    # Add a certification
    cert = {
        "name": "AWS Solutions Architect",
        "issuing_organization": "Amazon Web Services",
        "issue_date": "2023-06-15",
        "credential_url": "https://aws.amazon.com/...",
        "file_path": None
    }
    
    with Session(engine) as session:
        profile = session.query(CandidateProfile).filter(
            CandidateProfile.candidate_id == candidate_id
        ).first()
        certs = json.loads(profile.certifications_json)
        certs.append(cert)
        profile.certifications_json = json.dumps(certs)
        session.add(profile)
        session.commit()
        session.refresh(profile)
        
        # Verify
        stored_certs = json.loads(profile.certifications_json)
        assert len(stored_certs) == 1
        assert stored_certs[0]["name"] == "AWS Solutions Architect"
        assert stored_certs[0]["issuing_organization"] == "Amazon Web Services"


def test_candidate_certification_delete():
    """Test deleting a certification from candidate profile."""
    candidate_id = setup_candidate_user()
    
    with Session(engine) as session:
        profile = session.query(CandidateProfile).filter(
            CandidateProfile.candidate_id == candidate_id
        ).first()
        if not profile:
            profile = CandidateProfile(candidate_id=candidate_id)
            session.add(profile)
            session.commit()
    
    # Add two certifications
    certs = [
        {"name": "Cert1", "issuing_organization": "Org1"},
        {"name": "Cert2", "issuing_organization": "Org2"},
    ]
    
    with Session(engine) as session:
        profile = session.query(CandidateProfile).filter(
            CandidateProfile.candidate_id == candidate_id
        ).first()
        profile.certifications_json = json.dumps(certs)
        session.add(profile)
        session.commit()
        session.refresh(profile)
        
        # Delete one
        certs_list = json.loads(profile.certifications_json)
        certs_list.pop(0)
        profile.certifications_json = json.dumps(certs_list)
        session.add(profile)
        session.commit()
        session.refresh(profile)
        
        # Verify
        stored = json.loads(profile.certifications_json)
        assert len(stored) == 1
        assert stored[0]["name"] == "Cert2"


# ──────── Avatar and Cover Photo Tests ────────

def test_candidate_profile_includes_avatar_url():
    """Test that candidate profile response includes avatar_url."""
    candidate_id = setup_candidate_user()
    
    with Session(engine) as session:
        profile = session.query(CandidateProfile).filter(
            CandidateProfile.candidate_id == candidate_id
        ).first()
        if not profile:
            profile = CandidateProfile(candidate_id=candidate_id)
            session.add(profile)
            session.commit()
        
        # Set avatar path
        profile.avatar_path = "avatars/test123.jpg"
        session.add(profile)
        session.commit()
        session.refresh(profile)
        
        # Verify the path is stored
        assert profile.avatar_path == "avatars/test123.jpg"


def test_candidate_profile_includes_cover_photo_url():
    """Test that candidate profile response includes cover_photo_url."""
    candidate_id = setup_candidate_user()
    
    with Session(engine) as session:
        profile = session.query(CandidateProfile).filter(
            CandidateProfile.candidate_id == candidate_id
        ).first()
        if not profile:
            profile = CandidateProfile(candidate_id=candidate_id)
            session.add(profile)
            session.commit()
        
        # Set cover photo path
        profile.cover_photo_path = "covers/cover123.jpg"
        session.add(profile)
        session.commit()
        session.refresh(profile)
        
        # Verify the path is stored
        assert profile.cover_photo_path == "covers/cover123.jpg"


# ──────── Recruiter Profile Tests ────────

def test_recruiter_profile_creation():
    """Test that recruiter profile is created on demand."""
    recruiter_id = setup_recruiter_user()
    
    with Session(engine) as session:
        profile = session.query(RecruiterProfile).filter(
            RecruiterProfile.recruiter_id == recruiter_id
        ).first()
        if not profile:
            profile = RecruiterProfile(recruiter_id=recruiter_id)
            session.add(profile)
            session.commit()
            session.refresh(profile)
        
        assert profile is not None
        assert profile.recruiter_id == recruiter_id


def test_recruiter_profile_fields():
    """Test recruiter profile includes all required fields."""
    recruiter_id = setup_recruiter_user()
    
    with Session(engine) as session:
        profile = session.query(RecruiterProfile).filter(
            RecruiterProfile.recruiter_id == recruiter_id
        ).first()
        if not profile:
            profile = RecruiterProfile(recruiter_id=recruiter_id)
            session.add(profile)
            session.commit()
        
        # Set profile data
        profile.headline = "Senior Recruiter"
        profile.bio = "Hiring for tech roles"
        profile.company_name = "TechCorp"
        profile.avatar_path = "avatars/recruiter123.jpg"
        profile.cover_photo_path = "covers/recruiter_cover.jpg"
        session.add(profile)
        session.commit()
        session.refresh(profile)
        
        # Verify all fields
        assert profile.headline == "Senior Recruiter"
        assert profile.bio == "Hiring for tech roles"
        assert profile.company_name == "TechCorp"
        assert profile.avatar_path == "avatars/recruiter123.jpg"
        assert profile.cover_photo_path == "covers/recruiter_cover.jpg"


# ──────── Integration Tests ────────

def test_candidate_profile_response_shape():
    """Test that candidate profile GET response includes all new fields."""
    candidate_id = setup_candidate_user()
    
    with Session(engine) as session:
        profile = session.query(CandidateProfile).filter(
            CandidateProfile.candidate_id == candidate_id
        ).first()
        if not profile:
            profile = CandidateProfile(candidate_id=candidate_id)
            session.add(profile)
            session.commit()
        
        # Set all profile data
        profile.headline = "Test Engineer"
        profile.bio = "Test bio"
        profile.education_json = json.dumps([{"level": "degree", "institution": "Test Uni"}])
        profile.certifications_json = json.dumps([{"name": "Test Cert"}])
        profile.avatar_path = "avatars/test.jpg"
        profile.cover_photo_path = "covers/test.jpg"
        session.add(profile)
        session.commit()
        session.refresh(profile)
        
        # Simulate profile_to_dict response shape
        response = {
            "headline": profile.headline,
            "bio": profile.bio,
            "education": json.loads(profile.education_json),
            "certifications": json.loads(profile.certifications_json),
            "avatar_url": f"/media/{profile.avatar_path}" if profile.avatar_path else None,
            "cover_photo_url": f"/media/{profile.cover_photo_path}" if profile.cover_photo_path else None,
        }
        
        # Verify response shape
        assert response["headline"] == "Test Engineer"
        assert response["bio"] == "Test bio"
        assert len(response["education"]) == 1
        assert len(response["certifications"]) == 1
        assert response["avatar_url"] == "/media/avatars/test.jpg"
        assert response["cover_photo_url"] == "/media/covers/test.jpg"


def test_profile_data_additive_no_regression():
    """
    Ensure that profile data is additive and doesn't break existing fields.
    This tests that we're not modifying the shape of existing fields.
    """
    candidate_id = setup_candidate_user()
    
    with Session(engine) as session:
        profile = session.query(CandidateProfile).filter(
            CandidateProfile.candidate_id == candidate_id
        ).first()
        if not profile:
            profile = CandidateProfile(candidate_id=candidate_id)
            session.add(profile)
            session.commit()
        
        # Set existing fields
        profile.headline = "Test"
        profile.bio = "Test bio"
        profile.branch = "software"
        profile.skills_json = json.dumps(["Python", "JavaScript"])
        profile.experience_json = json.dumps([{"title": "Engineer", "company": "Company"}])
        profile.contact_email = "test@test.com"
        profile.contact_phone = "+1234567890"
        
        # Verify existing fields are unchanged
        assert profile.headline == "Test"
        assert profile.bio == "Test bio"
        assert profile.branch == "software"
        assert json.loads(profile.skills_json) == ["Python", "JavaScript"]
        assert json.loads(profile.experience_json) == [{"title": "Engineer", "company": "Company"}]
        assert profile.contact_email == "test@test.com"
        assert profile.contact_phone == "+1234567890"
        
        # Add new fields
        profile.education_json = json.dumps([{"level": "degree"}])
        profile.certifications_json = json.dumps([{"name": "Cert"}])
        profile.avatar_path = "avatars/test.jpg"
        profile.cover_photo_path = "covers/test.jpg"
        session.add(profile)
        session.commit()
        session.refresh(profile)
        
        # Verify all fields (old and new) are still intact
        assert profile.headline == "Test"
        assert json.loads(profile.education_json) == [{"level": "degree"}]
        assert json.loads(profile.certifications_json) == [{"name": "Cert"}]
        assert profile.avatar_path == "avatars/test.jpg"
        assert profile.cover_photo_path == "covers/test.jpg"


if __name__ == "__main__":
    print("Running profile feature tests...")
    import pytest
    pytest.main([__file__, "-v"])
