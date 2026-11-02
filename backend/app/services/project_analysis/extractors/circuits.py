"""Circuit files: KiCad (.kicad_sch, .net, .kicad_pcb), Wokwi diagram.json, TinkerCAD JSON.

Connections are only reported when the file states them explicitly (netlist
nets, Wokwi connections). Wires are never inferred from schematic geometry.
"""
from __future__ import annotations

import json
import re
from typing import Any, List

from .base import Extracted, clip

# ── tiny S-expression reader ─────────────────────────────────────────────────
_TOKEN = re.compile(r'\(|\)|"(?:\\.|[^"\\])*"|[^\s()"]+')


def sexpr(text: str) -> list:
    stack: List[list] = [[]]
    for tok in _TOKEN.findall(text):
        if tok == "(":
            stack.append([])
        elif tok == ")":
            if len(stack) > 1:
                done = stack.pop()
                stack[-1].append(done)
        else:
            stack[-1].append(tok[1:-1].replace('\\"', '"') if tok.startswith('"') else tok)
    while len(stack) > 1:                         # tolerate truncated files
        done = stack.pop()
        stack[-1].append(done)
    return stack[0]


def _walk(node, head: str):
    if isinstance(node, list):
        if node and node[0] == head:
            yield node
        for child in node:
            if isinstance(child, list):
                yield from _walk(child, head)


def _field(node: list, name: str):
    for c in node[1:]:
        if isinstance(c, list) and c and c[0] == name and len(c) > 1:
            return c[1]
    return None


def _props(node: list) -> dict:
    return {c[1]: c[2] for c in node[1:] if isinstance(c, list) and len(c) > 2 and c[0] == "property"}


ARDUINO_PIN = re.compile(r"^/?(?:Net-\()?.*?\b(D\d{1,2}|A\d{1,2}|GPIO\d{1,2}|IO\d{1,2})\)?$", re.I)


def _pin_from_label(label: str):
    m = re.fullmatch(r"/?(D|A|GPIO|IO)(\d{1,2})", (label or "").strip(), re.I)
    if not m:
        return None
    kind = m.group(1).upper()
    return f"A{int(m.group(2))}" if kind == "A" else f"D{int(m.group(2))}"


def parse_kicad_sch(name: str, text: str) -> Extracted:
    ex = Extracted(kind="kicad_sch")
    tree = sexpr(text)
    comps, power = [], []
    for sym in _walk(tree, "symbol"):
        lib_id = _field(sym, "lib_id")
        if not lib_id:
            continue                              # library definitions, not placed parts
        p = _props(sym)
        ref, value = p.get("Reference", "?"), p.get("Value", "")
        if lib_id.lower().startswith("power:") or ref.startswith("#"):
            power.append(value or lib_id.split(":")[-1])
            continue
        comps.append({"ref": ref, "value": value, "lib_id": lib_id, "footprint": p.get("Footprint", "")})
    labels = sorted({n[1] for h in ("label", "global_label", "hierarchical_label") for n in _walk(tree, h) if len(n) > 1 and isinstance(n[1], str)})
    for c in comps:
        ex.add(f"Schematic part {c['ref']}: {c['value'] or c['lib_id']} ({c['lib_id']})", locator={"file": name, "ref": c["ref"]}, key=f"comp:{c['ref']}")
    if power:
        ex.add(f"Power symbols in schematic: {clip(sorted(set(power)))}", locator={"file": name}, key="power")
    if labels:
        ex.add(f"Net labels in schematic: {clip(labels, 20)}", locator={"file": name}, key="labels")
    ex.warnings.append(f"{name}: connections are not derived from schematic drawings — export a netlist (.net) for exact wiring.")
    ex.data = {"type": "kicad_sch", "file": name, "components": comps, "power": sorted(set(power)), "labels": labels,
               "pins": sorted({p for p in (_pin_from_label(l) for l in labels) if p})}
    return ex


def parse_kicad_net(name: str, text: str) -> Extracted:
    ex = Extracted(kind="kicad_net")
    tree = sexpr(text)
    comps = []
    for comp in _walk(tree, "comp"):
        ref, value = _field(comp, "ref"), _field(comp, "value")
        if ref:
            comps.append({"ref": ref, "value": value or "", "footprint": _field(comp, "footprint") or ""})
    nets = []
    for net in _walk(tree, "net"):
        nm = _field(net, "name")
        nodes = [f"{_field(n, 'ref')}:{_field(n, 'pin')}" + (f"({_field(n, 'pinfunction')})" if _field(n, "pinfunction") else "")
                 for n in _walk(net, "node")]
        if nm is not None and nodes:
            nets.append({"name": nm, "nodes": nodes})
    for c in comps:
        ex.add(f"Netlist part {c['ref']}: {c['value']}", locator={"file": name, "ref": c["ref"]}, key=f"comp:{c['ref']}")
    for n in nets[:200]:
        ex.add(f"Net '{n['name']}' connects {clip(n['nodes'], 8)}", locator={"file": name, "net": n["name"]}, key=f"net:{n['name']}")
    pins = set()
    for n in nets:
        p = _pin_from_label(n["name"].split("/")[-1])
        if p:
            pins.add(p)
        for node in n["nodes"]:
            m = re.search(r"\((D\d{1,2}|A\d{1,2}|GPIO\d{1,2}|IO\d{1,2})[^)]*\)", node)
            if m:
                pins.add(_pin_from_label(m.group(1)) or m.group(1))
    power = sorted({n["name"].strip("/") for n in nets if re.fullmatch(r"/?(\+?\d+V\d*|VCC|VDD|GND|VIN|\+?3V3|\+?5V|VBAT)", n["name"], re.I)})
    ex.data = {"type": "kicad_net", "file": name, "components": comps, "nets": nets, "pins": sorted(pins), "power": power}
    return ex


def parse_kicad_pcb(name: str, text: str) -> Extracted:
    ex = Extracted(kind="kicad_pcb")
    tree = sexpr(text)
    fps = list(_walk(tree, "footprint")) or list(_walk(tree, "module"))
    layers = [l for l in _walk(tree, "layers")][:1]
    copper = sum(1 for l in (layers[0][1:] if layers else []) if isinstance(l, list) and len(l) > 1 and str(l[1]).endswith(".Cu"))
    ex.add(f"PCB layout {name}: {len(fps)} footprints, {copper or 'unknown'} copper layers", locator={"file": name})
    ex.data = {"type": "kicad_pcb", "file": name, "footprints": len(fps), "copper_layers": copper}
    return ex


BOARD_PARTS = ("arduino", "uno", "nano", "mega", "esp32", "esp8266", "pico", "board", "stm32", "attiny")


def parse_wokwi(name: str, obj: dict) -> Extracted:
    ex = Extracted(kind="wokwi")
    parts = [{"id": p.get("id"), "type": p.get("type", ""), "attrs": p.get("attrs", {})} for p in obj.get("parts", []) if isinstance(p, dict)]
    conns = []
    for c in obj.get("connections", []):
        if isinstance(c, list) and len(c) >= 2 and isinstance(c[0], str) and isinstance(c[1], str):
            conns.append((c[0], c[1]))
    board_ids = {p["id"] for p in parts if any(b in (p["type"] or "").lower() for b in BOARD_PARTS)}
    type_of = {p["id"]: p["type"].replace("wokwi-", "").replace("board-", "") for p in parts}
    pins = {}
    for a, b in conns:
        for x, y in ((a, b), (b, a)):
            pid, _, pin = x.partition(":")
            if pid in board_ids:
                norm = _pin_from_label(pin) or (f"D{int(pin)}" if pin.isdigit() else None)
                if norm:
                    other = y.partition(":")[0]
                    pins.setdefault(norm, set()).add(type_of.get(other, other))
    for p in parts:
        attrs = {k: v for k, v in (p["attrs"] or {}).items() if k in {"value", "resistance", "color", "temperature", "distance"}}
        ex.add(f"Wokwi part {p['id']}: {type_of.get(p['id'])}" + (f" {attrs}" if attrs else ""), locator={"file": name, "part": p["id"]}, key=f"comp:{p['id']}")
    for pin, others in sorted(pins.items()):
        ex.add(f"Wokwi diagram connects board pin {pin} to {', '.join(sorted(others))}", locator={"file": name, "pin": pin}, key=f"dpin:{pin}")
    if conns and not pins:
        ex.add(f"Wokwi diagram has {len(conns)} connections", locator={"file": name})
    ex.data = {"type": "wokwi", "file": name, "components": [{"ref": p["id"], "value": type_of.get(p["id"]), "lib_id": p["type"]} for p in parts],
               "connections": conns, "pins": sorted(pins), "pin_targets": {k: sorted(v) for k, v in pins.items()},
               "power": ["board power"] if board_ids else []}
    return ex


def parse_tinkercad(name: str, obj: Any) -> Extracted:
    ex = Extracted(kind="tinkercad")
    names: List[str] = []

    def collect(node, depth=0):
        if depth > 8:
            return
        if isinstance(node, dict):
            for k in ("componentName", "component", "type", "name", "partName"):
                v = node.get(k)
                if isinstance(v, str) and 1 < len(v) <= 60:
                    names.append(v)
                    break
            for v in node.values():
                collect(v, depth + 1)
        elif isinstance(node, list):
            for v in node[:2000]:
                collect(v, depth + 1)

    collect(obj)
    uniq = list(dict.fromkeys(names))
    if uniq:
        ex.add(f"Circuit JSON {name} lists components: {clip(uniq, 20)}", locator={"file": name}, confidence="medium", key="tinkercad")
    else:
        ex.warnings.append(f"{name}: no components could be read from this JSON file.")
    ex.data = {"type": "tinkercad", "file": name, "components": [{"ref": n, "value": n} for n in uniq], "pins": [], "power": []}
    return ex


def parse_json(name: str, text: str) -> Extracted:
    try:
        obj = json.loads(text)
    except Exception:
        ex = Extracted(kind="json")
        ex.warnings.append(f"{name}: not valid JSON.")
        return ex
    if isinstance(obj, dict) and "parts" in obj and "connections" in obj:
        return parse_wokwi(name, obj)
    if isinstance(obj, (dict, list)) and re.search(r"tinkercad|componentName|breadboard", text[:20000], re.I):
        return parse_tinkercad(name, obj)
    ex = Extracted(kind="json")
    keys = list(obj.keys())[:15] if isinstance(obj, dict) else []
    ex.add(f"{name}: JSON {'object with keys ' + clip(keys) if keys else 'array of ' + str(len(obj)) + ' items' if isinstance(obj, list) else 'value'}", locator={"file": name})
    ex.data = {"type": "json", "file": name, "keys": keys}
    return ex
