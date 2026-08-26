"""
PDF Parser for CoreLink.
Reads ALL pages of a PDF document.
Extracts text from every page.
Sends embedded images to Gemini Vision for description.
Returns full content — no truncation at extraction stage.
"""

import fitz  # PyMuPDF
import io
import os


def get_gemini_key_from_db() -> str:
    """Get first available Gemini key from database."""
    try:
        from database.connection import SessionLocal
        from models.api_key import ApiKey
        db = SessionLocal()
        key_row = db.query(ApiKey).filter(
            ApiKey.provider == 'gemini',
            ApiKey.key_value != '',
            ApiKey.key_value != None
        ).order_by(ApiKey.slot_number).first()
        db.close()
        return key_row.key_value if key_row else ''
    except Exception as e:
        print(f"[PDF PARSER] DB key lookup error: {e}")
        return ''


def describe_image_with_gemini(image_bytes: bytes, context: str = '') -> str:
    """
    Send image bytes to Gemini Vision and get detailed description.
    Returns empty string if Gemini is unavailable.
    """
    try:
        import google.generativeai as genai
        import PIL.Image

        api_key = get_gemini_key_from_db()
        if not api_key:
            return ''

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-1.5-flash')
        img = PIL.Image.open(io.BytesIO(image_bytes))

        prompt = f"""You are an expert engineering project analyzer.
{context}

Analyze this image in COMPLETE detail. Write minimum 150 words.

Cover all of:
1. Everything visible — components, labels, text, diagrams, measurements
2. Engineering domain (Mechanical/Civil/Electronics/CS)
3. All component names, tools, technologies, software shown
4. What the project does and how it works
5. Any specifications, dimensions, values, or parameters shown
6. Complexity level (Basic/Intermediate/Advanced)

Be thorough. Do not skip any visible detail.
Write in plain text only."""

        response = model.generate_content([prompt, img])
        description = response.text.strip()
        print(f"[PDF PARSER] Image described: {len(description)} chars")
        return description

    except Exception as e:
        print(f"[PDF PARSER] Gemini Vision error: {e}")
        return ''


def parse_scanned_pdf(file_path: str) -> tuple:
    """
    Handle scanned PDFs (no extractable text).
    Renders each page as image and sends to Gemini Vision.
    """
    doc = fitz.open(file_path)
    all_descriptions = []

    for page_num in range(len(doc)):
        try:
            page = doc[page_num]
            # Render page at 150 DPI for good quality
            mat = fitz.Matrix(150/72, 150/72)
            pix = page.get_pixmap(matrix=mat)
            img_bytes = pix.tobytes('png')

            desc = describe_image_with_gemini(
                img_bytes,
                context=f"This is page {page_num+1} of {len(doc)} "
                        f"from a scanned engineering project PDF."
            )
            if desc:
                all_descriptions.append(
                    f"--- SCANNED PAGE {page_num + 1} ---\n{desc}")
            else:
                all_descriptions.append(
                    f"--- SCANNED PAGE {page_num + 1} ---\n"
                    f"[Image could not be analyzed]")
        except Exception as e:
            print(f"[PDF PARSER] Scanned page {page_num+1} error: {e}")

    doc.close()
    result = "\n\n".join(all_descriptions)
    return result or "Scanned PDF — no text could be extracted.", 'scanned_pdf_vision'


def parse_pdf(file_path: str) -> tuple:
    """
    Main PDF parser. Reads ALL pages.
    Extracts text + describes embedded images via Gemini Vision.
    Returns (full_text, extraction_method).
    """
    if not os.path.exists(file_path):
        return f"File not found: {file_path}", 'error'

    try:
        doc = fitz.open(file_path)
        all_content = []
        total_pages = len(doc)
        print(f"[PDF PARSER] Reading {total_pages} pages from "
              f"{os.path.basename(file_path)}")

        for page_num in range(total_pages):
            page = doc[page_num]
            page_parts = []

            # Extract text from this page
            text = page.get_text("text")
            if text.strip():
                page_parts.append(text.strip())

            # Extract and describe embedded images on this page
            image_list = page.get_images(full=True)
            for img_idx, img_info in enumerate(image_list):
                try:
                    xref = img_info[0]
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image["image"]

                    # Only process images larger than 5KB (skip tiny icons)
                    if len(image_bytes) < 5000:
                        continue

                    desc = describe_image_with_gemini(
                        image_bytes,
                        context=f"Engineering project image from "
                                f"page {page_num+1} of {total_pages}."
                    )
                    if desc:
                        page_parts.append(
                            f"[Image {img_idx+1} on page {page_num+1}]: "
                            f"{desc}"
                        )
                except Exception as e:
                    print(f"[PDF PARSER] Image {img_idx+1} "
                          f"page {page_num+1} error: {e}")

            if page_parts:
                all_content.append(
                    f"--- PAGE {page_num + 1} of {total_pages} ---\n"
                    + "\n\n".join(page_parts)
                )

        doc.close()
        full_text = "\n\n".join(all_content)

        if not full_text.strip():
            # No text found — try as scanned PDF
            print(f"[PDF PARSER] No text found — trying scanned mode")
            return parse_scanned_pdf(file_path)

        print(f"[PDF PARSER] Extracted {len(full_text)} total chars "
              f"from {total_pages} pages")
        return full_text, 'pymupdf_full'

    except Exception as e:
        print(f"[PDF PARSER] Fatal error: {e}")
        return f"PDF parse error: {str(e)}", 'error'
