import re
from typing import List, Optional
from sqlmodel import Session, select
from ..db import engine, DiscoveredSkill
from .skills_vocab import KNOWN_SKILLS_LOWER

# Stopwords to ignore
COMMON_WORDS = {
    "The", "A", "An", "And", "Or", "But", "If", "For", "With", "By", "To", "From", "In", "On", "At", "Of",
    "I", "We", "You", "They", "He", "She", "It", "This", "That", "These", "Those", "My", "Our", "Your",
    "Their", "His", "Her", "Its", "Me", "Us", "Them", "Him", "Her", "Am", "Is", "Are", "Was", "Were",
    "Be", "Been", "Being", "Have", "Has", "Had", "Do", "Does", "Did", "Can", "Could", "Will", "Would",
    "Shall", "Should", "May", "Might", "Must", "About", "Against", "Between", "Into", "Through", "During",
    "Before", "After", "Above", "Below", "Up", "Down", "Out", "Off", "Over", "Under", "Again", "Further",
    "Then", "Once", "Here", "There", "When", "Where", "Why", "How", "All", "Any", "Both", "Each", "Few",
    "More", "Most", "Other", "Some", "Such", "No", "Nor", "Not", "Only", "Own", "Same", "So", "Than",
    "Too", "Very", "S", "T", "Can", "Will", "Just", "Don", "Should", "Now", "Project", "Projects", "Resume",
    "Experience", "Education", "Skills", "University", "College", "School", "Degree", "Engineering",
    "Science", "Technology", "Company", "Work", "Management", "Development", "Design", "Analysis",
    "System", "Systems", "Process", "Processes", "India", "Bangalore", "Mumbai", "Delhi", "Pune"
}


def extract_discovered_skills(text: str) -> List[str]:
    # Match technical candidates (Acronyms of length 2-5 or capitalized noun phrases)
    candidates = re.findall(r"\b[A-Z][a-zA-Z0-9+#]*(?:\s+[A-Z][a-zA-Z0-9+#]*){0,2}\b", text)
    unique_candidates = set()
    for cand in candidates:
        cand_clean = cand.strip()
        if not cand_clean or len(cand_clean) < 2:
            continue
        if cand_clean in COMMON_WORDS or cand_clean.lower() in COMMON_WORDS:
            continue
        if cand_clean.lower() in KNOWN_SKILLS_LOWER:
            continue
        if cand_clean.isdigit():
            continue
        unique_candidates.add(cand_clean)
    return list(unique_candidates)


def learn_skills_from_resume(resume_text: str, branch: Optional[str] = None):
    """Extract candidate technical terms and store or increment them in DiscoveredSkill."""
    terms = extract_discovered_skills(resume_text)
    if not terms:
        return

    with Session(engine) as session:
        for term in terms:
            existing = session.exec(select(DiscoveredSkill).where(DiscoveredSkill.term == term)).first()
            if existing:
                existing.occurrence_count += 1
                if branch and not existing.branch:
                    existing.branch = branch
                session.add(existing)
            else:
                new_skill = DiscoveredSkill(term=term, branch=branch, occurrence_count=1)
                session.add(new_skill)
        session.commit()
