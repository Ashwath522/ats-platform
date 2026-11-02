"""Claims: what the student says the project does, checked against evidence.

1. extract claims (AI, or sentence split without AI)
2. verify each claim against the evidence list (AI, or keyword matching without AI)
3. deterministic rules (metric mismatches, civil safety) and ``enforce_claims``
   always run last and override the model.
"""
from __future__ import annotations

import json
import re
from typing import Dict, List

from .ai import QuotaExceeded, llm_json
from .context import Ctx
from .extractors.documents import metrics_in
from .schemas import Claim, enforce_claims

MAX_CLAIMS = 20
STOP = set("the and with that this from into using used have has was were are for our their which then than also can will been project system "
           "based design designed developed implemented make made works work able".split())
SAFETY = re.compile(r"\b(safe|safety|factor of safety|FOS|load[- ]bearing|withstand|comply|complies|compliant|IS ?\d{3,4}|earthquake|seismic|code[- ]compliant)\b", re.I)

EXTRACT_SYS = ("You extract checkable claims from a student's engineering project write-up. A claim is something the student says "
               "the project IS, USES, DOES or ACHIEVED (components, features, behaviour, performance numbers, results, design choices). "
               "Use the student's own wording, max 200 characters each, at most 20 claims, no duplicates, no opinions or plans. "
               'type is one of: feature (observable behaviour), component (part/tool/technology used), performance (a number), '
               'result (outcome), design (how it is built). origin is description, document or video. '
               'Reply JSON only: {"claims":[{"text":"","type":"feature","origin":"description"}]}')

VERIFY_SYS = ("You check claims against an evidence list for an engineering project report. For each claim pick a status:\n"
              "verified = evidence directly confirms it; partially_verified = evidence supports part of it or only shows it indirectly; "
              "unverified = no relevant evidence; contradicted = evidence conflicts with it.\n"
              "Rules: cite only evidence ids from the list. A good-looking video is not proof of how something is implemented. "
              "Never use outside knowledge to fill gaps. Reasoning must be one or two plain sentences a student understands.\n"
              'Reply JSON only: {"results":[{"id":"c1","status":"unverified","evidence_ids":[],"reasoning":""}]}')


def _sentences(text: str) -> List[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+|•|;\s", text or "")
    out = []
    for p in parts:
        s = p.strip(" -*\t")
        if 25 <= len(s) <= 280 and re.search(r"\b(is|are|uses?|using|built|designed|implemented|achiev\w*|detects?|measures?|controls?|sends?|reads?|displays?|runs?|%|\d)\b", s, re.I):
            out.append(s)
    return list(dict.fromkeys(out))[:12]


def _doc_text(ctx: Ctx, limit: int = 4000) -> str:
    return "\n".join(ex.text[:2000] for ex in ctx.extracted if ex.text)[:limit]


def extract_claims(ctx: Ctx) -> List[Claim]:
    speech = " ".join(s.get("spoken_summary", "") for s in (ctx.video or {}).get("segments", []))[:1500]
    user = (f"Title: {ctx.title}\nDomain: {ctx.domain}\n\nStudent description:\n{ctx.description[:4000]}\n\n"
            f"Report excerpts:\n{_doc_text(ctx) or '(none)'}\n\nWhat is said in the demo video:\n{speech or '(none)'}")
    out = None
    if ctx.description.strip() or _doc_text(ctx):
        try:
            out = llm_json(EXTRACT_SYS, user, operation="claims", max_tokens=1500)
        except QuotaExceeded:
            ctx.warnings.append("Daily AI limit reached — claims were taken from your description without AI.")
    claims: List[Claim] = []
    if out and isinstance(out.get("claims"), list):
        ctx.ai_used = True
        for c in out["claims"][:MAX_CLAIMS]:
            if isinstance(c, dict) and str(c.get("text", "")).strip():
                claims.append(Claim(id=f"c{len(claims) + 1}", text=str(c["text"]).strip()[:280],
                                    type=c.get("type") if c.get("type") in {"feature", "component", "performance", "result", "design"} else "feature",
                                    origin=c.get("origin") if c.get("origin") in {"description", "document", "video"} else "description"))
    if not claims:
        for s in _sentences(ctx.description):
            claims.append(Claim(id=f"c{len(claims) + 1}", text=s, type="performance" if re.search(r"\d+(\.\d+)?\s*%", s) else "feature"))
    return claims


def _tokens(text: str) -> set:
    return {t for t in re.findall(r"[a-z0-9][a-z0-9+.-]{2,}", text.lower()) if t not in STOP}


def _match_without_ai(claims: List[Claim], ctx: Ctx) -> None:
    ev = [e for e in ctx.evidence if e.method != "student_claim"]
    for c in claims:
        ct = _tokens(c.text)
        hits = []
        for e in ev:
            overlap = ct & _tokens(e.fact)
            if len(overlap) >= 2 or any(len(t) >= 5 and any(ch.isdigit() for ch in t) for t in overlap):
                hits.append(e.id)
        c.evidence_ids = hits[:5]
        c.status = "partially_verified" if hits else "unverified"
        c.reasoning = ("Related evidence was found automatically; a reviewer should confirm it." if hits
                       else "No evidence in the uploaded files or video mentions this.")


def verify_claims(claims: List[Claim], ctx: Ctx) -> Dict[str, List[str]]:
    """Fill status/evidence/reasoning on claims; return contradiction map {claim_id: [evidence ids]}."""
    if not claims:
        return {}
    ev_lines = [f"{e.id} | {e.source_type}:{e.source_ref[:40]} | {e.method}/{e.confidence} | {e.fact[:220]}"
                for e in ctx.evidence if e.method != "student_claim"][:260]
    user = "CLAIMS:\n" + "\n".join(f"{c.id} ({c.type}): {c.text}" for c in claims) + "\n\nEVIDENCE:\n" + ("\n".join(ev_lines) or "(no evidence)")
    out = None
    if ev_lines:
        try:
            out = llm_json(VERIFY_SYS, user, operation="verify", max_tokens=2500)
        except QuotaExceeded:
            ctx.warnings.append("Daily AI limit reached — claims were matched to evidence automatically instead.")
    if out and isinstance(out.get("results"), list):
        ctx.ai_used = True
        by_id = {c.id: c for c in claims}
        for r in out["results"]:
            c = by_id.get(str(r.get("id")))
            if not c or r.get("status") not in {"verified", "partially_verified", "unverified", "contradicted"}:
                continue
            c.status = r["status"]
            c.evidence_ids = [str(i) for i in (r.get("evidence_ids") or [])][:8]
            c.reasoning = str(r.get("reasoning", ""))[:380]
        for c in claims:
            if c.status == "not_checked":
                c.status, c.reasoning = "unverified", "This claim was not checked."
    else:
        _match_without_ai(claims, ctx)

    contradictions: Dict[str, List[str]] = {}
    # metric mismatches found by the analysers are authoritative
    for f in ctx.findings:
        if f["kind"] == "metric_mismatch":
            m = re.search(r"Claimed ([\w-]+) ([\d.]+)%", f["text"])
            for c in claims:
                if m and any(x["metric"] == m.group(1) and abs(x["value"] - float(m.group(2))) < 0.01 for x in metrics_in(c.text)):
                    c.status, c.evidence_ids = "contradicted", list(dict.fromkeys(c.evidence_ids + [f["id"]] + f["evidence_ids"]))
                    c.reasoning = f["text"]
                    contradictions[c.id] = [f["id"]]
    # civil / structural safety is never verified by us
    for c in claims:
        if ctx.domain == "civil" and SAFETY.search(c.text):
            c.status, c.reasoning = "unverified", "Structural safety and code-compliance claims are not independently checked."
    enforce_claims(claims, ctx.evidence, contradictions)
    return contradictions
