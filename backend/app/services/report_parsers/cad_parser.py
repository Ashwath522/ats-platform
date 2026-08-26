"""
parsers/cad_parser.py
─────────────────────
CAD drawings. Reads .dxf with ezdxf, pulling text labels, layer names
and block names. For binary .dwg we can only describe the filename.
"""

import os


def parse_cad(file_path: str) -> tuple[str, str]:
    """Return (text, method) for a .dxf / .dwg file."""
    lower = file_path.lower()

    # ── .dwg is a proprietary binary format ezdxf cannot read directly.
    if lower.endswith(".dwg"):
        name = os.path.splitext(os.path.basename(file_path))[0]
        return (
            f"CAD drawing (AutoCAD .dwg binary): '{name}'. "
            f"Likely a mechanical/civil design drawing. "
            f"Keywords: CAD, AutoCAD, drafting, engineering drawing, design.",
            "dwg_filename",
        )

    # ── .dxf → parse with ezdxf.
    try:
        import ezdxf
    except Exception as exc:
        return (f"ezdxf not available: {exc}", "cad_error")

    try:
        doc = ezdxf.readfile(file_path)
    except Exception as exc:
        return (
            f"Could not read DXF '{os.path.basename(file_path)}': {exc}",
            "cad_error",
        )

    labels: list[str] = []
    layers: list[str] = []
    blocks: list[str] = []

    try:
        # Layer names.
        for layer in doc.layers:
            if layer.dxf.name:
                layers.append(layer.dxf.name)

        # Block/definition names.
        for block in doc.blocks:
            if block.name and not block.name.startswith("*"):
                blocks.append(block.name)

        # Text + MText entities in modelspace.
        msp = doc.modelspace()
        for entity in msp:
            try:
                if entity.dxftype() == "TEXT":
                    labels.append(entity.dxf.text)
                elif entity.dxftype() == "MTEXT":
                    labels.append(entity.text)
            except Exception:
                continue
    except Exception as exc:
        return (f"DXF parsed partially, error: {exc}", "ezdxf")

    text = (
        f"CAD Drawing (DXF). "
        f"Layers: {', '.join(sorted(set(layers))) or 'none'}. "
        f"Labels: {', '.join(l.strip() for l in labels if l.strip()) or 'none'}. "
        f"Blocks: {', '.join(sorted(set(blocks))) or 'none'}. "
        f"Keywords: CAD, technical drawing, drafting, engineering design."
    )
    return (text, "ezdxf")
