"""Route a project file to the right extractor. Never executes file content."""
from __future__ import annotations

import io
import zipfile
from typing import List

from ..files import decode_text, file_ext
from .base import Extracted, Fact, clip

ZIP_MAX_FILES = 60
ZIP_MAX_MEMBER = 2 * 1024 * 1024
ZIP_MAX_TOTAL = 200 * 1024 * 1024
ZIP_MAX_RATIO = 100
ZIP_SKIP = ("node_modules/", ".git/", "__pycache__/", "venv/", ".venv/", "build/", "dist/", ".pio/", ".idea/", ".vscode/")
ZIP_TEXT = {".ino", ".c", ".cpp", ".h", ".hpp", ".py", ".js", ".ts", ".java", ".ipynb", ".kicad_sch", ".net", ".kicad_pcb",
            ".json", ".md", ".txt", ".csv", ".ini", ".dxf", ".step", ".stp", ".ifc", ".obj"}
PROJECT_MARKERS = {"platformio.ini": "PlatformIO firmware project", "package.json": "Node.js project", "requirements.txt": "Python project",
                   "pyproject.toml": "Python project", "pom.xml": "Java (Maven) project", "build.gradle": "Java/Android (Gradle) project",
                   "dockerfile": "Docker setup", ".kicad_pro": "KiCad project", "diagram.json": "Wokwi simulation"}
DEP_FILES = {"package.json", "requirements.txt", "pyproject.toml", "pom.xml", "build.gradle", "platformio.ini"}


def extract(name: str, data: bytes, _depth: int = 0) -> Extracted:
    ext = file_ext(name)
    try:
        if ext == ".pdf":
            from .documents import parse_pdf
            return parse_pdf(name, data)
        if ext == ".docx":
            from .documents import parse_docx
            return parse_docx(name, data)
        if ext in {".png", ".jpg", ".jpeg", ".webp"}:
            return _image(name, data)
        if ext == ".stl":
            from .cad import parse_stl
            return parse_stl(name, data)
        if ext == ".zip":
            return _zip(name, data, _depth)
        if ext == ".dwg":
            ex = Extracted(kind="unsupported")
            ex.warnings.append(f"{name}: DWG drawings can't be read for free — export DXF or PDF from your CAD tool.")
            return ex
        text = decode_text(data)
        if ext in {".md", ".txt"}:
            from .documents import parse_text
            return parse_text(name, text)
        if ext in {".ino", ".c", ".cpp", ".h", ".hpp", ".py", ".js", ".ts", ".java"}:
            from .code import parse_code
            return parse_code(name, text, ext)
        if ext == ".kicad_sch":
            from .circuits import parse_kicad_sch
            return parse_kicad_sch(name, text)
        if ext == ".net":
            from .circuits import parse_kicad_net
            return parse_kicad_net(name, text)
        if ext == ".kicad_pcb":
            from .circuits import parse_kicad_pcb
            return parse_kicad_pcb(name, text)
        if ext == ".json":
            from .circuits import parse_json
            return parse_json(name, text)
        if ext == ".ipynb":
            from .data import parse_ipynb
            return parse_ipynb(name, text)
        if ext == ".csv":
            from .data import parse_csv
            return parse_csv(name, text)
        if ext in {".step", ".stp", ".iges", ".igs"}:
            from .cad import parse_step
            return parse_step(name, text)
        if ext == ".obj":
            from .cad import parse_obj
            return parse_obj(name, text)
        if ext == ".dxf":
            from .cad import parse_dxf
            return parse_dxf(name, text)
        if ext == ".ifc":
            from .cad import parse_ifc
            return parse_ifc(name, text)
        if ext == ".ini":
            ex = Extracted(kind="config")
            envs = [l.strip("[] \n") for l in text.splitlines() if l.strip().startswith("[env:")]
            boards = [l.split("=", 1)[1].strip() for l in text.splitlines() if l.strip().startswith("board") and "=" in l]
            ex.add(f"{name}: config" + (f", environments {clip(envs)}" if envs else "") + (f", boards {clip(boards)}" if boards else ""), locator={"file": name})
            ex.data = {"type": "config", "file": name, "boards": boards}
            return ex
    except Exception as exc:  # one broken file must never break the analysis
        ex = Extracted(kind="error")
        ex.warnings.append(f"{name}: could not be read ({type(exc).__name__}).")
        return ex
    ex = Extracted(kind="unsupported")
    ex.warnings.append(f"{name}: this file type is stored but not analysed.")
    return ex


def _image(name: str, data: bytes) -> Extracted:
    ex = Extracted(kind="image", data={"type": "image", "file": name})
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data))
        ex.add(f"{name}: image {im.width}×{im.height} px", locator={"file": name})
        ex.data.update({"width": im.width, "height": im.height})
    except Exception:
        ex.warnings.append(f"{name}: image could not be opened.")
    return ex


def _zip(name: str, data: bytes, depth: int) -> Extracted:
    ex = Extracted(kind="zip", data={"type": "archive", "file": name, "members": []})
    if depth > 0:
        ex.warnings.append(f"{name}: nested archives are not opened.")
        return ex
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        ex.warnings.append(f"{name}: not a valid ZIP archive.")
        return ex
    infos = [i for i in zf.infolist() if not i.is_dir()]
    total = sum(i.file_size for i in infos)
    if total > ZIP_MAX_TOTAL or any(i.compress_size and i.file_size / max(1, i.compress_size) > ZIP_MAX_RATIO and i.file_size > 1_000_000 for i in infos):
        ex.warnings.append(f"{name}: archive rejected — it expands too much (possible zip bomb).")
        ex.data["rejected"] = True
        return ex
    kept = [i for i in infos if not any(s in "/" + i.filename.lower().replace("\\", "/") for s in ("/" + s for s in ZIP_SKIP))]
    top = sorted({i.filename.split("/")[0] + ("/" if "/" in i.filename else "") for i in kept})
    markers = sorted({label for i in kept for key, label in PROJECT_MARKERS.items() if i.filename.lower().rsplit("/", 1)[-1] == key or i.filename.lower().endswith(key)})
    ex.add(f"{name}: archive with {len(kept)} files; top level: {clip(top, 12)}", locator={"file": name}, key="tree")
    if markers:
        ex.add(f"{name} contains: {', '.join(markers)}", locator={"file": name}, key="markers")
    deps = {}
    read = 0
    for info in sorted(kept, key=lambda i: (i.filename.count("/"), i.filename)):
        inner = info.filename.replace("\\", "/")
        base = inner.rsplit("/", 1)[-1].lower()
        if base in DEP_FILES and info.file_size <= ZIP_MAX_MEMBER:
            deps[base] = decode_text(zf.read(info))[:20000]
        if read >= ZIP_MAX_FILES or info.file_size > ZIP_MAX_MEMBER or file_ext(inner) not in ZIP_TEXT:
            continue
        sub = extract(f"{name}/{inner}", zf.read(info), depth + 1)
        read += 1
        ex.facts.extend(sub.facts[:6])
        ex.warnings.extend(sub.warnings[:2])
        if sub.data:
            ex.data["members"].append(sub.data)
        if sub.text and len(ex.text) < 20000:
            ex.text += "\n" + sub.text[:5000]
    ex.data["deps"] = deps
    ex.data["paths"] = [i.filename for i in kept[:2000]]
    ex.data["tests"] = sum(1 for i in kept if "test" in i.filename.lower())
    ex.data["ci"] = any(i.filename.startswith((".github/workflows", ".gitlab-ci")) or "/.github/workflows/" in i.filename for i in kept)
    return ex


def flatten(extracted: List[Extracted]) -> List[dict]:
    """All structured data blocks, including the ones found inside archives."""
    out = []
    for ex in extracted:
        if ex.data:
            out.append(ex.data)
            out.extend(ex.data.get("members", []) if ex.data.get("type") == "archive" else [])
    return out


__all__ = ["extract", "flatten", "Extracted", "Fact"]
