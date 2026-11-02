"""Run the project analysis on local files — no server, no login, no upload.

    python scripts/analyse_local.py --domain mechanical --title "Flange plate" \
        --desc ~/Downloads/cad_test/DESCRIPTION.txt ~/Downloads/cad_test/flange_plate.dxf ~/Downloads/cad_test/flange_plate.stl

Uses GEMINI_API_KEY / GROQ_API_KEY from backend/.env (or the shell) to verify claims;
without a key it falls back to keyword matching. Writes <out>/report.json and report.pdf.
It uses a scratch database, so your real one is never touched.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except Exception:
    pass
os.environ["ATS_DATA_DIR"] = tempfile.mkdtemp(prefix="corelink-analyse-")
os.environ["DATABASE_URL"] = ""                     # scratch SQLite only
os.environ.setdefault("PROJECT_ANALYSIS_MAX_LLM_CALLS_PER_DAY", "40")


def description_from(path_or_text: str) -> str:
    p = Path(os.path.expanduser(path_or_text))
    if not p.is_file():
        return path_or_text
    text = p.read_text(encoding="utf-8", errors="replace")
    # DESCRIPTION.txt from the test pack: take only the "Description (paste)" block
    if "---- Description" in text:
        text = text.split("---- Description", 1)[1].split("\n", 1)[1].split("\n----", 1)[0]
    return text.strip()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", help="project files (dxf, stl, step, code, pdf, images, …)")
    ap.add_argument("--domain", default="mechanical")
    ap.add_argument("--title", default="Local project")
    ap.add_argument("--desc", default="", help="description text, or a path to a .txt file")
    ap.add_argument("--video", default=None, help="optional YouTube link")
    ap.add_argument("--out", default=str(Path.cwd() / "analysis_out"))
    a = ap.parse_args()

    from app.db import init_db
    init_db()
    from app.services.project_analysis import analysers, claims as claims_mod, media, report, scoring
    from app.services.project_analysis.ai import gemini_available, text_ai_available
    from app.services.project_analysis.context import Ctx
    from app.services.project_analysis.extractors import extract, flatten
    from app.services.project_analysis.extractors.base import Fact
    from app.services.project_analysis.files import file_ext, kind_of
    from app.services.project_analysis.schemas import AnalysisResult

    if text_ai_available():
        import asyncio
        from app.services import llm_stream
        try:   # use the providers' current model names (old ones get retired)
            asyncio.run(llm_stream.resolve_models())
        except Exception:
            pass

    ctx = Ctx(project_id=0, domain=a.domain, title=a.title, description=description_from(a.desc), links=[],
              challenge_code="", video_url=a.video, student_names=[])
    print(f"AI for claims: {'ON' if text_ai_available() else 'OFF (keyword matching only)'} · "
          f"Gemini vision: {'ON' if gemini_available() else 'OFF'}\n")
    if ctx.description:
        ctx.add_evidence(Fact(fact=f"Student says: {ctx.description[:400]}", method="student_claim", confidence="low",
                              source_type="description", key="description"), "description")
    photos = []
    for i, f in enumerate(a.files):
        p = Path(os.path.expanduser(f))
        data, ext = p.read_bytes(), file_ext(p.name)
        ctx.files.append({"id": i + 1, "filename": p.name, "ext": ext, "kind": kind_of(ext)})
        ex = extract(p.name, data)
        ctx.extracted.append(ex)
        for fact in ex.facts:
            ctx.add_evidence(fact, p.name)
        ctx.warnings.extend(ex.warnings)
        if kind_of(ext) == "image":
            photos.append((p.name, data, "image/png" if ext == ".png" else "image/jpeg"))
    ctx.blocks = flatten(ctx.extracted)
    media.read_photos(ctx, photos)
    ctx.domain_data.update(analysers.run(ctx))
    media.analyse_video(ctx, [])
    claims = claims_mod.extract_claims(ctx)
    claims_mod.verify_claims(claims, ctx)
    scores = scoring.score(ctx, claims)
    rep = report.build(ctx, claims, scores)
    result = AnalysisResult(project_id=0, domain=ctx.domain, stages=[], evidence=ctx.evidence, claims=claims,
                            domain_data={k: v for k, v in ctx.domain_data.items() if not k.startswith("_")} | {"findings": ctx.findings},
                            video=ctx.video, scores=scores, report=rep, warnings=list(dict.fromkeys(ctx.warnings))[:40], ai_used=ctx.ai_used)

    ev = {e.id: e for e in ctx.evidence}
    print("EVIDENCE READ FROM FILES")
    for e in ctx.evidence:
        if e.source_type != "description":
            print(f"  [{e.id}] {e.fact}")
    print("\nCLAIMS")
    icon = {"verified": "✅", "partially_verified": "🟡", "unverified": "⚠️ ", "contradicted": "❌"}
    for c in claims:
        print(f"  {icon.get(c.status, '?')} {c.status.upper():<19} {c.text}")
        if c.reasoning:
            print(f"      why: {c.reasoning}")
        for i in c.evidence_ids[:3]:
            if i in ev:
                print(f"      ↳ {ev[i].fact[:140]}")
    print("\nFINDINGS")
    for f in ctx.findings:
        print(f"  [{f.get('severity', '')}] {f['text']}")
    print("\nSCORES")
    print(json.dumps(scores, indent=2, default=str)[:3000])
    if ctx.warnings:
        print("\nWARNINGS\n  " + "\n  ".join(dict.fromkeys(ctx.warnings)))

    out = Path(os.path.expanduser(a.out))
    out.mkdir(parents=True, exist_ok=True)
    js = result.model_dump(mode="json")
    (out / "report.json").write_text(json.dumps(js, indent=2), encoding="utf-8")
    try:
        from app.services.project_analysis.pdf import render
        (out / "report.pdf").write_bytes(render(js, a.title))
        print(f"\nSaved {out / 'report.json'} and {out / 'report.pdf'}")
    except Exception as exc:
        print(f"\nSaved {out / 'report.json'} (PDF failed: {exc})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
