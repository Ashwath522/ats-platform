"""Builds the single consolidated report (15 sections) from structured results.

Everything here is assembled from evidence, findings, claims and scores — no
free-form AI text — so every statement can be traced to its source.
"""
from __future__ import annotations

import re
from typing import List

from .context import Ctx
from .domains import DOMAIN_MAP
from .schemas import Claim

TITLES = {
    "electronics": {"components": "Components & circuit", "architecture": "Working principle (circuit + firmware)"},
    "robotics_iot": {"components": "Hardware & software components", "architecture": "Sensing → control → actuation"},
    "software": {"components": "Technology stack", "architecture": "Architecture & API"},
    "ai_ml": {"components": "Data, models & tools", "architecture": "Pipeline & evaluation"},
    "mechanical": {"components": "Parts & geometry", "architecture": "Mechanism & assembly"},
    "civil": {"components": "Structural elements & materials", "architecture": "Structural system"},
    "other": {"components": "Tools & materials", "architecture": "How it works"},
}

SUGGEST = {
    "no_wiring": "Export a KiCad netlist (.net) or Wokwi diagram.json so every pin can be checked against the code.",
    "pin_mismatch": "Fix or explain the pins the code drives that are not connected in the circuit.",
    "pin_unused": "Remove unused connections or show in the code what they are for.",
    "power": "Show the power supply (battery, adapter, regulator) in the circuit file.",
    "no_circuit": "Upload the circuit file (KiCad, Wokwi or TinkerCAD export).",
    "no_code": "Upload the source code or link the GitHub repository.",
    "no_tests": "Add a few automated tests for the core logic.",
    "todo": "Finish or remove the TODO/FIXME parts before submitting.",
    "empty_functions": "Implement or remove empty functions.",
    "gh_owner": "Commit from your own GitHub account so authorship is visible.",
    "gh_fork": "Explain what you changed compared with the original repository.",
    "metric_mismatch": "Make the metrics in your description match what the notebook actually prints.",
    "ml_risk": "Split the data before fitting scalers/encoders and evaluate on a held-out test set with a fixed random seed.",
    "dup_rows": "Remove duplicate rows before splitting train and test data.",
    "no_dataset": "Upload a small sample of the dataset (CSV).",
    "no_training_code": "Upload the training notebook with its outputs.",
    "no_model": "Upload the 3D model as STEP or STL.",
    "no_drawing": "Add a dimensioned drawing (DXF or PDF).",
    "no_dims": "Add dimensions to the drawings.",
    "mesh_open": "Repair the mesh so it is a closed solid.",
    "no_calcs": "Include the structural design calculations in the report.",
    "no_plans": "Upload the plans, drawings or BIM model.",
    "challenge_missing": "Record the demo again and say or show the verification code.",
    "no_files": "Upload project files (report, code, drawings).",
}


def _first_sentences(text: str, n: int = 3) -> str:
    sents = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    return " ".join(sents[:n])[:600]


def _components(ctx: Ctx) -> dict:
    d = ctx.domain_data
    if ctx.domain in {"electronics", "robotics_iot"}:
        return {"table": [{"name": c.get("ref"), "value": c.get("value"), "source": c.get("source")} for c in d.get("components", [])[:60]],
                "libraries": [l["library"] for l in d.get("libraries", [])], "from_photos": [p["label"] for p in d.get("photo_components", [])][:20]}
    if ctx.domain in {"software", "ai_ml"}:
        return {"stack": d.get("stack", [])[:40], "models": d.get("models", []), "datasets": d.get("datasets", [])}
    if ctx.domain == "mechanical":
        return {"parts": d.get("parts", [])[:60], "meshes": d.get("meshes", []), "dimensions": d.get("dimensions", [])[:30]}
    if ctx.domain == "civil":
        return {"elements": d.get("elements", {}), "storeys": d.get("storeys", []), "materials": d.get("materials", [])}
    return {"documents": d.get("documents", [])}


def _architecture(ctx: Ctx) -> List[str]:
    d, out = ctx.domain_data, []
    if ctx.domain in {"electronics", "robotics_iot"}:
        pins = d.get("pin_map", [])
        ins = [r["pin"] for r in pins if any(k in r.get("code", "") for k in ("input", "sensor", "interrupt"))]
        outs = [r["pin"] for r in pins if any(k in r.get("code", "") for k in ("output", "PWM", "servo"))]
        if ins or outs:
            out.append(f"Firmware reads {', '.join(ins) or 'no pins'} and drives {', '.join(outs) or 'no pins'}.")
        if d.get("comms"):
            out.append("It communicates via " + ", ".join(d["comms"]) + ".")
        if d.get("mqtt_topics"):
            out.append("MQTT topics: " + ", ".join(list(d["mqtt_topics"])[:8]) + ".")
    elif ctx.domain in {"software", "ai_ml"}:
        if d.get("routes"):
            out.append(f"{len(d['routes'])} API route(s), e.g. " + ", ".join(d["routes"][:6]) + ".")
        if d.get("models"):
            out.append("Models built: " + ", ".join(d["models"][:6]) + ".")
        for c in d.get("metric_checks", []):
            out.append(f"Claimed {c['metric']} {c['claimed']:g}% → found {c['found']:g}%" if c.get("found") is not None else f"Claimed {c['metric']} {c['claimed']:g}% → not found in outputs")
    elif ctx.domain == "mechanical":
        if d.get("assembly_links"):
            out.append(f"Assembly with {d['assembly_links']} part placement(s) and {d.get('solids', 0)} solid bodies.")
        out.append("Movement is judged only from the demo video.")
    elif ctx.domain == "civil":
        if d.get("storeys"):
            out.append(f"{len(d['storeys'])} storey(s): " + ", ".join(d["storeys"][:6]) + ".")
        out.append("Load paths and safety are not computed by CoreLink.")
    return out or ["Not enough evidence to describe the working principle."]


def _video_vs_files(ctx: Ctx, claims: List[Claim]) -> List[str]:
    if not ctx.video:
        return ["No demo video — practical functionality is unverified."]
    seen = " ".join(" ".join(s.get("visible", [])) for s in ctx.video.get("segments", [])).lower()
    names = [str(c.get("value") or "") for c in ctx.domain_data.get("components", [])] + list(ctx.domain_data.get("parts", []))
    shown = [n for n in names if len(n) > 3 and n.lower() in seen]
    out = []
    if names:
        out.append(f"{len(shown)} of {len(names)} parts named in the files also appear in the video" + (": " + ", ".join(shown[:8]) if shown else "."))
    ev = {e.id: e for e in ctx.evidence}
    both = [c for c in claims if {ev[i].source_type for i in c.evidence_ids if i in ev} >= {"video", "file"}]
    out.append(f"{len(both)} claim(s) are supported by both files and video.")
    if not ctx.video.get("challenge_code_found") and ctx.challenge_code:
        out.append("The verification code was not found in the video.")
    return out


def build(ctx: Ctx, claims: List[Claim], scores: dict) -> dict:
    dom = DOMAIN_MAP.get(ctx.domain, DOMAIN_MAP["other"])
    t = TITLES.get(ctx.domain, TITLES["other"])
    verified = [c for c in claims if c.status == "verified"]
    rest = [c for c in claims if c.status != "verified"]
    good = [f for f in ctx.findings if f["severity"] == "ok"] + [
        {"text": f"{c['label']}: {c['reason']}", "id": None} for c in scores.get("criteria", []) if (c.get("score") or 0) >= 7.5]
    bad = [f for f in ctx.findings if f["severity"] in {"issue", "warn", "missing"}]
    suggestions = list(dict.fromkeys(SUGGEST[f["kind"]] for f in ctx.findings if f["kind"] in SUGGEST and f["severity"] != "ok"))
    if not ctx.video:
        suggestions.append("Add a short demo video (YouTube, Unlisted) that shows inputs and outputs, and say your verification code in it.")
    ov, cov = scores.get("overall"), scores.get("coverage", 0)
    if ov is None:
        verdict = "There is not enough evidence to score this project yet."
    else:
        level = "strong" if ov >= 75 else "solid" if ov >= 55 else "early-stage" if ov >= 35 else "weakly evidenced"
        verdict = (f"Overall this is a {level} {dom.label.lower()} project: {ov}/100 based on {cov}% of the rubric that had evidence. "
                   f"{len(verified)} of {len(claims)} claims are verified by evidence.")
    sections = [
        {"id": "overview", "title": "Project overview", "text": f"{ctx.title} — {dom.label}. {len(ctx.files)} file(s) analysed; demo video: {'yes' if ctx.video else 'no'}.",
         "data": {"score": ov, "coverage": cov}},
        {"id": "objectives", "title": "Problem statement & objectives", "text": _first_sentences(ctx.description) or "The student did not describe the problem."},
        {"id": "understanding", "title": "Technical understanding", "text": (scores["dimensions"].get("technical_understanding") or {}).get("reason") or "Not enough evidence."},
        {"id": "components", "title": t["components"], "data": _components(ctx)},
        {"id": "implementation", "title": "Implementation analysis", "items": [{"text": f["text"], "severity": f["severity"], "evidence_id": f["id"]} for f in ctx.findings]},
        {"id": "architecture", "title": t["architecture"], "items": [{"text": x} for x in _architecture(ctx)], "data": {"pin_map": ctx.domain_data.get("pin_map")} if ctx.domain_data.get("pin_map") else None},
        {"id": "video", "title": "Video demonstration analysis", "data": ctx.video, "text": None if ctx.video else "No demo video was analysed."},
        {"id": "comparison", "title": "File and video evidence comparison", "items": [{"text": x} for x in _video_vs_files(ctx, claims)]},
        {"id": "verified", "title": "Verified functionality", "claims": [c.id for c in verified]},
        {"id": "unverified", "title": "Partially verified, unverified or contradicted", "claims": [c.id for c in rest]},
        {"id": "strengths", "title": "Technical strengths", "items": [{"text": g["text"], "evidence_id": g.get("id")} for g in good][:12] or [{"text": "No clear strengths could be confirmed from the evidence."}]},
        {"id": "weaknesses", "title": "Weaknesses & missing work", "items": [{"text": f["text"], "severity": f["severity"], "evidence_id": f["id"]} for f in bad][:15] or [{"text": "No weaknesses were detected by the checks."}]},
        {"id": "suggestions", "title": "Improvement suggestions", "items": [{"text": s} for s in suggestions[:10]] or [{"text": "Keep the evidence up to date as the project changes."}]},
        {"id": "assessment", "title": "Overall assessment", "text": verdict + " 'Verified' means the uploaded evidence agrees with the claim — not that CoreLink tested the project. A CoreLink reviewer makes the final verification decision."},
        {"id": "evidence", "title": "Evidence references & confidence", "evidence": True},
    ]
    return {"sections": sections, "domain_label": dom.label}
