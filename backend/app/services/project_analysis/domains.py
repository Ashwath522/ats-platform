from dataclasses import asdict, dataclass

@dataclass(frozen=True)
class Domain:
    key: str
    label: str
    description: str
    extensions: tuple[str, ...]
    suggested_evidence: tuple[str, ...]

_COMMON = (".pdf", ".png", ".jpg")
DOMAINS = (
    Domain("electronics", "Electronics", "Circuits, embedded systems and hardware.", (".kicad_sch", ".kicad_pcb", ".net", ".json", ".ino", ".c", ".cpp", ".h", * _COMMON), ("Schematic, PCB, firmware, simulation or test evidence",)),
    Domain("mechanical", "Mechanical", "Mechanical design and manufacturing.", (".step", ".stp", ".iges", ".igs", ".stl", ".obj", ".dxf", ".dwg", *_COMMON), ("CAD model, drawing, dimensions or prototype photos",)),
    Domain("civil", "Civil", "Structures, construction and infrastructure.", (".ifc", ".dxf", ".dwg", ".pdf", ".xlsx", ".csv", ".png", ".jpg"), ("Plans, calculations, schedules or site evidence",)),
    Domain("software", "Software", "Applications, systems and engineering code.", (".zip", ".pdf", ".md"), ("Source archive, documentation and GitHub link",)),
    Domain("ai_ml", "AI / ML", "Data-driven and machine-learning projects.", (".ipynb", ".py", ".csv", ".json", ".pdf", ".zip"), ("Notebook, dataset, evaluation and GitHub link",)),
    Domain("robotics_iot", "Robotics / IoT", "Integrated hardware, software and control systems.", tuple(sorted(set((".kicad_sch", ".kicad_pcb", ".net", ".json", ".ino", ".c", ".cpp", ".h", ".zip", ".py", ".ipynb", ".pdf", ".png", ".jpg")))), ("Circuit, firmware, control code and demo video",)),
    Domain("other", "Other", "Other engineering work.", (".pdf", ".docx", ".zip", ".png", ".jpg"), ("Report, source files, drawings or photos",)),
)
DOMAIN_MAP = {d.key: d for d in DOMAINS}
ALL_EXTENSIONS = set(x for d in DOMAINS for x in d.extensions)
def domain_list():
    return [asdict(d) for d in DOMAINS]
