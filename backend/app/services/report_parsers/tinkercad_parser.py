"""
parsers/tinkercad_parser.py
───────────────────────────
TinkerCAD / generic circuit JSON exports. Looks for common keys that
hold component/shape/part names and lists them.
"""

import os
import json


def _collect_names(node, found: list):
    """Recursively pull plausible 'name'/'type' strings out of the JSON."""
    if isinstance(node, dict):
        for key in ("name", "type", "component", "componentId", "part",
                    "shape", "label", "title", "kind"):
            val = node.get(key)
            if isinstance(val, str) and val.strip():
                found.append(val.strip())
        for value in node.values():
            _collect_names(value, found)
    elif isinstance(node, list):
        for item in node:
            _collect_names(item, found)


def _filename_fallback(file_path: str) -> tuple[str, str]:
    """Derive keywords from the filename when the JSON yields nothing."""
    base = os.path.basename(file_path)
    stem = os.path.splitext(base)[0].replace("_", " ").replace("-", " ")
    return (
        f"TinkerCAD / circuit design file '{base}' (topic: {stem}). "
        f"Keywords: circuit design, electronics, embedded systems, "
        f"Arduino, TinkerCAD, prototyping, hardware.",
        "tinkercad_fallback",
    )


def parse_tinkercad(file_path: str) -> tuple[str, str]:
    """Return (text, method) for a .json circuit/design file."""
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as fh:
            data = json.load(fh)
    except Exception:
        # Not valid JSON — still give the AI something from the filename.
        return _filename_fallback(file_path)

    names: list[str] = []

    # Prefer the well-known container keys first.
    if isinstance(data, dict):
        for container in ("components", "shapes", "objects", "parts",
                          "items", "children", "nodes", "elements"):
            if container in data:
                _collect_names(data[container], names)

        # Also capture short top-level string values (e.g. a project title,
        # board type) — skip opaque ids.
        for k, v in data.items():
            if k.lower() == "id":
                continue
            if isinstance(v, str) and 1 < len(v.strip()) <= 60:
                names.append(v.strip())

    # Fall back to a full recursive scan if nothing was found.
    if not names:
        _collect_names(data, names)

    unique = sorted(set(n for n in names if len(n) > 1))
    if not unique:
        # Nothing usable in the JSON body → use the filename.
        return _filename_fallback(file_path)

    text = (
        f"TinkerCAD / circuit design containing: {', '.join(unique)}. "
        f"Keywords: circuit design, electronics, embedded, TinkerCAD, prototyping."
    )
    return (text, "tinkercad_json")
