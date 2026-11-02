"""Engineering domains a project can belong to, and which files each accepts.

Single source of truth for the backend and (via GET /api/student/project-domains)
for the frontend, so the two never disagree about allowed file types.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

_DOCS = (".pdf", ".docx", ".md", ".txt")
_IMAGES = (".png", ".jpg", ".jpeg", ".webp")
_ELEC = (".kicad_sch", ".kicad_pcb", ".net", ".json", ".ino", ".c", ".cpp", ".h", ".hpp", ".ini")
_CODE = (".zip", ".py", ".js", ".ts", ".java", ".c", ".cpp", ".h", ".ipynb", ".json", ".csv")


@dataclass(frozen=True)
class Domain:
    key: str
    label: str
    description: str
    extensions: tuple
    suggested_evidence: tuple
    tip: str = ""


DOMAINS = (
    Domain("electronics", "Electronics", "Circuits, embedded systems and hardware.",
           tuple(dict.fromkeys(_ELEC + _DOCS + _IMAGES + (".zip",))),
           ("KiCad schematic + netlist (.kicad_sch, .net)", "Wokwi diagram.json or TinkerCAD export", "Arduino / firmware code (.ino, .cpp)", "Report PDF", "Circuit photos"),
           "Export a KiCad netlist (.net) or a Wokwi diagram.json — they give exact wiring."),
    Domain("mechanical", "Mechanical", "Mechanical design, mechanisms and manufacturing.",
           tuple(dict.fromkeys((".step", ".stp", ".iges", ".igs", ".stl", ".obj", ".dxf", ".dwg") + _DOCS + _IMAGES + (".zip", ".csv"))),
           ("CAD model (STEP / STL)", "Drawings with dimensions (DXF / PDF)", "Design report", "Prototype photos"),
           "SolidWorks/Fusion files can't be read — export STEP or STL. Movement is proven by your demo video."),
    Domain("civil", "Civil", "Structures, construction and infrastructure.",
           tuple(dict.fromkeys((".ifc", ".dxf", ".dwg", ".csv") + _DOCS + _IMAGES + (".zip",))),
           ("BIM model (.ifc)", "Plans and drawings (DXF / PDF)", "Calculations report", "Site photos"),
           "Structural safety claims are always marked as not independently checked."),
    Domain("software", "Software", "Applications, systems and engineering code.",
           tuple(dict.fromkeys(_CODE + _DOCS + _IMAGES)),
           ("GitHub link (in Links)", "Source code ZIP", "README / documentation", "Screenshots"),
           "Add your GitHub repository as a project link — commit history is checked."),
    Domain("ai_ml", "AI / ML", "Data-driven and machine-learning projects.",
           tuple(dict.fromkeys(_CODE + _DOCS + _IMAGES)),
           ("Training notebook (.ipynb) with outputs", "Dataset sample (.csv)", "Evaluation results", "GitHub link"),
           "Keep notebook outputs — metrics are read from them and compared with your claims."),
    Domain("robotics_iot", "Robotics / IoT", "Hardware, firmware, control and connected systems.",
           tuple(dict.fromkeys(_ELEC + _CODE + _DOCS + _IMAGES)),
           ("Circuit file (KiCad / Wokwi / TinkerCAD)", "Firmware and control code", "Dashboard / app code", "Demo video"),
           "Upload both the circuit and the code so pins and protocols can be cross-checked."),
    Domain("other", "Other", "Any other engineering work.",
           tuple(dict.fromkeys(_DOCS + _IMAGES + (".zip", ".csv", ".dxf", ".stl", ".step", ".stp"))),
           ("Project report", "Source files or drawings", "Photos"), ""),
)

DOMAIN_MAP = {d.key: d for d in DOMAINS}
ALL_EXTENSIONS = frozenset(x for d in DOMAINS for x in d.extensions)


def domain_list() -> list:
    return [asdict(d) | {"extensions": list(d.extensions), "suggested_evidence": list(d.suggested_evidence)} for d in DOMAINS]
