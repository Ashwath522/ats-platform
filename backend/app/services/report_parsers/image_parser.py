"""
parsers/image_parser.py
───────────────────────
Image understanding via Gemini Vision. The Gemini API key is read from
the database at call time, so this works only after the admin has saved
a working key.

Exposes two entry points:
  - parse_image(file_path)         → used by the router
  - parse_image_bytes(bytes, name) → used by pdf_parser for scanned pages
"""

import os


# Prompt shared by both entry points (kept identical to the spec).
_VISION_PROMPT = (
    "You are an engineering project analyzer. Analyze this image:\n"
    "1. What type of engineering project is this?\n"
    "2. What components, tools, or technologies are visible?\n"
    "3. What does this project do?\n"
    "4. List all technical keywords and skills demonstrated.\n"
    "5. Complexity: Basic / Intermediate / Advanced\n"
    "Respond in plain text. Be specific and technical."
)


def _get_gemini_client():
    """
    Build a GeminiClient from the active key in the DB.
    Returns None if no active Gemini key is configured.
    """
    try:
        from database.connection import SessionLocal
        from models.api_key import ApiKey
        from ai.gemini_client import GeminiClient

        db = SessionLocal()
        try:
            row = db.query(ApiKey).filter(ApiKey.key_name == "gemini").first()
            if not row or not row.key_value or not row.is_active:
                return None
            return GeminiClient(row.key_value)
        finally:
            db.close()
    except Exception:
        return None


def _filename_fallback(filename: str) -> tuple[str, str]:
    """Vision unavailable: report only that an image exists — never keywords
    guessed from the file name (they inflated scores without evidence)."""
    return (f"Image file '{os.path.basename(filename or 'image')}'. Contents not analysed.", "image_unanalysed")


def parse_image_bytes(image_bytes: bytes, filename: str = "image.png") -> tuple[str, str]:
    """Analyse raw image bytes with Gemini Vision.

    Falls back to filename-based keyword extraction whenever Gemini Vision
    is unavailable, errors, or returns an unusably short description — so a
    project always contributes some signal instead of a score-killing blank.
    """
    client = _get_gemini_client()
    if client is None:
        return _filename_fallback(filename)
    try:
        description = client.analyze_image(image_bytes)
        if description and len(description.strip()) > 20:
            return (description.strip(), "gemini_vision")
        # Empty / too-short description → fall back to filename keywords.
        return _filename_fallback(filename)
    except Exception as exc:
        print(f"[IMAGE PARSER] Gemini Vision failed for '{filename}': {exc}")
        return _filename_fallback(filename)


def parse_image(file_path: str) -> tuple[str, str]:
    """Analyse an image file on disk with Gemini Vision."""
    try:
        # Normalise to PNG bytes for consistency using Pillow.
        from PIL import Image
        import io

        with Image.open(file_path) as img:
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            image_bytes = buf.getvalue()
    except Exception as exc:
        # Pillow failed — fall back to raw bytes.
        try:
            with open(file_path, "rb") as fh:
                image_bytes = fh.read()
        except Exception as exc2:
            return (f"Could not read image: {exc2}", "image_error")

    return parse_image_bytes(image_bytes, os.path.basename(file_path))
