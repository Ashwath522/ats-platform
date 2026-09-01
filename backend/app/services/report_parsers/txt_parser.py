"""
parsers/txt_parser.py
─────────────────────
Plain-text and RTF files. Tries UTF-8 then latin-1; strips RTF markup
when the .rtf extension (or an {\\rtf header) is detected.
"""

import os


def parse_txt(file_path: str) -> tuple[str, str]:
    """Return (text, method) for a .txt / .rtf / generic text file."""
    raw = b""
    try:
        with open(file_path, "rb") as fh:
            raw = fh.read()
    except Exception as exc:
        return (f"Could not open text file: {exc}", "plain_text")

    # Decode with graceful fallback.
    text = None
    for enc in ("utf-8", "latin-1", "cp1252"):
        try:
            text = raw.decode(enc)
            break
        except (UnicodeDecodeError, Exception):
            continue
    if text is None:
        text = raw.decode("utf-8", errors="ignore")

    # If it looks like RTF, strip the control words.
    is_rtf = file_path.lower().endswith(".rtf") or text.lstrip().startswith("{\\rtf")
    if is_rtf:
        try:
            from striprtf.striprtf import rtf_to_text
            text = rtf_to_text(text)
            return (text.strip(), "rtf")
        except Exception:
            # Fall through and return the raw text we already have.
            pass

    return (text.strip(), "plain_text")
