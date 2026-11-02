"""Domain analysers: deterministic rules over extracted evidence. One per domain."""
from __future__ import annotations

import re

from ..context import Ctx
from ..extractors.base import clip
from . import electronics, software


def _docs(ctx: Ctx) -> dict:
    docs = ctx.of_type("document")
    return {"documents": [{"file": d.get("file"), "pages": d.get("pages"), "words": d.get("words"), "sections": len(d.get("headings", []))} for d in docs]}


def mechanical(ctx: Ctx) -> dict:
    cad = ctx.of_type("cad")
    meshes = ctx.of_type("mesh")
    drawings = ctx.of_type("drawing")
    parts = sorted({p for b in cad for p in b.get("parts", [])} | {p for b in meshes for p in b.get("parts", [])})
    dims = [d for b in drawings for d in b.get("dimensions", [])]
    if not cad and not meshes:
        ctx.finding("No 3D model (STEP/STL/OBJ) was uploaded.", severity="missing", kind="no_model")
    for m in meshes:
        if m.get("triangles") and not m.get("watertight"):
            ctx.finding(f"{m['file']} is not a closed solid — it may not be printable/manufacturable as is.", severity="warn", kind="mesh_open", cites=ctx.cite("watertight"))
    if drawings and not dims:
        ctx.finding("Drawings were uploaded but contain no dimension entities.", severity="warn", kind="no_dims", cites=ctx.cite("entities"))
    if not drawings:
        ctx.finding("No dimensioned drawing (DXF/PDF) was uploaded.", severity="missing", kind="no_drawing")
    ctx.finding("How the mechanism moves cannot be read from CAD files; only the demo video can show it.", severity="info", kind="motion_limit", confidence="high")
    return _docs(ctx) | {"parts": parts[:60], "solids": sum(b.get("solids", 0) for b in cad), "assembly_links": sum(b.get("assembly_links", 0) for b in cad),
                         "meshes": [{k: m.get(k) for k in ("file", "triangles", "bbox", "watertight", "volume")} for m in meshes],
                         "dimensions": dims[:40], "drawings": [{k: d.get(k) for k in ("file", "layers")} for d in drawings]}


def civil(ctx: Ctx) -> dict:
    bim = ctx.of_type("bim")
    drawings = ctx.of_type("drawing")
    elements = {}
    for b in bim:
        for k, v in b.get("elements", {}).items():
            elements[k] = elements.get(k, 0) + v
    if not bim and not drawings and not ctx.of_type("document"):
        ctx.finding("No plans, BIM model or report was uploaded.", severity="missing", kind="no_plans")
    if elements and not any(k in elements for k in ("Footing", "Pile")):
        ctx.finding("The BIM model has no footing or pile elements — the foundation design is not shown.", severity="info", kind="no_foundation", cites=ctx.cite("elements"))
    calc = any(re.search(r"\b(load|moment|shear|IS ?456|IS ?800|design calculation|bending)\b", (ex.text or ""), re.I) for ex in ctx.extracted)
    if not calc:
        ctx.finding("No structural calculations were found in the documents.", severity="missing", kind="no_calcs")
    ctx.finding("Structural safety and code-compliance claims are not independently checked by CoreLink.", severity="info", kind="safety_limit")
    return _docs(ctx) | {"elements": elements, "storeys": [s for b in bim for s in b.get("storeys", [])], "materials": sorted({m for b in bim for m in b.get("materials", [])}),
                         "dimensions": [d for b in drawings for d in b.get("dimensions", [])][:40], "has_calculations": calc}


def robotics(ctx: Ctx) -> dict:
    el = electronics.analyse(ctx)
    sw = software.analyse_software(ctx)
    topics = {}
    for b in ctx.of_type("arduino"):
        for t in b.get("mqtt_topics", []):
            topics.setdefault(t, set()).add(b["file"])
    sensors = [l["library"] for l in el["libraries"]]
    chain = {"sensors_and_peripherals": sensors, "controller": [c["value"] for c in el["components"] if re.search(r"arduino|esp|atmega|stm32|pico|nano|uno|mega", str(c["value"]), re.I)][:3],
             "outputs": [r["pin"] for r in el["pin_map"] if "output" in r.get("code", "") or "servo" in r.get("code", "")]}
    if not el["comms"] and not topics:
        ctx.finding("No communication (Wi-Fi, MQTT, Bluetooth…) was found in the firmware.", severity="info", kind="no_comms")
    return el | {"software": sw, "mqtt_topics": {k: sorted(v) for k, v in topics.items()}, "control_chain": chain}


def other(ctx: Ctx) -> dict:
    if not ctx.files:
        ctx.finding("No files were uploaded.", severity="missing", kind="no_files")
    return _docs(ctx)


def run(ctx: Ctx) -> dict:
    fn = {"electronics": electronics.analyse, "software": software.analyse_software, "ai_ml": software.analyse_ml,
          "mechanical": mechanical, "civil": civil, "robotics_iot": robotics}.get(ctx.domain, other)
    data = fn(ctx)
    if ctx.domain in {"electronics", "software", "ai_ml"}:
        data |= _docs(ctx)
    return data
