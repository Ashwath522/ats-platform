"""Electronics: component table, pin cross-check between firmware and circuit, power."""
from __future__ import annotations

from ..context import Ctx

EXACT = {"kicad_net": "KiCad netlist", "wokwi": "Wokwi diagram", "kicad_sch": "KiCad schematic"}


def _pin_key(p: str):
    return (p[0], int(p[1:]) if p[1:].isdigit() else 0)


def analyse(ctx: Ctx) -> dict:
    comps, seen = [], set()
    for b in ctx.of_type("kicad_net", "wokwi", "kicad_sch", "tinkercad"):
        src = EXACT.get(b["type"], "TinkerCAD/circuit JSON")
        for c in b.get("components", []):
            k = (c.get("ref"), c.get("value"))
            if k in seen:
                continue
            seen.add(k)
            comps.append({"ref": c.get("ref"), "value": c.get("value") or c.get("lib_id") or "", "source": src,
                          "exact": b["type"] != "tinkercad", "evidence_ids": ctx.cite(f"comp:{c.get('ref')}") or ctx.cite("tinkercad")})
    code = ctx.of_type("arduino")
    libs = []
    for b in code:
        for inc in b.get("includes", []):
            ids = ctx.cite(f"lib:{inc}")
            if ids:
                libs.append({"library": inc, "file": b["file"], "evidence_ids": ids})
    photo_parts = ctx.domain_data.get("photo_components", [])

    # ── pin cross-check ──
    wired = {}
    for b in ctx.of_type("kicad_net", "wokwi"):
        for p in b.get("pins", []):
            wired.setdefault(p, []).append(b["type"])
    labelled = {p for b in ctx.of_type("kicad_sch") for p in b.get("pins", [])}
    used = {}
    for b in code:
        for p in b.get("pins", []):
            used.setdefault(p["pin"], {"uses": set(), "file": b["file"]})["uses"].update(p["uses"])
    has_wiring = bool(ctx.of_type("kicad_net", "wokwi"))
    pin_map = []
    for pin in sorted(set(used) | set(wired) | labelled, key=_pin_key):
        code_ids = ctx.cite(f"pin:{pin}")
        diag_ids = ctx.cite(f"dpin:{pin}") or [i for n in ctx.keys if n.startswith("net:") and n.upper().endswith(pin) for i in ctx.keys[n]]
        row = {"pin": pin, "code": ", ".join(sorted(used[pin]["uses"])) if pin in used else "", "circuit": "connected" if pin in wired else ("labelled" if pin in labelled else "")}
        if pin in used and pin in wired:
            row["status"] = "ok"
        elif pin in used and has_wiring:
            row["status"] = "mismatch"
            ctx.finding(f"Code uses pin {pin} ({row['code']}) but the circuit file has nothing connected to {pin}.", severity="issue", kind="pin_mismatch", cites=code_ids)
        elif pin in used:
            row["status"] = "unchecked"
        elif pin in wired and code:
            row["status"] = "unused"
            ctx.finding(f"The circuit connects pin {pin}, but the code never uses it.", severity="warn", kind="pin_unused", cites=diag_ids)
        else:
            row["status"] = "circuit_only"
        row["evidence_ids"] = code_ids + diag_ids
        pin_map.append(row)
    ok = sum(1 for r in pin_map if r["status"] == "ok")
    if ok:
        ctx.finding(f"{ok} pin(s) used in code match connections in the circuit file.", severity="ok", kind="pin_match",
                    cites=[i for r in pin_map if r["status"] == "ok" for i in r["evidence_ids"]])
    if code and not has_wiring:
        ctx.finding("No netlist or Wokwi diagram was uploaded, so code pins could not be checked against real wiring.", severity="missing", kind="no_wiring")

    power = sorted({p for b in ctx.of_type("kicad_net", "kicad_sch", "wokwi") for p in b.get("power", [])})
    if power:
        ctx.finding(f"Power design found: {', '.join(power)}.", severity="ok", kind="power", cites=ctx.cite("power"))
    elif ctx.of_type("kicad_net", "kicad_sch", "wokwi", "tinkercad"):
        ctx.finding("No power source or supply rail was found in the circuit files.", severity="missing", kind="power")
    if not ctx.of_type("kicad_net", "kicad_sch", "wokwi", "tinkercad") and not photo_parts:
        ctx.finding("No circuit file was uploaded — components could not be identified exactly.", severity="missing", kind="no_circuit")
    if not code:
        ctx.finding("No firmware/code file was uploaded.", severity="missing", kind="no_code")
    for b in code:
        if not (b.get("setup") and b.get("loop")) and b["file"].endswith(".ino"):
            ctx.finding(f"{b['file']} is missing setup() or loop().", severity="issue", kind="sketch_structure", cites=[])
    return {"components": comps, "libraries": libs, "pin_map": pin_map, "power": power,
            "comms": sorted({c for b in code for c in b.get("comms", [])}), "photo_components": photo_parts,
            "counts": {"components": len(comps), "pins_ok": ok, "pins_mismatch": sum(1 for r in pin_map if r["status"] == "mismatch"),
                       "code_files": len(code), "exact_circuit": has_wiring}}
