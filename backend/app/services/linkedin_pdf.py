"""Deterministic, local-only parser for LinkedIn profile PDF text."""
import re

SECTIONS = {"contact", "top skills", "languages", "certifications", "honors-awards", "summary", "experience", "education"}
def parse_linkedin_text(text: str) -> dict:
    out = {"full_name":"", "headline":"", "location_text":"", "bio":"", "skills":[], "experience":[], "education":[], "certifications":[], "languages":[], "honors":[], "linkedin_url":"", "warnings":[]}
    lines = [re.sub(r"\s+", " ", x).strip() for x in text.splitlines() if x.strip() and not re.match(r"Page \d+ of \d+", x.strip(), re.I)]
    low = [x.lower() for x in lines]
    if not any("linkedin" in x for x in low): out["warnings"].append("This doesn't look like a LinkedIn profile PDF")
    m = next((re.search(r"linkedin\.com/in/([A-Za-z0-9-]+)", x, re.I) for x in lines), None)
    if m: out["linkedin_url"] = "https://www.linkedin.com/in/" + m.group(1)
    if lines: out["full_name"] = lines[0][:200]
    for i, h in enumerate(low):
        if h == "contact" and i + 1 < len(lines):
            parts = lines[i+1].split("|"); out["location_text"] = parts[-1][:160] if parts else ""
        if h == "summary": out["bio"] = " ".join(lines[i+1:i+4])[:2000]
        if h == "top skills": out["skills"] = lines[i+1:i+31]
        if h == "languages": out["languages"] = lines[i+1:i+21]
        if h == "certifications": out["certifications"] = [{"name": x[:200], "issuing_organization":""} for x in lines[i+1:i+21]]
        if h == "honors-awards": out["honors"] = lines[i+1:i+21]
    return out
