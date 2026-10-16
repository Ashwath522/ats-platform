"""Read LinkedIn's own "Save to PDF" profile export into profile fields.

Deterministic and local: no network, no AI service, the file is never stored.

LinkedIn's export has a fixed layout: a left sidebar (Contact, Top Skills,
Languages, Certifications, Honors-Awards, …) and a main column (name,
headline, location, Summary, Experience, Education). Plain text extraction
interleaves the two columns, so for PDFs we read words with their positions
and split the page at the main column's left edge (the name's x position).
`parse_linkedin_text` handles already-extracted text as a fallback.
"""
from __future__ import annotations

import re
from typing import Iterable, List, Optional, Tuple

MAX_ITEMS = 30
MAX_LEN = 300

SIDEBAR_SECTIONS = {
    "contact", "top skills", "skills", "languages", "certifications", "honors-awards", "honors & awards",
    "publications", "patents", "volunteer experience",
}
MAIN_SECTIONS = {"summary", "about", "experience", "education", "projects", "volunteer experience", "licenses & certifications"}
ALL_SECTIONS = SIDEBAR_SECTIONS | MAIN_SECTIONS

_MONTH = r"(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)"
_WHEN = rf"(?:{_MONTH}\s+)?\d{{4}}"
DATE_RANGE_RE = re.compile(rf"^(?P<start>{_WHEN})\s*[-–]\s*(?P<end>Present|{_WHEN})(?:\s*\((?P<dur>[^)]*)\))?$", re.I)
DURATION_RE = re.compile(r"^(?:less than a year|\d+\s+years?(?:\s+\d+\s+months?)?|\d+\s+months?)$", re.I)
EDU_YEARS_RE = re.compile(r"\(?\s*(?:" + _MONTH + r"\s+)?(\d{4})\s*[-–]\s*(?:" + _MONTH + r"\s+)?(\d{4}|Present)\s*\)?\s*$", re.I)
PAGE_RE = re.compile(r"^Page\s+\d+\s+of\s+\d+$", re.I)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
LINKEDIN_RE = re.compile(r"linkedin\.com/in/([A-Za-z0-9\-_%]+)", re.I)


def _clean(s: str, n: int = MAX_LEN) -> str:
    return re.sub(r"\s+", " ", s or "").strip()[:n]


def _is_header(line: str) -> bool:
    return line.strip().lower() in ALL_SECTIONS


def _sections(lines: List[str]) -> dict:
    """{section_name: [lines]} plus '_top' for lines before the first header."""
    out = {"_top": []}
    cur = "_top"
    for ln in lines:
        key = ln.strip().lower()
        if key in ALL_SECTIONS:
            cur = key
            out.setdefault(cur, [])
            continue
        out.setdefault(cur, []).append(ln)
    return out


def _looks_like_location(s: str) -> bool:
    s = s.strip()
    if not s or len(s) > 80 or s.endswith("."):
        return False
    return bool(re.search(r",|\bIndia\b|\bRemote\b|\bArea\b|\bRegion\b|\bUnited\b|\bKingdom\b|\bStates\b", s))


def _edu_level(text: str) -> str:
    t = text.lower()
    if re.search(r"\b(master|m\.?\s?tech|m\.?\s?e\b|m\.?sc|mba|ms\b|m\.?s\.?\b|post ?graduate|pg\b|ph\.?d|doctor)", t):
        return "pg"
    if re.search(r"\b(pu\b|puc|pre-university|pre university|12th|xii|higher secondary|intermediate|senior secondary)", t):
        return "pu"
    if re.search(r"\b(sslc|10th|\bx\b|secondary school|high school|cbse|icse|matriculation)", t):
        return "school"
    return "degree"


def _parse_experience(lines: List[str]) -> List[dict]:
    lines = [l for l in lines if l.strip()]
    dates = [i for i, l in enumerate(lines) if DATE_RANGE_RE.match(l.strip())]
    jobs: List[dict] = []
    company = ""
    for n, i in enumerate(dates):
        title = lines[i - 1] if i >= 1 else ""
        before = i - 2
        # Who is the company? Either right above the title, or above a "2 years 3 months" group total.
        if before >= 0 and DURATION_RE.match(lines[before].strip()):
            company = lines[before - 1] if before >= 1 else company
        elif before >= 0:
            prev_end = dates[n - 1] if n else -1
            cand = lines[before]
            if n == 0 or (before > prev_end and len(cand) <= 70 and not cand.rstrip().endswith((".", ":", ";"))
                          and not cand.lstrip().startswith(("•", "-", "*", "·"))
                          and not (prev_end >= 0 and before == prev_end + 1 and _looks_like_location(cand))):
                company = cand
        m = DATE_RANGE_RE.match(lines[i].strip())
        j = i + 1
        location = ""
        if j < len(lines) and _looks_like_location(lines[j]) and not DATE_RANGE_RE.match(lines[j]):
            location = lines[j]
            j += 1
        # description runs until the next role's company/title lines
        end = len(lines)
        if n + 1 < len(dates):
            nxt = dates[n + 1]
            end = nxt - 1  # title line
            if nxt - 2 >= j:
                cand = lines[nxt - 2]
                if DURATION_RE.match(cand.strip()):
                    end = nxt - 3
                elif len(cand) <= 70 and not cand.rstrip().endswith((".", ":", ";")) and not cand.lstrip().startswith(("•", "-", "*", "·")):
                    end = nxt - 2
        desc = " ".join(l.strip() for l in lines[j:max(j, end)])
        jobs.append({
            "title": _clean(title, 160), "company": _clean(company, 160),
            "start": _clean(m.group("start"), 40), "end": _clean(m.group("end"), 40),
            "location": _clean(location, 120), "description": _clean(desc, 1500),
        })
    return jobs[:MAX_ITEMS]


def _parse_education(lines: List[str]) -> List[dict]:
    lines = [l.strip() for l in lines if l.strip()]
    out: List[dict] = []
    i = 0
    while i < len(lines):
        school = lines[i]
        detail = ""
        if i + 1 < len(lines) and ("·" in lines[i + 1] or EDU_YEARS_RE.search(lines[i + 1]) or "," in lines[i + 1]):
            detail = lines[i + 1]
            # the degree line can wrap onto a second line ending with the years
            if not EDU_YEARS_RE.search(detail) and i + 2 < len(lines) and EDU_YEARS_RE.search(lines[i + 2]) and len(lines[i + 2]) < 40:
                detail = detail + " " + lines[i + 2]
                i += 1
            i += 2
        else:
            i += 1
        start = end = ""
        m = EDU_YEARS_RE.search(detail)
        if m:
            start, end = m.group(1), m.group(2)
            detail = detail[:m.start()]
        detail = detail.replace("·", " ").strip(" ,·")
        degree, _, field = detail.partition(",")
        out.append({
            "level": _edu_level(f"{degree} {school}"), "institution": _clean(school, 200),
            "degree": _clean(degree, 160), "field_of_study": _clean(field, 160),
            "start_year": start, "end_year": end, "grade": "",
        })
    return out[:MAX_ITEMS]


def _strip_paren(s: str) -> str:
    return _clean(re.sub(r"\s*\([^)]*\)\s*$", "", s), 120)


def parse_linkedin_lines(sidebar: List[str], main: List[str]) -> dict:
    out = {"full_name": "", "headline": "", "location_text": "", "bio": "", "email": "",
           "skills": [], "experience": [], "education": [], "certifications": [],
           "languages": [], "honors": [], "linkedin_url": "", "warnings": []}
    sidebar = [l for l in (x.strip() for x in sidebar) if l and not PAGE_RE.match(l)]
    main = [l for l in (x.strip() for x in main) if l and not PAGE_RE.match(l)]

    joined = "".join(sidebar + main).replace(" ", "")
    m = LINKEDIN_RE.search(joined)
    if m:
        out["linkedin_url"] = "https://www.linkedin.com/in/" + m.group(1).strip("-")
    e = EMAIL_RE.search(" ".join(sidebar) or " ".join(main))
    if e:
        out["email"] = e.group(0).lower()

    side = _sections(sidebar)
    body = _sections(main)
    # When columns couldn't be separated, sidebar sections may sit in the main list too.
    def pick(*names):
        for src in (side, body):
            for n in names:
                if src.get(n):
                    return src[n]
        return []

    out["skills"] = [_clean(x, 80) for x in pick("top skills", "skills")][:MAX_ITEMS]
    out["languages"] = [_strip_paren(x) for x in pick("languages")][:MAX_ITEMS]
    out["certifications"] = [{"name": _clean(x, 200), "issuing_organization": ""} for x in pick("certifications", "licenses & certifications")][:MAX_ITEMS]
    out["honors"] = [_clean(x, 200) for x in pick("honors-awards", "honors & awards")][:MAX_ITEMS]

    top = [l for l in body.get("_top", []) if not EMAIL_RE.search(l) and "linkedin.com" not in l.lower()]
    if top:
        out["full_name"] = _clean(top[0], 120)
        rest = top[1:]
        if rest and _looks_like_location(rest[-1]):
            out["location_text"] = _clean(rest[-1], 120)
            rest = rest[:-1]
        out["headline"] = _clean(" ".join(rest), 220)
    out["bio"] = _clean(" ".join(pick("summary", "about")), 2000)
    out["experience"] = _parse_experience(body.get("experience", []))
    out["education"] = _parse_education(body.get("education", []))

    found = sum(1 for k in ("experience", "education", "skills") if out[k]) + (1 if out["bio"] else 0)
    if not (out["linkedin_url"] or ("experience" in body or "education" in body)) or found == 0:
        out["warnings"].append("This doesn't look like a LinkedIn profile PDF. On LinkedIn open your profile → More → Save to PDF, then upload that file.")
    return out


def parse_linkedin_text(text: str) -> dict:
    """Fallback for plain text (columns may be mixed)."""
    lines = [l for l in (text or "").splitlines() if l.strip()]
    # Sidebar headers usually come first in mixed text; split at the first main-column marker we can find.
    return parse_linkedin_lines([], lines)


# ── PDF reading ─────────────────────────────────────────────────────────

def _lines_from_words(words: Iterable[dict], tol: float = 3.0) -> List[Tuple[float, str, float]]:
    rows: List[list] = []
    for w in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
        for r in rows:
            if abs(r[0] - w["top"]) <= tol:
                r[1].append(w)
                break
        else:
            rows.append([w["top"], [w]])
    out = []
    for top, ws in sorted(rows, key=lambda r: r[0]):
        ws.sort(key=lambda w: w["x0"])
        out.append((top, " ".join(w["text"] for w in ws), max(float(w.get("size") or 0) for w in ws)))
    return out


def read_linkedin_pdf(path: str) -> Tuple[List[str], List[str]]:
    """(sidebar_lines, main_lines) using word positions to separate the two columns."""
    import pdfplumber

    sidebar: List[str] = []
    main: List[str] = []
    with pdfplumber.open(path) as pdf:
        pages = pdf.pages[:12]
        split: Optional[float] = None
        if pages:
            first = pages[0].extract_words(extra_attrs=["size"], keep_blank_chars=False, use_text_flow=False)
            if first:
                biggest = max(first, key=lambda w: float(w.get("size") or 0))
                width = float(pages[0].width)
                # Name sits at the main column's left edge; LinkedIn's sidebar is ~1/3 of the page.
                if 0.2 * width < biggest["x0"] < 0.6 * width:
                    split = biggest["x0"] - 4
        for page in pages:
            words = page.extract_words(extra_attrs=["size"], keep_blank_chars=False, use_text_flow=False)
            if split is None:
                main += [t for _, t, _ in _lines_from_words(words)]
                continue
            left = [w for w in words if w["x1"] <= split + 2]
            right = [w for w in words if w["x0"] >= split - 2 and w["x1"] > split + 2]
            sidebar += [t for _, t, _ in _lines_from_words(left)]
            main += [t for _, t, _ in _lines_from_words(right)]
    return sidebar, main


def parse_linkedin_pdf(path: str) -> dict:
    sidebar, main = read_linkedin_pdf(path)
    return parse_linkedin_lines(sidebar, main)
