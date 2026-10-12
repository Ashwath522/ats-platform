"""Media storage & validation utilities for profile avatars, cover banners, and certifications."""
import os
import uuid
import shutil
from fastapi import UploadFile, HTTPException

try:
    import magic
except ImportError:
    magic = None

# Base directory for publicly servable media
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MEDIA_DIR = os.path.join(BACKEND_DIR, "media")
AVATARS_DIR = os.path.join(MEDIA_DIR, "avatars")
COVERS_DIR = os.path.join(MEDIA_DIR, "covers")
CERTS_DIR = os.path.join(MEDIA_DIR, "certifications")

# Ensure subdirectories exist
for d in (MEDIA_DIR, AVATARS_DIR, COVERS_DIR, CERTS_DIR):
    os.makedirs(d, exist_ok=True)

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
ALLOWED_IMAGE_MIMES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
}

ALLOWED_CERT_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}
ALLOWED_CERT_MIMES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
}

MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5MB
MAX_CERT_SIZE = 10 * 1024 * 1024  # 10MB


def is_valid_image_magic(file_path: str) -> bool:
    """Verify image magic header bytes."""
    try:
        with open(file_path, "rb") as f:
            header = f.read(32)
            if not header:
                return False
            # PNG
            if header.startswith(b"\x89PNG\r\n\x1a\n"):
                return True
            # JPEG
            if header.startswith(b"\xff\xd8\xff"):
                return True
            # GIF
            if header.startswith(b"GIF87a") or header.startswith(b"GIF89a"):
                return True
            # WEBP (RIFF....WEBP)
            if header.startswith(b"RIFF") and b"WEBP" in header[8:16]:
                return True
    except Exception:
        return False
    return False


def is_valid_pdf_magic(file_path: str) -> bool:
    """Verify PDF magic header bytes."""
    try:
        with open(file_path, "rb") as f:
            header = f.read(16)
            return header.startswith(b"%PDF-")
    except Exception:
        return False


def validate_and_save_image(file: UploadFile, target_subfolder: str) -> str:
    """
    Validates uploaded image file size and content magic, saves to media/<target_subfolder>/,
    and returns relative path (e.g. 'avatars/abc123.jpg').
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image format '{ext}'. Allowed: PNG, JPG, JPEG, WEBP, GIF"
        )
    
    unique_name = f"{uuid.uuid4().hex}{ext}"
    dest_dir = os.path.join(MEDIA_DIR, target_subfolder)
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, unique_name)
    
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    
    if size > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Image file too large ({size / (1024*1024):.1f}MB). Max allowed: 5MB"
        )
    if size == 0:
        raise HTTPException(status_code=400, detail="Empty file uploaded")
        
    try:
        with open(dest_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
            
        # Magic validation
        if not is_valid_image_magic(dest_path):
            if magic is not None:
                detected = magic.from_file(dest_path, mime=True)
                if detected not in ALLOWED_IMAGE_MIMES:
                    os.remove(dest_path)
                    raise HTTPException(
                        status_code=400,
                        detail=f"File content is not a valid image (detected: {detected})"
                    )
            else:
                os.remove(dest_path)
                raise HTTPException(
                    status_code=400,
                    detail="File content header does not match valid image format"
                )
    except Exception as e:
        if os.path.exists(dest_path):
            try:
                os.remove(dest_path)
            except Exception:
                pass
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Failed to save image: {str(e)}")
        
    rel = f"{target_subfolder}/{unique_name}"
    mirror_to_db(rel, dest_path)
    return rel


def validate_and_save_cert_file(file: UploadFile) -> str:
    """
    Validates uploaded certification document/image, saves to media/certifications/,
    and returns relative path (e.g. 'certifications/abc123.pdf').
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
        
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_CERT_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid certification format '{ext}'. Allowed: PDF, PNG, JPG, JPEG, WEBP"
        )
        
    unique_name = f"{uuid.uuid4().hex}{ext}"
    dest_path = os.path.join(CERTS_DIR, unique_name)
    
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    
    if size > MAX_CERT_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Certificate file too large ({size / (1024*1024):.1f}MB). Max allowed: 10MB"
        )
    if size == 0:
        raise HTTPException(status_code=400, detail="Empty file uploaded")
        
    try:
        with open(dest_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
            
        # Magic validation
        is_image = ext in ALLOWED_IMAGE_EXTENSIONS and is_valid_image_magic(dest_path)
        is_pdf = ext == ".pdf" and is_valid_pdf_magic(dest_path)
        
        if not (is_image or is_pdf):
            if magic is not None:
                detected = magic.from_file(dest_path, mime=True)
                if detected not in ALLOWED_CERT_MIMES:
                    os.remove(dest_path)
                    raise HTTPException(
                        status_code=400,
                        detail=f"File content is not a valid certificate document (detected: {detected})"
                    )
            else:
                os.remove(dest_path)
                raise HTTPException(
                    status_code=400,
                    detail="File header does not match valid certificate format (PDF/Image)"
                )
    except Exception as e:
        if os.path.exists(dest_path):
            try:
                os.remove(dest_path)
            except Exception:
                pass
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Failed to save certificate: {str(e)}")
        
    rel = f"certifications/{unique_name}"
    mirror_to_db(rel, dest_path)
    return rel


def delete_media_file(relative_path: str) -> None:
    """Safely remove a media file if it exists."""
    if not relative_path:
        return
    # Guard against directory traversal
    clean_rel = os.path.normpath(relative_path).lstrip("/")
    if clean_rel.startswith(".."):
        return
    full_path = os.path.join(MEDIA_DIR, clean_rel)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        try:
            os.remove(full_path)
        except Exception:
            pass
    if media_db_enabled():
        try:
            from sqlmodel import Session, select
            from ..db import engine, MediaBlob

            with Session(engine) as session:
                row = session.exec(select(MediaBlob).where(MediaBlob.path == clean_rel.replace(os.sep, "/"))).first()
                if row:
                    session.delete(row)
                    session.commit()
        except Exception:
            pass


# ── Durable media (survives container restarts on ephemeral-disk hosts) ──────

def media_db_enabled() -> bool:
    mode = os.environ.get("MEDIA_STORE", "").strip().lower()
    if mode in {"db", "disk"}:
        return mode == "db"
    return bool(os.environ.get("DATABASE_URL"))


def mirror_to_db(relative_path: str, full_path: str) -> None:
    if not media_db_enabled():
        return
    try:
        import mimetypes
        from sqlmodel import Session, select
        from ..db import engine, MediaBlob

        with open(full_path, "rb") as fh:
            data = fh.read()
        ctype = mimetypes.guess_type(full_path)[0] or "application/octet-stream"
        with Session(engine) as session:
            row = session.exec(select(MediaBlob).where(MediaBlob.path == relative_path)).first() or MediaBlob(path=relative_path)
            row.data, row.content_type = data, ctype
            session.add(row)
            session.commit()
    except Exception as exc:  # never break the upload because of the mirror
        import logging
        logging.getLogger("ats-platform").warning("[MEDIA] DB mirror failed for %s: %s", relative_path, exc)


def load_media(relative_path: str):
    """Return (bytes, content_type) from disk or DB, or None. Rehydrates the
    disk cache from the DB after a restart."""
    import mimetypes

    clean = os.path.normpath(relative_path).lstrip("/\\")
    if clean.startswith("..") or os.path.isabs(clean):
        return None
    full = os.path.join(MEDIA_DIR, clean)
    if os.path.isfile(full):
        with open(full, "rb") as fh:
            return fh.read(), mimetypes.guess_type(full)[0] or "application/octet-stream"
    if not media_db_enabled():
        return None
    from sqlmodel import Session, select
    from ..db import engine, MediaBlob

    with Session(engine) as session:
        row = session.exec(select(MediaBlob).where(MediaBlob.path == clean.replace(os.sep, "/"))).first()
        if not row:
            return None
        try:
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "wb") as fh:
                fh.write(row.data)
        except Exception:
            pass
        return row.data, row.content_type
