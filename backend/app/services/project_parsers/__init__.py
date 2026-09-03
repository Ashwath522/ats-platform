"""
backend/app/services/project_parsers/__init__.py
────────────────────────────────────────────────
Project file parsing pipeline.
Supports PDF, DOCX, ZIP (code files), and plain text.
Image and CAD parsing are deferred follow-ups.
Guarantees: Never raises, always returns a clean string.
"""
import os
import logging
from .pdf_parser import parse_pdf
from .docx_parser import parse_docx
from .zip_parser import parse_zip

logger = logging.getLogger("project_parsers")

__all__ = ["parse_project_file", "parse_pdf", "parse_docx", "parse_zip"]


def parse_project_file(file_path: str) -> str:
    """
    Parse an uploaded project file and return its textual content.
    Supported extensions: .pdf, .docx, .doc, .zip, .txt, .md, .py, etc.
    """
    if not file_path or not os.path.exists(file_path):
        logger.warning(f"[PROJECT_PARSER] File not found: {file_path}")
        return ""

    _, ext = os.path.splitext(file_path.lower())

    if ext == ".pdf":
        return parse_pdf(file_path)
    elif ext in (".docx", ".doc"):
        return parse_docx(file_path)
    elif ext == ".zip":
        return parse_zip(file_path)
    elif ext in (".jpg", ".jpeg", ".png", ".webp", ".dxf", ".dwg"):
        # Note: Image and CAD parsing deferred to follow-up release per specification
        logger.info(f"[PROJECT_PARSER] Image/CAD parsing ({ext}) is deferred; attempting raw text extract.")
        try:
            with open(file_path, "rb") as f:
                return f.read().decode("latin-1", errors="ignore")[:2000].strip()
        except Exception:
            return ""
    else:
        # Plain text, markdown, source code fallback
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                return f.read().strip()
        except Exception as e:
            logger.warning(f"[PROJECT_PARSER] Text read error on {file_path}: {e}")
            try:
                with open(file_path, "rb") as f:
                    return f.read().decode("latin-1", errors="ignore").strip()
            except Exception:
                return ""
