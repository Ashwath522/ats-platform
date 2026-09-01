"""Resume/JD text extraction from PDF, DOCX, or plain text."""
import os
from typing import Optional

try:
    import pdfplumber
except Exception:
    pdfplumber = None

try:
    import docx
except Exception:
    docx = None


def extract_text_from_file(path: str) -> Optional[str]:
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        return _extract_pdf(path)
    if ext in (".docx", ".doc"):
        return _extract_docx(path)
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except Exception:
        return None


def _extract_pdf(path: str) -> Optional[str]:
    if pdfplumber is None:
        raise Exception("pdfplumber is not installed, cannot extract PDF")
    texts = []
    try:
        with pdfplumber.open(path) as pdf:
            for p in pdf.pages:
                texts.append(p.extract_text() or "")
        return "\n".join(texts)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise Exception(f"Failed to extract PDF: {str(e)}")


def _extract_docx(path: str) -> Optional[str]:
    if docx is None:
        raise Exception("python-docx is not installed, cannot extract DOCX")
    try:
        doc = docx.Document(path)
        return "\n".join([p.text for p in doc.paragraphs])
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise Exception(f"Failed to extract DOCX: {str(e)}")
