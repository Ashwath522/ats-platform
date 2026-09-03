"""
backend/app/services/project_parsers/pdf_parser.py
─────────────────────────────────────────────────
Extracts text content from PDF project documentation files.
Guarantees safe extraction without raising exceptions.
"""
import os
import logging

logger = logging.getLogger("project_parsers.pdf")


def parse_pdf(file_path: str) -> str:
    """Extract all text pages from a PDF file."""
    if not file_path or not os.path.exists(file_path):
        return ""

    try:
        import fitz  # PyMuPDF
        doc = fitz.open(file_path)
        pages_text = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text() or ""
            if text.strip():
                pages_text.append(text.strip())
        doc.close()
        return "\n\n".join(pages_text).strip()
    except Exception as e:
        logger.warning(f"[PDF_PARSER] fitz extraction error on {file_path}: {e}")
        # Fallback to basic binary ASCII extraction if fitz fails
        try:
            with open(file_path, "rb") as f:
                raw = f.read().decode("latin-1", errors="ignore")
            # Pull readable ASCII words
            import re
            words = re.findall(r"[A-Za-z0-9_. -]{4,}", raw)
            return " ".join(words[:2000]).strip()
        except Exception as fallback_err:
            logger.error(f"[PDF_PARSER] Complete fallback failure: {fallback_err}")
            return ""
