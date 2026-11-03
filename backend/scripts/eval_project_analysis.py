"""Reproducible accuracy benchmark for the mechanical project-analysis pipeline.

    python scripts/eval_project_analysis.py --n 100 --seed 7 [--ai]

Generates N synthetic parts (random plate size, thickness, bore, hole pattern) as
DXF drawings + STL meshes with known ground truth, then measures:
  1. DXF extraction   – dimension recall, annotation recall
  2. STL extraction   – bounding-box error, volume error, watertight detection
                        (a third of the meshes are deliberately opened)
  3. Claim checking   – each part gets true claims and perturbed (wrong) claims;
                        precision / recall / F1 for flagging the wrong ones.
Without --ai only the deterministic checks run (no keys needed, fully repeatable).
With --ai the full claim pipeline is used (needs GROQ/GEMINI keys; costs API calls).
"""
from __future__ import annotations

import argparse
import io
import json
import os
import random
import struct
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["ATS_DATA_DIR"] = tempfile.mkdtemp(prefix="corelink-eval-")
os.environ["DATABASE_URL"] = ""


def make_part(rng: random.Random):
    W = rng.choice(range(60, 241, 10)); H = rng.choice(range(40, 161, 10)); T = rng.choice([4, 5, 6, 8, 10, 12, 15, 20])
    bore = rng.choice([d for d in (12, 16, 20, 22, 25, 30, 32, 35, 40, 47, 52) if d < min(W, H) - 20])
    hole = rng.choice([5, 6, 8, 10, 12])
    px, py = W - 2 * max(10, hole), H - 2 * max(10, hole)
    return dict(W=W, H=H, T=T, bore=bore, hole=hole, px=px, py=py, material=rng.choice(["AL 6061-T6", "EN8", "SS304", "MS IS2062"]))


def dxf_bytes(p) -> str:
    import ezdxf
    doc = ezdxf.new("R2010", setup=True)
    for n in ("OUTLINE", "CENTER", "DIMENSIONS", "NOTES"):
        doc.layers.add(n)
    msp = doc.modelspace()
    W, H, cx, cy, ox, oy = p["W"], p["H"], p["W"] / 2, p["H"] / 2, (p["W"] - p["px"]) / 2, (p["H"] - p["py"]) / 2
    msp.add_lwpolyline([(0, 0), (W, 0), (W, H), (0, H)], close=True, dxfattribs={"layer": "OUTLINE"})
    msp.add_circle((cx, cy), p["bore"] / 2, dxfattribs={"layer": "OUTLINE"})
    for x, y in [(ox, oy), (W - ox, oy), (ox, H - oy), (W - ox, H - oy)]:
        msp.add_circle((x, y), p["hole"] / 2, dxfattribs={"layer": "OUTLINE"})
    d = dict(dimstyle="EZDXF", dxfattribs={"layer": "DIMENSIONS"})
    msp.add_linear_dim(base=(cx, -12), p1=(0, 0), p2=(W, 0), **d).render()
    msp.add_linear_dim(base=(-12, cy), p1=(0, 0), p2=(0, H), angle=90, **d).render()
    msp.add_linear_dim(base=(cx, -22), p1=(ox, oy), p2=(W - ox, oy), **d).render()
    msp.add_linear_dim(base=(W + 12, cy), p1=(W - ox, oy), p2=(W - ox, H - oy), angle=90, **d).render()
    msp.add_diameter_dim(center=(cx, cy), radius=p["bore"] / 2, angle=45, **d).render()
    msp.add_diameter_dim(center=(W - ox, H - oy), radius=p["hole"] / 2, angle=45, **d).render()
    notes = [f"MATERIAL: {p['material']}", f"THICKNESS {p['T']} mm", f"CENTRAL BORE DIA {p['bore']} H7",
             f"4X HOLE DIA {p['hole']} THRU ON {p['px']} x {p['py']} PATTERN"]
    for i, t in enumerate(notes):
        msp.add_text(t, height=3, dxfattribs={"layer": "NOTES"}).set_placement((0, -40 - 6 * i))
    buf = io.StringIO(); doc.write(buf)
    return buf.getvalue(), notes


def stl_bytes(p, open_mesh: bool) -> bytes:
    W, H, T = p["W"], p["H"], p["T"]
    V = [(0, 0, 0), (W, 0, 0), (W, H, 0), (0, H, 0), (0, 0, T), (W, 0, T), (W, H, T), (0, H, T)]
    F = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    if open_mesh:
        F = F[:-1]                                       # remove one face → hole in the surface
    out = bytearray(b"eval".ljust(80, b" ")) + struct.pack("<I", len(F))
    for a, b, c in F:
        out += struct.pack("<3f", 0, 0, 0) + b"".join(struct.pack("<3f", *V[i]) for i in (a, b, c)) + b"\0\0"
    return bytes(out)


def claims_for(p, rng: random.Random):
    """(text, is_wrong) pairs — wrong ones change one value the drawing states."""
    def other(v, choices):
        return rng.choice([c for c in choices if c != v])
    true = [(f"The central bore is {p['bore']} mm with an H7 fit.", False),
            (f"The plate is {p['T']} mm thick.", False),
            (f"Four {p['hole']} mm through holes are drilled on a {p['px']} x {p['py']} mm pattern.", False)]
    wrong = [(f"The bore was enlarged to {other(p['bore'], (12, 16, 20, 25, 30, 35, 40, 45, 52, 62))} mm for a larger bearing.", True),
             (f"The plate is {other(p['T'], (3, 4, 5, 6, 8, 10, 12, 16, 20, 25))} mm thick.", True),
             (f"Mounting uses four {other(p['hole'], (4, 5, 6, 8, 10, 12, 14))} mm through holes.", True)]
    return true + wrong


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--ai", action="store_true", help="also run the AI claim pipeline (uses API calls)")
    ap.add_argument("--out", default="eval_results.json")
    a = ap.parse_args()
    if a.ai:
        try:
            from dotenv import load_dotenv
            load_dotenv(ROOT / ".env")
        except Exception:
            pass
    else:
        for k in ("GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"):
            os.environ[k] = ""

    from app.db import init_db
    init_db()
    from app.services.project_analysis import claims as cm
    from app.services.project_analysis.context import Ctx
    from app.services.project_analysis.extractors import extract
    from app.services.project_analysis.schemas import Claim

    rng = random.Random(a.seed)
    m = dict(dims_total=0, dims_found=0, notes_total=0, notes_found=0, bbox_err=[], vol_err=[],
             wt=dict(tp=0, tn=0, fp=0, fn=0), cl=dict(tp=0, tn=0, fp=0, fn=0), status=[])
    for i in range(a.n):
        p = make_part(rng)
        dxf, notes = dxf_bytes(p)
        open_mesh = i % 3 == 0
        ex_d = extract("part.dxf", dxf.encode())
        ex_s = extract("part.stl", stl_bytes(p, open_mesh))
        truth_dims = [p["W"], p["H"], p["px"], p["py"], p["bore"], p["hole"]]
        got = list(ex_d.data.get("dimensions", []))
        for v in truth_dims:
            m["dims_total"] += 1
            if any(abs(g - v) < 0.01 for g in got):
                m["dims_found"] += 1
                got.remove(next(g for g in got if abs(g - v) < 0.01))
        ann = " | ".join(ex_d.data.get("annotations", []))
        m["notes_total"] += len(notes)
        m["notes_found"] += sum(1 for n in notes if n in ann)
        bb = ex_s.data.get("bbox") or (0, 0, 0)
        m["bbox_err"].append(max(abs(bb[0] - p["W"]), abs(bb[1] - p["H"]), abs(bb[2] - p["T"])))
        if not open_mesh:
            m["vol_err"].append(abs((ex_s.data.get("volume") or 0) - p["W"] * p["H"] * p["T"]) / (p["W"] * p["H"] * p["T"]))
        wt = bool(ex_s.data.get("watertight"))
        m["wt"]["tp" if wt and not open_mesh else "fp" if wt else "tn" if open_mesh else "fn"] += 1

        ctx = Ctx(project_id=i, domain="mechanical", title="eval", description="", links=[], challenge_code="", video_url=None)
        for ex, name in ((ex_d, "part.dxf"), (ex_s, "part.stl")):
            ctx.extracted.append(ex)
            for f in ex.facts:
                ctx.add_evidence(f, name)
        pairs = claims_for(p, rng)
        claims = [Claim(id=f"c{j + 1}", text=t, type="design") for j, (t, _) in enumerate(pairs)]
        cm.verify_claims(claims, ctx)
        for c, (_, wrong) in zip(claims, pairs):
            flagged = c.status == "contradicted"
            m["cl"]["tp" if flagged and wrong else "fp" if flagged else "fn" if wrong else "tn"] += 1
            m["status"].append({"wrong": wrong, "status": c.status})

    def prf(d):
        p_ = d["tp"] / (d["tp"] + d["fp"]) if d["tp"] + d["fp"] else 1.0
        r_ = d["tp"] / (d["tp"] + d["fn"]) if d["tp"] + d["fn"] else 1.0
        f_ = 2 * p_ * r_ / (p_ + r_) if p_ + r_ else 0.0
        acc = (d["tp"] + d["tn"]) / max(1, sum(d.values()))
        return dict(precision=round(p_, 4), recall=round(r_, 4), f1=round(f_, 4), accuracy=round(acc, 4), **d)

    true_claims = [s for s in m["status"] if not s["wrong"]]
    summary = {
        "parts": a.n, "seed": a.seed, "mode": "ai" if a.ai else "deterministic",
        "dxf_dimension_recall": round(m["dims_found"] / m["dims_total"], 4),
        "dxf_annotation_recall": round(m["notes_found"] / m["notes_total"], 4),
        "stl_bbox_max_abs_error_mm": round(max(m["bbox_err"]), 6),
        "stl_volume_mean_rel_error": round(sum(m["vol_err"]) / max(1, len(m["vol_err"])), 6),
        "watertight_detection": prf(m["wt"]),
        "wrong_claim_detection": prf(m["cl"]),
        "true_claims_supported_rate": round(sum(1 for s in true_claims if s["status"] in {"verified", "partially_verified"}) / max(1, len(true_claims)), 4),
    }
    print(json.dumps(summary, indent=2))
    Path(a.out).write_text(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
