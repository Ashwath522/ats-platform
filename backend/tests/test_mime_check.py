"""
Tests for mime_check.py - real content-based file validation. Proves a file
whose real content doesn't match its claimed extension (e.g. a .txt file
renamed to .pdf) is caught, not silently trusted.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from app.services.mime_check import validate_file_content_matches_extension


def test_real_pdf_passes_pdf_validation():
    pdf_bytes = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF"
    )
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes)
        path = f.name
    try:
        validate_file_content_matches_extension(path, ".pdf")  # should not raise
    finally:
        os.remove(path)


def test_text_file_renamed_to_pdf_is_rejected():
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(b"This is plain text content, not a real PDF.")
        path = f.name
    try:
        with pytest.raises(ValueError, match="doesn't match"):
            validate_file_content_matches_extension(path, ".pdf")
    finally:
        os.remove(path)


def test_real_txt_passes_txt_validation():
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
        f.write(b"Just a plain resume in text form.")
        path = f.name
    try:
        validate_file_content_matches_extension(path, ".txt")  # should not raise
    finally:
        os.remove(path)


def test_pdf_renamed_to_txt_is_rejected():
    pdf_bytes = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
        f.write(pdf_bytes)
        path = f.name
    try:
        with pytest.raises(ValueError, match="doesn't match"):
            validate_file_content_matches_extension(path, ".txt")
    finally:
        os.remove(path)
