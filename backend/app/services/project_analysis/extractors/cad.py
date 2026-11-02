"""CAD / BIM files read as data only: DXF (ezdxf), STL, OBJ, STEP/IGES headers, IFC.

What these files cannot tell us (mechanism movement, structural safety) is
never inferred — the analysers say so explicitly.
"""
from __future__ import annotations

import io
import math
import re
import struct
from collections import Counter

from .base import Extracted, clip


def _bbox_fact(dims):
    return "x {:.4g} × y {:.4g} × z {:.4g} (file units)".format(*dims)


def parse_stl(name: str, data: bytes) -> Extracted:
    ex = Extracted(kind="stl")
    tris = []
    binary = len(data) >= 84 and len(data) == 84 + struct.unpack_from("<I", data, 80)[0] * 50
    if binary:
        n = struct.unpack_from("<I", data, 80)[0]
        for off in range(84, 84 + min(n, 400_000) * 50, 50):
            v = struct.unpack_from("<9f", data, off + 12)
            tris.append((v[0:3], v[3:6], v[6:9]))
    else:
        text = data.decode("utf-8", "ignore")
        pts = [tuple(float(x) for x in m) for m in re.findall(r"vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)", text)]
        tris = [tuple(pts[i:i + 3]) for i in range(0, len(pts) - 2, 3)]
    if not tris:
        ex.warnings.append(f"{name}: no triangles found in this STL file.")
        return ex
    xs = [p[0] for t in tris for p in t]; ys = [p[1] for t in tris for p in t]; zs = [p[2] for t in tris for p in t]
    dims = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    edges = Counter()
    vol = 0.0
    for a, b, c in tris:
        for e in ((a, b), (b, c), (c, a)):
            edges[tuple(sorted((tuple(round(x, 5) for x in e[0]), tuple(round(x, 5) for x in e[1]))))] += 1
        vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6.0
    watertight = all(v == 2 for v in edges.values())
    ex.add(f"{name}: STL mesh with {len(tris)} triangles, size {_bbox_fact(dims)}", locator={"file": name}, key="mesh")
    ex.add(f"{name}: mesh is {'watertight (closed solid)' if watertight else 'not watertight (open or broken edges)'}"
           + (f", enclosed volume ≈ {abs(vol):.4g} cubic units" if watertight else ""), locator={"file": name}, key="watertight")
    ex.data = {"type": "mesh", "file": name, "triangles": len(tris), "bbox": dims, "watertight": watertight, "volume": abs(vol) if watertight else None}
    return ex


def parse_obj(name: str, text: str) -> Extracted:
    ex = Extracted(kind="obj")
    vs = [tuple(map(float, m)) for m in re.findall(r"^v\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)", text, re.M)]
    faces = len(re.findall(r"^f\s", text, re.M))
    groups = sorted(set(re.findall(r"^[og]\s+(.+)$", text, re.M)))
    if vs:
        dims = tuple(max(p[i] for p in vs) - min(p[i] for p in vs) for i in range(3))
        ex.add(f"{name}: OBJ mesh with {len(vs)} vertices and {faces} faces, size {_bbox_fact(dims)}", locator={"file": name}, key="mesh")
    if groups:
        ex.add(f"{name}: named objects/groups: {clip(groups)}", locator={"file": name}, key="parts")
    ex.data = {"type": "mesh", "file": name, "vertices": len(vs), "faces": faces, "parts": groups}
    return ex


def parse_step(name: str, text: str) -> Extracted:
    ex = Extracted(kind="step")
    is_iges = name.lower().endswith((".iges", ".igs"))
    if is_iges:
        ex.add(f"{name}: IGES model ({text.count(chr(10))} lines). Geometry is not analysed; export STEP for part names.", locator={"file": name})
        ex.data = {"type": "cad", "file": name, "parts": [], "solids": 0}
        return ex
    products = list(dict.fromkeys(m.strip() for m in re.findall(r"PRODUCT\s*\(\s*'([^']*)'", text, re.I) if m.strip()))
    solids = len(re.findall(r"MANIFOLD_SOLID_BREP|BREP_WITH_VOIDS", text, re.I))
    assemblies = len(re.findall(r"NEXT_ASSEMBLY_USAGE_OCCURRENCE", text, re.I))
    origin = re.search(r"FILE_NAME\s*\((?:[^,]*,){5}\s*'([^']*)'", text, re.I)
    units = "mm" if re.search(r"SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.", text, re.I) else ("m" if "SI_UNIT(*,.METRE.)" in text.replace(" ", "").upper() else None)
    ex.add(f"{name}: STEP model with {len(products)} named part(s), {solids} solid body(ies), {assemblies} assembly link(s)"
           + (f", units {units}" if units else ""), locator={"file": name}, key="model")
    if products:
        ex.add(f"{name}: parts named {clip(products, 15)}", locator={"file": name}, key="parts")
    if origin and origin.group(1).strip():
        ex.add(f"{name}: exported from {origin.group(1)[:60]}", locator={"file": name}, confidence="medium")
    ex.data = {"type": "cad", "file": name, "parts": products, "solids": solids, "assembly_links": assemblies, "units": units}
    return ex


def parse_dxf(name: str, text: str) -> Extracted:
    ex = Extracted(kind="dxf")
    try:
        import ezdxf
        doc = ezdxf.read(io.StringIO(text))
    except Exception as exc:
        ex.warnings.append(f"{name}: the DXF could not be read ({type(exc).__name__}).")
        return ex
    msp = doc.modelspace()
    types = Counter(e.dxftype() for e in msp)
    layers = sorted({e.dxf.layer for e in msp if e.dxf.hasattr("layer")})
    texts = []
    for e in msp.query("TEXT MTEXT"):
        t = e.dxf.text if e.dxftype() == "TEXT" else e.plain_text()
        if t and t.strip():
            texts.append(t.strip()[:60])
    dims = []
    for d in msp.query("DIMENSION"):
        try:
            val = d.get_measurement()
            val = val if isinstance(val, (int, float)) else math.dist((0, 0), (val.x, val.y))
            dims.append(round(float(val), 3))
        except Exception:
            pass
    ex.add(f"{name}: drawing with {sum(types.values())} entities ({clip([f'{k}×{v}' for k, v in types.most_common(6)])})", locator={"file": name}, key="entities")
    if layers:
        ex.add(f"{name}: layers {clip(layers, 15)}", locator={"file": name}, key="layers")
    if dims:
        ex.add(f"{name}: {len(dims)} dimension(s), e.g. {clip(dims, 10)} (drawing units)", locator={"file": name}, key="dimensions")
    if texts:
        ex.add(f"{name}: annotations {clip(list(dict.fromkeys(texts)), 10)}", locator={"file": name}, key="annotations")
    ex.data = {"type": "drawing", "file": name, "entities": dict(types), "layers": layers, "dimensions": dims, "annotations": texts[:50]}
    return ex


IFC_ELEMENTS = ("IFCWALL", "IFCWALLSTANDARDCASE", "IFCSLAB", "IFCBEAM", "IFCCOLUMN", "IFCFOOTING", "IFCSTAIR", "IFCROOF",
                "IFCDOOR", "IFCWINDOW", "IFCPILE", "IFCMEMBER", "IFCPLATE", "IFCRAILING", "IFCSPACE")


def parse_ifc(name: str, text: str) -> Extracted:
    ex = Extracted(kind="ifc")
    counts = {}
    for el in IFC_ELEMENTS:
        n = len(re.findall(rf"=\s*{el}\s*\(", text, re.I))
        if n:
            label = el[3:].replace("STANDARDCASE", "").title()
            counts[label] = counts.get(label, 0) + n
    storeys = re.findall(r"IFCBUILDINGSTOREY\s*\(\s*'[^']*'\s*,\s*#\d+\s*,\s*'([^']*)'", text, re.I)
    materials = sorted(set(re.findall(r"IFCMATERIAL\s*\(\s*'([^']+)'", text, re.I)))
    schema = re.search(r"FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'", text, re.I)
    if counts:
        ex.add(f"{name}: BIM elements {clip([f'{k} ×{v}' for k, v in sorted(counts.items(), key=lambda x: -x[1])], 12)}", locator={"file": name}, key="elements")
    else:
        ex.warnings.append(f"{name}: no structural elements found in this IFC file.")
    if storeys:
        ex.add(f"{name}: {len(storeys)} storey(s): {clip(storeys)}", locator={"file": name}, key="storeys")
    if materials:
        ex.add(f"{name}: materials {clip(materials)}", locator={"file": name}, key="materials")
    ex.data = {"type": "bim", "file": name, "elements": counts, "storeys": storeys, "materials": materials, "schema": schema.group(1) if schema else None}
    return ex
