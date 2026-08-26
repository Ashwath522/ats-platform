"""
parsers/zip_parser.py
─────────────────────
ZIP archives. Extracts to a temp directory, runs the router on every
file inside, concatenates the results, then cleans up the temp dir.
"""

import os
import shutil
import zipfile
import tempfile


def parse_zip(file_path: str) -> tuple[str, str]:
    """Return (combined_text, method) for a .zip archive."""
    if not zipfile.is_zipfile(file_path):
        return (
            f"Not a valid ZIP archive: {os.path.basename(file_path)}",
            "zip_error",
        )

    temp_dir = tempfile.mkdtemp(prefix="corelink_zip_")
    chunks: list[str] = []

    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            # Extract only regular files, guarding against zip-slip.
            for member in zf.namelist():
                # Skip directories and anything trying to escape temp_dir.
                if member.endswith("/"):
                    continue
                dest = os.path.realpath(os.path.join(temp_dir, member))
                if not dest.startswith(os.path.realpath(temp_dir)):
                    continue  # path traversal attempt — skip silently
                try:
                    zf.extract(member, temp_dir)
                except Exception:
                    continue

        # Lazy import to avoid a circular import at module load time.
        from app.services.report_parsers.router import route_file

        for root, _dirs, files in os.walk(temp_dir):
            for fname in files:
                fpath = os.path.join(root, fname)
                try:
                    text, method = route_file(fpath)
                    chunks.append(f"[{fname}] ({method})\n{text}")
                except Exception as exc:
                    chunks.append(f"[{fname}] failed: {exc}")

    except Exception as exc:
        return (f"ZIP extraction failed: {exc}", "zip_error")
    finally:
        # Always clean up the temp directory.
        shutil.rmtree(temp_dir, ignore_errors=True)

    if not chunks:
        return (
            f"Empty archive: {os.path.basename(file_path)}",
            "zip_empty",
        )

    combined = "\n\n".join(chunks)
    return (combined, "zip_archive")
