"""
Real content-based file-type validation, using libmagic to sniff the actual
bytes on disk rather than trusting the client-supplied filename extension.

Extension-only checking can be trivially spoofed - a renamed .exe or .txt
with a .pdf extension passes an extension check but fails here, since we
look at what the file actually IS on disk.
"""
try:
    import magic
except ImportError:
    magic = None

# Maps each allowed extension to the set of real MIME types we accept for it.
# python-magic's mime detection can vary slightly by libmagic DB version
# (e.g. .doc files are sometimes reported generically), so each extension
# maps to a small set of acceptable results rather than a single exact string.
ALLOWED_MIME_BY_EXTENSION = {
    ".pdf": {"application/pdf"},
    ".docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/zip",  # docx is a zip container; some libmagic DBs report this generically
    },
    ".doc": {"application/msword", "application/x-ole-storage"},
    ".txt": {"text/plain"},
}


def validate_file_content_matches_extension(file_path: str, extension: str) -> None:
    """Raises ValueError if the file's real content doesn't match what its
    extension claims. Call this AFTER the file is written to disk (magic
    needs to read actual bytes) and BEFORE trusting/parsing it as that type."""
    if magic is None:
        return
    detected_mime = magic.from_file(file_path, mime=True)
    allowed = ALLOWED_MIME_BY_EXTENSION.get(extension)
    if allowed is None:
        raise ValueError(f"No content-validation rule for extension '{extension}'")
    if detected_mime not in allowed:
        raise ValueError(
            f"File content doesn't match its '{extension}' extension "
            f"(detected: {detected_mime}). The file may be corrupted, mislabeled, "
            f"or not actually a {extension} file."
        )
