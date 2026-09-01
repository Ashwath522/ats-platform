"""
parsers/router.py
─────────────────
Maps a file's extension to the correct parser and returns
(extracted_text, extraction_method). This is the single entry point
used by the pipeline and the ZIP parser.

Guarantees:
  - Never raises. Any unexpected error is caught and returned as text.
  - Always returns a 2-tuple of strings.
"""

import os


# Extension → parser function name (resolved lazily inside route_file so
# heavy libraries are only imported when actually needed).
def route_file(file_path: str) -> tuple[str, str]:
    """Route a single file to its parser. Always returns (text, method)."""
    if not file_path or not os.path.exists(file_path):
        return (f"File not found: {file_path}", "missing")

    ext = os.path.splitext(file_path)[1].lower().lstrip(".")
    filename = os.path.basename(file_path)

    try:
        # ── PDF ───────────────────────────────────────────────────
        if ext == "pdf":
            from app.services.report_parsers.pdf_parser import parse_pdf
            return parse_pdf(file_path)

        # ── Word ──────────────────────────────────────────────────
        if ext in ("docx", "doc"):
            from app.services.report_parsers.docx_parser import parse_docx
            return parse_docx(file_path)

        # ── Plain text / RTF ─────────────────────────────────────
        if ext in ("txt", "rtf", "md", "log"):
            from app.services.report_parsers.txt_parser import parse_txt
            return parse_txt(file_path)

        # ── Images (Gemini Vision) ───────────────────────────────
        if ext in ("jpg", "jpeg", "png", "bmp", "gif", "webp"):
            from app.services.report_parsers.image_parser import parse_image
            return parse_image(file_path)

        # ── CAD ───────────────────────────────────────────────────
        if ext in ("dxf", "dwg"):
            from app.services.report_parsers.cad_parser import parse_cad
            return parse_cad(file_path)

        # ── TinkerCAD / circuit JSON ─────────────────────────────
        if ext == "json":
            from app.services.report_parsers.tinkercad_parser import parse_tinkercad
            return parse_tinkercad(file_path)

        # ── Source code ──────────────────────────────────────────
        if ext in ("ino", "py", "cpp", "c", "h", "hpp", "java", "js", "ts"):
            from app.services.report_parsers.code_parser import parse_code
            return parse_code(file_path)

        # ── ZIP archive ──────────────────────────────────────────
        if ext == "zip":
            from app.services.report_parsers.zip_parser import parse_zip
            return parse_zip(file_path)

        # ── 3D model (no text to extract) ────────────────────────
        if ext in ("stl", "obj", "step", "stp", "iges", "igs"):
            return (
                f"3D model file: {filename}. "
                f"Keywords: 3D modelling, CAD, design, mechanical engineering.",
                "3d_model_filename",
            )

        # ── Unknown → best-effort text read ──────────────────────
        from app.services.report_parsers.txt_parser import parse_txt
        text, _ = parse_txt(file_path)
        if text and len(text) > 10:
            printable_chars = sum(1 for c in text if c.isprintable() or c in '\n\r\t')
            if printable_chars / len(text) > 0.8:
                return (text, "unknown_text")
        return (
            f"Unsupported file type '.{ext}': {filename}",
            "unsupported",
        )

    except Exception as exc:
        # Absolute safety net — the pipeline must never crash here.
        return (f"Parser error for {filename}: {exc}", "router_error")
