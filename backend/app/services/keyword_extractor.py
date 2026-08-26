"""
ai/keyword_extractor.py
───────────────────────
spaCy NER + noun-chunk extraction with a hand-curated synonym map for
engineering skills. Also provides keyword matching between a student's
keywords and a job's keywords.

The spaCy model is loaded once as a module-level singleton.
"""

SPACY_MODEL = "en_core_web_sm"

# ── spaCy singleton ───────────────────────────────────────────────
_nlp = None


def get_spacy_model():
    """Load en_core_web_sm once and reuse it for the app's lifetime."""
    global _nlp
    if _nlp is None:
        import spacy
        try:
            _nlp = spacy.load(SPACY_MODEL)
        except Exception:
            # Model not downloaded → use a blank English pipeline so the
            # app still runs (noun_chunks/ents will simply be empty).
            _nlp = spacy.blank("en")
    return _nlp


# ── Synonym map: canonical skill → surface variants ───────────────
SYNONYM_MAP = {
    "ml": ["machine learning", "ml", "machine-learning"],
    "ai": ["artificial intelligence", "ai"],
    "nlp": ["natural language processing", "nlp", "text processing"],
    "dl": ["deep learning", "dl", "neural network", "deep-learning"],
    "cv": ["computer vision", "cv", "image processing", "image recognition"],
    "sql": ["sql", "mysql", "postgresql", "sqlite", "database", "rdbms"],
    "js": ["javascript", "js", "node.js", "nodejs", "es6"],
    "py": ["python", "py", "python3"],
    "react": ["react", "reactjs", "react.js"],
    "cad": ["cad", "autocad", "solidworks", "catia", "fusion 360",
            "creo", "inventor", "drafting"],
    "fem": ["fem", "fea", "finite element", "ansys", "abaqus",
            "simulation", "structural analysis"],
    "plc": ["plc", "scada", "ladder logic", "automation"],
    "iot": ["iot", "internet of things", "esp32", "arduino",
            "raspberry pi", "embedded", "sensor"],
    "pcb": ["pcb", "circuit design", "kicad", "eagle", "altium",
            "schematic", "electronics design"],
    "embedded": ["embedded", "embedded systems", "firmware", "rtos",
                 "microcontroller", "mcu"],
    "docker": ["docker", "container", "kubernetes", "k8s", "devops"],
    "excel": ["excel", "spreadsheet", "ms excel", "google sheets"],
    "revit": ["revit", "bim", "building information modeling"],
    "matlab": ["matlab", "simulink", "numerical computing"],
    "aws": ["aws", "amazon web services", "cloud", "azure", "gcp"],
    "git": ["git", "github", "version control", "gitlab"],
    "api": ["api", "rest api", "restful", "web services", "http"],
    "agile": ["agile", "scrum", "kanban", "sprint", "jira"],
}

# Common stopwords to drop from extracted keywords.
_STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "have", "has", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "this", "that", "with", "from", "for",
    "and", "or", "but",
}


def extract_keywords(text: str) -> list:
    """Extract a de-duplicated list of keywords from free text."""
    if not text or not text.strip():
        return []

    text_lower = text.lower()
    nlp = get_spacy_model()

    keywords: set[str] = set()

    # Run spaCy (cap length to avoid huge docs blowing memory).
    try:
        doc = nlp(text_lower[:100000])
        # Named entities.
        for ent in doc.ents:
            if ent.text.strip():
                keywords.add(ent.text.strip())
        # Short noun chunks (<= 3 words).
        if doc.has_annotation("DEP"):  # noun_chunks need a parser
            for chunk in doc.noun_chunks:
                if len(chunk.text.split()) <= 3 and chunk.text.strip():
                    keywords.add(chunk.text.strip())
    except Exception:
        pass  # keep whatever we have; synonym pass below still runs

    # Synonym expansion → add the canonical token when any variant appears.
    for base, variants in SYNONYM_MAP.items():
        for variant in variants:
            if variant in text_lower:
                keywords.add(base)
                break

    # Clean: drop stopwords and very short tokens.
    keywords = {
        k for k in keywords
        if k not in _STOPWORDS and len(k) > 2
    }
    return list(keywords)


def match_keywords(student_keywords: list, jd_keywords: list) -> dict:
    """
    Compare student keywords against JD keywords (direct + synonym).
    Returns {matched, missing, score} where score is % of JD keywords hit.
    """
    student_lower = [str(k).lower() for k in (student_keywords or [])]
    jd_lower = [str(k).lower() for k in (jd_keywords or [])]

    matched: list[str] = []
    missing: list[str] = []

    for jd_kw in jd_lower:
        found = False

        # Direct match (substring either direction handles partials).
        if jd_kw in student_lower or any(jd_kw in s or s in jd_kw for s in student_lower):
            found = True
        else:
            # Synonym match: same canonical bucket on both sides.
            for base, variants in SYNONYM_MAP.items():
                if jd_kw in variants or jd_kw == base:
                    if any(v in student_lower or v in " ".join(student_lower)
                           for v in variants + [base]):
                        found = True
                        break

        (matched if found else missing).append(jd_kw)

    total = len(jd_lower) if jd_lower else 1
    score = round(len(matched) / total * 100, 1)
    return {"matched": matched, "missing": missing, "score": score}
