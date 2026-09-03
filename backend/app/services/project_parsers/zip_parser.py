"""
backend/app/services/project_parsers/zip_parser.py
─────────────────────────────────────────────────
Extracts code files and project documentation from ZIP archives.
Skips binaries, compiled files, virtualenvs, node_modules, and hidden directories.
"""
import os
import zipfile
import logging

logger = logging.getLogger("project_parsers.zip")

CODE_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".cpp", ".c", ".h", ".hpp",
    ".cs", ".go", ".rs", ".rb", ".php", ".sql", ".html", ".css", ".json",
    ".md", ".txt", ".sh", ".yml", ".yaml", ".toml", ".xml", ".env.example"
}

IGNORED_DIRS = {
    ".git", ".github", "node_modules", "__pycache__", "venv", ".venv",
    "dist", "build", ".next", ".idea", ".vscode", "target", "bin", "obj"
}

MAX_FILE_SIZE_BYTES = 100 * 1024  # 100 KB per individual file
MAX_TOTAL_CHARS = 80000  # Cap total extracted text across archive


def parse_zip(file_path: str) -> str:
    """Extract readable source code and documentation from a ZIP archive."""
    if not file_path or not os.path.exists(file_path):
        return ""

    collected_parts = []
    total_chars = 0

    try:
        with zipfile.ZipFile(file_path, "r") as z:
            for info in z.infolist():
                if info.is_dir():
                    continue

                filename = info.filename
                # Skip paths inside ignored directories
                parts = filename.replace("\\", "/").split("/")
                if any(p in IGNORED_DIRS for p in parts):
                    continue

                _, ext = os.path.splitext(filename.lower())
                if ext not in CODE_EXTENSIONS:
                    continue

                if info.file_size > MAX_FILE_SIZE_BYTES:
                    continue

                try:
                    with z.open(info) as f:
                        raw_bytes = f.read()
                        try:
                            content = raw_bytes.decode("utf-8")
                        except UnicodeDecodeError:
                            content = raw_bytes.decode("latin-1", errors="ignore")

                        content_clean = content.strip()
                        if content_clean:
                            file_block = f"--- File: {filename} ---\n{content_clean}"
                            collected_parts.append(file_block)
                            total_chars += len(file_block)

                            if total_chars >= MAX_TOTAL_CHARS:
                                collected_parts.append("\n[Archive content truncated for length]")
                                break
                except Exception as file_err:
                    logger.debug(f"[ZIP_PARSER] Failed reading {filename}: {file_err}")
                    continue

        return "\n\n".join(collected_parts).strip()
    except Exception as e:
        logger.warning(f"[ZIP_PARSER] Error reading zip archive {file_path}: {e}")
        return ""
