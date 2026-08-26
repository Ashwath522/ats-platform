import pytest
from app.services.role_templates import list_roles, BRANCHES
from app.services.scoring import score_resume_against_jd
from app.services.embeddings import EmbeddingModel

def test_all_core_branches_have_roles():
    expected_branches = ["software", "mechanical", "civil", "chemical", "ece", "eee", "aerospace"]
    for branch in expected_branches:
        assert any(b["id"] == branch for b in BRANCHES), f"Branch {branch} is missing from BRANCHES"
        roles = list_roles(branch)
        assert len(roles) > 0, f"Branch {branch} has no roles"
        for role in roles:
            assert role["description"].strip() != "", f"Role {role['id']} has empty description"

def test_chemical_keyword_extraction():
    resume_text = "I am a Chemical Engineer. I have worked on Heat Exchangers, P&ID, Aspen Plus, and Mass Transfer."
    jd_text = "We need someone with experience in Aspen Plus, HAZOP, Mass Transfer, and Reaction Engineering."
    
    # We can mock embeddings to zeros for testing pure keyword logic if needed, 
    # but actual embeddings might be loaded. Since it's a fast model, we can just use the real one or mock.
    # To keep it purely logical without hitting the model if not loaded, we can mock embed_text
    # But since other tests already load it, it's fine to run it.
    
    model = EmbeddingModel.get()
    res_emb = model.embed_text(resume_text)
    jd_emb = model.embed_text(jd_text)
    
    result = score_resume_against_jd(resume_text, jd_text, res_emb, jd_emb, branch="chemical")
    
    matched = result["matched_skills"]
    missing = result["missing_skills"]
    
    assert "Aspen Plus" in matched or "aspen plus" in [s.lower() for s in matched]
    assert "Mass Transfer" in matched or "mass transfer" in [s.lower() for s in matched]
    
    assert "HAZOP" in missing or "hazop" in [s.lower() for s in missing]
    assert "Reaction Engineering" in missing or "reaction engineering" in [s.lower() for s in missing]
