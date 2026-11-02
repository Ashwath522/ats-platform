"""Project file storage, validation and loading (disk or DB-backed media)."""
from __future__ import annotations

import hashlib
import os
import re
import uuid
import zipfile
import io
from typing import Optional, Tuple

from fastapi import HTTPException

from ..media_utils import MEDIA_DIR, load_media, mirror_to_db
from .domains import ALL_EXTENSIONS

MAX_FILES = 10
MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_TOTAL_BYTES = 60 * 1024 * 1024

TEXT_EXTS = {".kicad_sch", ".kicad_pcb", ".net", ".json", ".ino", ".c", ".cpp", ".h", ".hpp", ".ini", ".py", ".js", ".ts",
             ".java", ".ipynb", ".csv", ".md", ".txt", ".dxf", ".step", ".stp", ".iges", ".igs", ".ifc", ".obj"}
IMAGE_MAGIC = {".png": (b"\x89PNG",), ".jpg": (b"\xff\xd8\xff",), ".jpeg": (b"\xff\xd8\xff",), ".webp": (b"RIFF",)}

KIND = {
    "circuit": {".kicad_sch", ".kicad_pcb", ".net"},
    "code": {".ino", ".c", ".cpp", ".h", ".hpp", ".py", ".js", ".ts", ".java", ".ini"},
    "cad": {".step", ".stp", ".iges", ".igs", ".stl", ".obj", ".ifc"},
    "drawing": {".dxf", ".dwg"},
    "data": {".csv", ".ipynb", ".json"},
    "document": {".pdf", ".docx", ".md", ".txt"},
    "image": {".png", ".jpg", ".jpeg", ".webp"},
    "archive": {".zip"},
}


def file_ext(name: str) -> str:
    n = (name or "").lower()
    for multi in (".kicad_sch", ".kicad_pcb"):
        if n.endswith(multi):
            return multi
    return os.path.splitext(n)[1]


def kind_of(ext: str) -> str:
    return next((k for k, exts in KIND.items() if ext in exts), "other")


def validate_content(name: str, data: bytes) -> str:
    """Return the extension if bytes look like what the name says; raise 400 otherwise."""
    ext = file_ext(name)
    if ext not in ALL_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"'{ext or name}' files are not supported for project analysis")
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty")
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=400, detail="Each file must be 15 MB or smaller")
    bad = HTTPException(status_code=400, detail=f"{name}: the file content doesn't match its type")
    if ext == ".pdf" and not data.startswith(b"%PDF-"):
        raise bad
    if ext in IMAGE_MAGIC and not data.startswith(IMAGE_MAGIC[ext]):
        raise bad
    if ext in {".zip", ".docx"}:
        if not data.startswith(b"PK\x03\x04"):
            raise bad
        try:
            zipfile.ZipFile(io.BytesIO(data)).namelist()
        except zipfile.BadZipFile:
            raise bad
    if ext == ".dwg" and not data[:4].startswith(b"AC10"):
        raise bad
    if ext == ".stl" and not (data[:5].lower() == b"solid" or len(data) >= 84):
        raise bad
    if ext in TEXT_EXTS:
        head = data[:200_000]
        if b"\x00" in head:
            raise bad
        try:
            head.decode("utf-8")
        except UnicodeDecodeError:
            try:
                head.decode("latin-1")
            except Exception:
                raise bad
    return ext


def store_bytes(subdir: str, name: str, data: bytes) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.basename(name or "file"))[-80:] or "file"
    rel = f"projects/{subdir}/{uuid.uuid4().hex}_{safe}"
    full = os.path.join(MEDIA_DIR, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as fh:
        fh.write(data)
    mirror_to_db(rel, full)
    return rel


def read_bytes(media_path: str) -> Optional[bytes]:
    got = load_media(media_path) if media_path else None
    return got[0] if got else None


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def decode_text(data: bytes, limit: int = 3_000_000) -> str:
    raw = data[:limit]
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1", errors="replace")
