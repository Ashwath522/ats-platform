"""Evidence-only electronics checks; no code is executed."""
import json, os, re
from ..schemas import Evidence

def _ev(i, fact, ref, confidence="high"):
    return Evidence(id=f"el_{i}", source_type="analysis", source_ref=ref, fact=fact[:500], method="rule", confidence=confidence)

def analyse_electronics(project, files, evidence):
    components=[]; pins=[]; findings=[]; code_pins=set(); connected=set(); power=[]; idx=0
    for e in evidence:
        fact=e.fact
        if e.source_type=="file" and any(x in fact.lower() for x in ("arduino", "include", "pinmode", "digitalwrite", "analogread")):
            code_pins.update(re.findall(r"(?:D|A)?\d+", fact))
        if any(x in fact.lower() for x in ("vcc", "5v", "3v3", "gnd", "power")): power.append(e.id)
        m=re.search(r"\b([RUCDJQ]\d+)\s+(?:is|value ['\"]?)([^.'\"]+)",fact,re.I)
        if m: components.append({"name":m.group(1),"value":m.group(2).strip(),"source":"exact file","evidence_ids":[e.id]})
        if "connects" in fact.lower():
            connected.update(re.findall(r"(?:D|A)?\d+",fact))
    for pin in sorted(code_pins):
        if pin not in connected: findings.append(_ev(idx:=idx+1,f"Code drives {pin} but {pin} has no connection in the diagram.","electronics", "medium"))
    for pin in sorted(connected-code_pins): findings.append(_ev(idx:=idx+1,f"Diagram connects {pin} but code never reads or drives {pin}.","electronics", "medium"))
    if not power: findings.append(_ev(idx:=idx+1,"No power source found in files.","electronics","low"))
    return {"components":components,"pin_map":[{"pin":p,"status":"ok" if p in connected else "mismatch"} for p in sorted(code_pins)],"findings":[e.model_dump() for e in findings]}, findings

class ElectronicsAnalyser:
    def analyse(self, project, files, evidence): return [], []
