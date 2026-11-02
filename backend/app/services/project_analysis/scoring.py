"""Explainable, deterministic project scoring (no AI involved).

Each domain has its own rubric of criteria. A criterion returns a 0–10 score
with a reason and the evidence it used — or None when there is not enough
evidence, which is reported as "insufficient evidence", never as 0.
Evidence that only comes from images/video/transcripts is capped at 6/10.
Same input → same score, always.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

from .context import Ctx
from .schemas import Claim

DIMENSIONS = {
    "technical_understanding": "Technical understanding",
    "implementation_quality": "Design & implementation",
    "functionality": "Functionality",
    "evidence_consistency": "Evidence consistency",
    "complexity": "Complexity",
    "documentation": "Documentation",
    "completeness": "Completeness",
}
VISION_CAP = 6.0
Result = Optional[Tuple[float, str, List[str]]]


@dataclass
class Criterion:
    id: str
    label: str
    dimension: str
    weight: float
    check: Callable[["Signals"], Result]


class Signals:
    def __init__(self, ctx: Ctx, claims: List[Claim]):
        self.ctx, self.claims, self.d = ctx, claims, ctx.domain_data
        self.f = ctx.findings

    def kind(self, *kinds) -> List[dict]:
        return [f for f in self.f if f["kind"] in kinds]

    def ids(self, *kinds) -> List[str]:
        return [f["id"] for f in self.kind(*kinds)]


def _cap(x: float) -> float:
    return round(max(0.0, min(10.0, x)), 1)


# ── generic criteria ─────────────────────────────────────────────────────────

def claims_supported(s: Signals) -> Result:
    cl = [c for c in s.claims]
    if not cl:
        return None
    v = sum(1 for c in cl if c.status == "verified")
    p = sum(1 for c in cl if c.status == "partially_verified")
    return _cap(10 * (v + 0.5 * p) / len(cl)), f"{v} of {len(cl)} claims verified, {p} partially", [c.id for c in cl if c.status in {"verified", "partially_verified"}]


def no_contradictions(s: Signals) -> Result:
    if not s.claims:
        return None
    bad = [c for c in s.claims if c.status == "contradicted"]
    return _cap(10 - 4 * len(bad)), (f"{len(bad)} claim(s) contradicted by the evidence" if bad else "No claim is contradicted by the evidence"), [c.id for c in bad]


def demo(s: Signals) -> Result:
    v = s.ctx.video
    if not v:
        return None
    segs = v.get("segments", [])
    outputs = sum(1 for g in segs if g.get("outputs"))
    actions = sum(1 for g in segs if g.get("actions"))
    score = 3 + min(4, outputs * 1.5) + min(2, actions * 0.5) + (1 if v.get("challenge_code_found") else 0)
    return min(VISION_CAP, _cap(score)), f"Video shows {outputs} segment(s) with visible outputs and {actions} with actions" + (", verification code found" if v.get("challenge_code_found") else ""), s.ctx.cite("video_seg")[:6]


def feature_claims(s: Signals) -> Result:
    feats = [c for c in s.claims if c.type in {"feature", "result"}]
    if not feats:
        return None
    ok = sum(1 for c in feats if c.status == "verified")
    part = sum(1 for c in feats if c.status == "partially_verified")
    return _cap(10 * (ok + 0.5 * part) / len(feats)), f"{ok} of {len(feats)} functional claims verified, {part} partially", [c.id for c in feats]


def documentation(s: Signals) -> Result:
    docs = s.d.get("documents") or []
    if not docs:
        return None
    words = sum(d.get("words") or 0 for d in docs)
    sections = sum(d.get("sections") or 0 for d in docs)
    score = 2 + min(5, words / 600) + min(3, sections / 3)
    return _cap(score), f"{len(docs)} document(s), about {words} words, {sections} section headings", s.ctx.cite("size", "headings")[:4]


def description(s: Signals) -> Result:
    text = s.ctx.description or ""
    words = len(text.split())
    if words < 15:
        return None
    details = set(re.findall(r"\b\d+(?:\.\d+)?\s?(?:%|cm|mm|m|kg|g|n|nm|v|mv|a|ma|w|kw|hz|khz|mhz|baud|rpm|°c|s|ms|mpa|kn)\b", text, re.I))
    details |= set(re.findall(r"\b[A-Z]{2,}[-]?[A-Z0-9]*\d+[A-Z0-9-]*\b", text))          # part numbers like HC-SR04, ATmega328P
    details |= {c.id for c in s.claims if c.type in {"component", "design", "performance"}}
    score = 2 + min(4, words / 80) + min(4, len(details) * 0.8)
    return _cap(score), f"Description of {words} words with {len(details)} specific technical detail(s) (values, units, part numbers)", []


def finding_penalty(kinds: Tuple[str, ...], label: str, base: float = 10, per: float = 2.5, require: Optional[Callable[[Signals], bool]] = None):
    def check(s: Signals) -> Result:
        if require and not require(s):
            return None
        bad = s.kind(*kinds)
        return _cap(base - per * len(bad)), (f"{len(bad)} {label}" if bad else f"No {label}"), [f["id"] for f in bad]
    return check


def completeness_of(expected: Dict[str, Callable[[Signals], bool]]):
    def check(s: Signals) -> Result:
        have = [k for k, fn in expected.items() if fn(s)]
        missing = [k for k in expected if k not in have]
        return _cap(10 * len(have) / len(expected)), ("Has " + ", ".join(have) if have else "Nothing expected was provided") + (f"; missing {', '.join(missing)}" if missing else ""), []
    return check


def has_video(s: Signals) -> bool:
    return bool(s.ctx.video)


def has_docs(s: Signals) -> bool:
    return bool(s.d.get("documents"))


def scaled(count: float, label: str, k: float = 3.0) -> Result:
    if not count:
        return None
    return _cap(2 + k * math.log2(1 + count)), f"{label} (size heuristic)", []


# ── domain rubrics ───────────────────────────────────────────────────────────

def circuit_documented(s: Signals) -> Result:
    c = s.d.get("counts", {})
    if c.get("exact_circuit"):
        return 9.5, "Exact wiring provided (netlist or Wokwi diagram)", s.ctx.cite("net:", "dpin:")[:6]
    if s.ctx.of_type("kicad_sch"):
        return 6.5, "Schematic provided, but no netlist with exact connections", s.ctx.cite("comp:")[:6]
    if s.ctx.of_type("tinkercad"):
        return 5.0, "Circuit JSON lists components but not exact wiring", s.ctx.cite("tinkercad")
    if s.d.get("photo_components"):
        return 3.0, "Components only read from photos (medium confidence)", s.ctx.cite("photo_comp")[:6]
    return None


def code_matches_circuit(s: Signals) -> Result:
    c = s.d.get("counts", {})
    ok, bad = c.get("pins_ok", 0), c.get("pins_mismatch", 0)
    if not c.get("code_files") or not c.get("exact_circuit") or not (ok + bad):
        return None
    return _cap(10 * ok / (ok + bad)), f"{ok} pin(s) match the circuit, {bad} mismatch", s.ids("pin_match", "pin_mismatch")


def power_design(s: Signals) -> Result:
    if s.d.get("power"):
        return 8.0, "Power supply / rails identified: " + ", ".join(s.d["power"][:4]), s.ids("power")
    if s.kind("power"):
        return 3.0, "No power source found in the circuit files", s.ids("power")
    return None


def tests_present(s: Signals) -> Result:
    sw = s.d.get("software", s.d)
    if not sw.get("source_files") and not sw.get("github"):
        return None
    t = sw.get("tests", 0) or ((sw.get("github") or {}).get("has_tests") and 1)
    return (8.5 if t else 3.0), ("Automated tests found" if t else "No automated tests found"), s.ids("no_tests")


def code_present(s: Signals) -> Result:
    sw = s.d.get("software", s.d)
    lines = sw.get("source_lines", 0)
    gh = sw.get("github") or {}
    if not lines and not gh.get("ok"):
        return None
    base = 3 + min(4, math.log2(1 + lines / 50)) if lines else 5
    base += 1 if gh.get("has_readme") else 0
    base += 1 if sw.get("ci") else 0
    return _cap(base - 0.3 * min(10, sw.get("todo", 0))), f"{sw.get('source_files', 0)} source file(s), {lines} lines" + (", GitHub repository linked" if gh.get("ok") else ""), s.ctx.cite("imports", "gh:repo")[:4]


def ownership(s: Signals) -> Result:
    f = s.kind("gh_owner", "gh_fork")
    if not f:
        return None
    ok = any(x["severity"] == "ok" for x in f)
    return (9.0 if ok else 4.0), f[0]["text"], [x["id"] for x in f]


def eval_validity(s: Signals) -> Result:
    if not s.ctx.of_type("notebook"):
        return None
    risks = s.kind("ml_risk", "dup_rows")
    return _cap(10 - 2.5 * len(risks)), (f"{len(risks)} evaluation risk(s) found" if risks else "No evaluation or leakage risks detected by the checks"), [x["id"] for x in risks]


def metric_support(s: Signals) -> Result:
    checks = s.d.get("metric_checks") or []
    if not checks:
        return None
    good = sum(1 for c in checks if c["status"] in {"match", "higher"})
    return _cap(10 * good / len(checks)), f"{good} of {len(checks)} claimed metrics are backed by notebook outputs", s.ids("metric_match", "metric_mismatch")


def data_quality(s: Signals) -> Result:
    ds = s.d.get("datasets") or []
    if not ds:
        return None
    worst = max((d.get("missing_pct") or 0) for d in ds)
    dups = sum(d.get("duplicates") or 0 for d in ds)
    return _cap(9 - worst / 10 - (2 if dups else 0)), f"Dataset(s): up to {worst}% missing values, {dups} duplicate rows", s.ctx.cite("quality")[:3]


def model_present(s: Signals) -> Result:
    if not s.ctx.of_type("cad", "mesh"):
        return None
    parts = len(s.d.get("parts") or [])
    meshes = s.d.get("meshes") or []
    open_mesh = any(m.get("triangles") and not m.get("watertight") for m in meshes)
    score = 6 + min(3, parts / 3) - (2 if open_mesh else 0)
    return _cap(score), f"3D model with {parts} named part(s)" + ("; mesh not closed" if open_mesh else ""), s.ctx.cite("model", "mesh", "parts")[:4]


def drawings(s: Signals) -> Result:
    dims = s.d.get("dimensions") or []
    if not s.ctx.of_type("drawing"):
        return None
    return _cap(4 + min(6, len(dims) / 2)), f"Drawing(s) with {len(dims)} dimension(s)", s.ctx.cite("dimensions", "annotations")[:4]


def motion_demo(s: Signals) -> Result:
    v = s.ctx.video
    if not v:
        return None
    moving = sum(1 for g in v.get("segments", []) if g.get("actions"))
    return min(VISION_CAP, _cap(3 + moving * 1.5)), f"{moving} video segment(s) show movement/actions", s.ctx.cite("video_seg")[:4]


def bim_plans(s: Signals) -> Result:
    el = s.d.get("elements") or {}
    if not el and not s.ctx.of_type("drawing"):
        return None
    return _cap(4 + min(6, len(el) * 1.2)), f"{sum(el.values())} BIM element(s) of {len(el)} type(s)" if el else "Drawings provided", s.ctx.cite("elements", "entities")[:4]


def calculations(s: Signals) -> Result:
    if not has_docs(s):
        return None
    return (8.0, "Structural calculations found in the documents", []) if s.d.get("has_calculations") else (2.0, "No structural calculations in the documents", s.ids("no_calcs"))


def comms(s: Signals) -> Result:
    c = s.d.get("comms") or []
    if not s.ctx.of_type("arduino"):
        return None
    return (8.0 if c else 4.0), ("Communication in firmware: " + ", ".join(c)) if c else "No communication found in firmware", s.ctx.cite("comms", "mqtt")[:3]


GENERIC = [
    Criterion("claims_supported", "Claims backed by evidence", "evidence_consistency", 2.0, claims_supported),
    Criterion("no_contradictions", "No contradicted claims", "evidence_consistency", 1.5, no_contradictions),
    Criterion("demo", "Demo video shows it working", "functionality", 1.5, demo),
    Criterion("feature_claims", "Functional claims verified", "functionality", 1.5, feature_claims),
    Criterion("documentation", "Report / documentation", "documentation", 1.0, documentation),
    Criterion("description", "Clear technical description", "technical_understanding", 1.0, description),
]

E = lambda *types: (lambda s: bool(s.ctx.of_type(*types)))  # noqa: E731

DOMAIN_RUBRICS: Dict[str, List[Criterion]] = {
    "electronics": [
        Criterion("circuit_documented", "Circuit documented exactly", "implementation_quality", 2.0, circuit_documented),
        Criterion("code_matches_circuit", "Firmware pins match the circuit", "implementation_quality", 2.0, code_matches_circuit),
        Criterion("power_design", "Power design shown", "technical_understanding", 1.0, power_design),
        Criterion("components", "Components and libraries", "complexity", 1.0, lambda s: scaled(len(s.d.get("components") or []) + len(s.d.get("libraries") or []), f"{len(s.d.get('components') or [])} components, {len(s.d.get('libraries') or [])} libraries")),
        Criterion("completeness", "Expected evidence provided", "completeness", 1.5, completeness_of({"circuit file": E("kicad_net", "kicad_sch", "wokwi", "tinkercad"), "firmware": E("arduino"), "report": has_docs, "demo video": has_video})),
    ],
    "software": [
        Criterion("code", "Source code quality signals", "implementation_quality", 2.0, code_present),
        Criterion("tests", "Automated tests", "implementation_quality", 1.5, tests_present),
        Criterion("unfinished", "No unfinished code markers", "implementation_quality", 1.0, finding_penalty(("todo", "empty_functions"), "unfinished-code findings", require=lambda s: bool(s.ctx.of_type("source")))),
        Criterion("ownership", "Repository authorship", "evidence_consistency", 1.5, ownership),
        Criterion("stack", "Technology stack", "complexity", 1.0, lambda s: scaled(len(s.d.get("stack") or []) + len(s.d.get("routes") or []), f"{len(s.d.get('stack') or [])} dependencies, {len(s.d.get('routes') or [])} API routes")),
        Criterion("completeness", "Expected evidence provided", "completeness", 1.5, completeness_of({"code or GitHub": lambda s: bool(s.ctx.of_type("source") or (s.d.get("github") or {}).get("ok")), "README/report": has_docs, "tests": lambda s: bool(s.d.get("tests")), "demo video": has_video})),
    ],
    "ai_ml": [
        Criterion("eval_validity", "Evaluation validity / leakage checks", "implementation_quality", 2.0, eval_validity),
        Criterion("metric_support", "Claimed metrics backed by outputs", "evidence_consistency", 2.0, metric_support),
        Criterion("data_quality", "Dataset quality", "technical_understanding", 1.5, data_quality),
        Criterion("models", "Models and pipeline", "complexity", 1.0, lambda s: scaled(len(s.d.get("models") or []) + len(s.d.get("stack") or []) / 3, f"{len(s.d.get('models') or [])} model type(s)")),
        Criterion("completeness", "Expected evidence provided", "completeness", 1.5, completeness_of({"notebook/code": E("notebook", "source"), "dataset sample": E("dataset"), "report": has_docs, "demo video": has_video})),
    ],
    "mechanical": [
        Criterion("model", "3D model provided", "implementation_quality", 2.0, model_present),
        Criterion("drawings", "Dimensioned drawings", "documentation", 1.5, drawings),
        Criterion("motion", "Mechanism shown moving", "functionality", 1.5, motion_demo),
        Criterion("parts", "Assembly size", "complexity", 1.0, lambda s: scaled(len(s.d.get("parts") or []) + (s.d.get("solids") or 0), f"{len(s.d.get('parts') or [])} parts, {s.d.get('solids') or 0} solids")),
        Criterion("completeness", "Expected evidence provided", "completeness", 1.5, completeness_of({"3D model": E("cad", "mesh"), "drawing": E("drawing"), "report": has_docs, "demo video": has_video})),
    ],
    "civil": [
        Criterion("plans", "Plans / BIM model", "implementation_quality", 2.0, bim_plans),
        Criterion("calculations", "Structural calculations", "technical_understanding", 1.5, calculations),
        Criterion("drawings", "Dimensioned drawings", "documentation", 1.5, drawings),
        Criterion("elements", "Structure size", "complexity", 1.0, lambda s: scaled(sum((s.d.get("elements") or {}).values()), f"{sum((s.d.get('elements') or {}).values())} structural elements")),
        Criterion("completeness", "Expected evidence provided", "completeness", 1.5, completeness_of({"plans/BIM": E("bim", "drawing"), "calculations": lambda s: bool(s.d.get("has_calculations")), "report": has_docs, "site/demo video": has_video})),
    ],
    "robotics_iot": [
        Criterion("circuit_documented", "Circuit documented exactly", "implementation_quality", 1.5, circuit_documented),
        Criterion("code_matches_circuit", "Firmware pins match the circuit", "implementation_quality", 2.0, code_matches_circuit),
        Criterion("comms", "Communication / control link", "technical_understanding", 1.0, comms),
        Criterion("power_design", "Power design shown", "technical_understanding", 1.0, power_design),
        Criterion("components", "System size", "complexity", 1.0, lambda s: scaled(len(s.d.get("components") or []) + len(s.d.get("libraries") or []), f"{len(s.d.get('components') or [])} components, {len(s.d.get('libraries') or [])} libraries")),
        Criterion("completeness", "Expected evidence provided", "completeness", 1.5, completeness_of({"circuit file": E("kicad_net", "kicad_sch", "wokwi", "tinkercad"), "firmware": E("arduino"), "report": has_docs, "demo video": has_video})),
    ],
    "other": [
        Criterion("completeness", "Expected evidence provided", "completeness", 1.5, completeness_of({"report": has_docs, "files": lambda s: bool(s.ctx.files), "demo video": has_video})),
    ],
}


def rubric_for(domain: str) -> List[Criterion]:
    return DOMAIN_RUBRICS.get(domain, DOMAIN_RUBRICS["other"]) + GENERIC


def score(ctx: Ctx, claims: List[Claim]) -> dict:
    s = Signals(ctx, claims)
    criteria, dims = [], {k: {"num": 0.0, "w": 0.0, "total_w": 0.0, "reasons": [], "evidence_ids": []} for k in DIMENSIONS}
    for c in rubric_for(ctx.domain):
        res = c.check(s)
        d = dims[c.dimension]
        d["total_w"] += c.weight
        if res is None:
            criteria.append({"id": c.id, "label": c.label, "dimension": c.dimension, "weight": c.weight, "score": None,
                             "status": "insufficient_evidence", "reason": "Not enough evidence to judge this", "evidence_ids": []})
            continue
        val, reason, ids = res
        criteria.append({"id": c.id, "label": c.label, "dimension": c.dimension, "weight": c.weight, "score": val,
                         "status": "scored", "reason": reason, "evidence_ids": ids})
        d["num"] += val * c.weight
        d["w"] += c.weight
        d["reasons"].append(f"{c.label}: {reason}")
        d["evidence_ids"] += ids
    out_dims, num, w, total = {}, 0.0, 0.0, 0.0
    for k, d in dims.items():
        if d["total_w"] == 0:
            continue
        total += d["total_w"]
        if d["w"] == 0:
            out_dims[k] = {"label": DIMENSIONS[k], "score": None, "status": "insufficient_evidence", "reason": "Not enough evidence", "evidence_ids": []}
            continue
        val = round(d["num"] / d["w"], 1)
        out_dims[k] = {"label": DIMENSIONS[k], "score": val, "status": "scored", "reason": "; ".join(d["reasons"]), "evidence_ids": list(dict.fromkeys(d["evidence_ids"]))[:10]}
        num += val * d["w"]
        w += d["w"]
    overall = round(num / w * 10) if w else None
    coverage = round(100 * w / total) if total else 0
    return {"overall": overall, "coverage": coverage, "dimensions": out_dims, "criteria": criteria,
            "note": "Scores only count evidence that was found. 'Not enough evidence' is not a fail — add the missing files to improve coverage."}
