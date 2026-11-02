"""Photos and demo video → evidence (via Gemini, free tier). Vision readings are
never better than "medium" confidence and are always labelled as such."""
from __future__ import annotations

import re
from typing import List, Optional, Tuple

from .ai import QuotaExceeded, gemini_available, gemini_json, image_part
from .context import Ctx
from .extractors.base import Fact
from .files import sha256
from .schemas import VideoObservation

PHOTO_DOMAINS = {"electronics": "electronic components, boards, modules, sensors, wiring and their printed labels/values",
                 "robotics_iot": "electronic components, boards, sensors, motors, mechanical parts and labels",
                 "mechanical": "mechanical parts, mechanisms, fasteners, materials and any written dimensions",
                 "civil": "structural elements, materials, drawings, annotations and written dimensions"}
MAX_PHOTOS = 4


def read_photos(ctx: Ctx, photos: List[Tuple[str, bytes, str]]) -> None:
    """photos: [(filename, bytes, mime)]. Adds medium-confidence evidence; never raises except QuotaExceeded."""
    focus = PHOTO_DOMAINS.get(ctx.domain)
    if not focus or not photos:
        return
    if not gemini_available():
        ctx.warnings.append("Photo reading is unavailable right now — upload exact files (KiCad, Wokwi, STEP, DXF) for precise results.")
        return
    comps = []
    for name, data, mime in photos[:MAX_PHOTOS]:
        prompt = ("You are reading ONE photo from a student's engineering project. List only what is clearly visible. "
                  f"Focus on {focus}. Do not guess hidden parts, connections or values. Reply JSON only: "
                  '{"components":[{"label":"","value":"","type":""}],"visible_text":[""],"what_it_shows":""}')
        out = gemini_json([image_part(data, mime), {"text": prompt}], operation="photo", cache_key=sha256(data))
        if not out:
            continue
        ctx.ai_used = True
        for c in (out.get("components") or [])[:15]:
            if not isinstance(c, dict):
                continue
            label = " ".join(str(c.get(k, "")).strip() for k in ("label", "value") if c.get(k)).strip()
            if label:
                comps.append({"label": label[:60], "type": str(c.get("type", ""))[:30], "file": name})
                ctx.add_evidence(Fact(fact=f"Read from image {name}: {label[:80]}" + (f" ({c.get('type')})" if c.get("type") else ""),
                                      method="vision_model", confidence="medium", key="photo_comp", locator={"file": name}), name)
        if out.get("what_it_shows"):
            ctx.add_evidence(Fact(fact=f"Read from image {name}: {str(out['what_it_shows'])[:200]}", method="vision_model",
                                  confidence="medium", key="photo_desc", locator={"file": name}), name)
    ctx.domain_data["photo_components"] = comps


_WORDS = {"zero": "0", "oh": "0", "one": "1", "two": "2", "three": "3", "four": "4", "for": "4", "five": "5", "six": "6",
          "seven": "7", "eight": "8", "nine": "9"}


def spoken_digits(text: str) -> str:
    """'four eight two seven' / '4-8-2-7' / '4827' → '4827' (digits only, in order)."""
    out = []
    for tok in re.findall(r"[A-Za-z]+|\d", (text or "").lower()):
        if tok.isdigit():
            out.append(tok)
        elif tok in _WORDS:
            out.append(_WORDS[tok])
    return "".join(out)


def code_found(code: str, *texts: Optional[str]) -> bool:
    return bool(code) and any(code in spoken_digits(t or "") for t in texts)


VIDEO_PROMPT = (
    "You are checking a student's engineering project demo video for an evidence report. Describe ONLY what is actually "
    "visible or audible — never what the project is supposed to do. Split it into meaningful segments (each with mm:ss start/end). "
    "For each segment list visible objects/components, actions performed, inputs given (button press, sensor stimulus, typed "
    "input…) and observable outputs (LED on, motor turns, value on screen…), plus a short summary of what is said. "
    "If you see or hear a 4-digit verification code, report it. Note limitations (blurry, cut, no audio). "
    'Reply JSON only: {"duration_s":0,"segments":[{"start":"00:00","end":"00:10","visible":[],"actions":[],"inputs":[],"outputs":[],'
    '"spoken_summary":""}],"challenge_code_seen_or_heard":"yes|no|unclear","challenge_code_value":null,"limitations":[]}')


def analyse_video(ctx: Ctx, frames: List[Tuple[str, bytes]]) -> str:
    """Returns a stage message. Adds video evidence to ctx; may raise QuotaExceeded."""
    if not ctx.video_url and not frames:
        return "skipped:No demo video — practical functionality will be marked unverified."
    if not gemini_available():
        return "skipped:Video analysis is unavailable right now (AI not configured)."
    context = (f"Project domain: {ctx.domain}. Title: {ctx.title[:120]}. "
               f"Parts found in the files (look for them, but don't assume they appear): "
               + ", ".join(str(c.get("value") or c.get("ref")) for c in (ctx.domain_data.get("components") or [])[:20]))
    if ctx.video_url:
        parts = [{"file_data": {"file_uri": ctx.video_url}}, {"text": context + "\n\n" + VIDEO_PROMPT}]
        ckey = sha256(ctx.video_url.encode())
        source = "YouTube"
    else:
        parts = []
        for ts, data in frames[:12]:
            parts += [{"text": f"Frame at {ts}:"}, image_part(data)]
        parts.append({"text": context + "\nThese are key frames (no audio) from the demo video.\n\n" + VIDEO_PROMPT})
        ckey = sha256(b"".join(d for _, d in frames))
        source = "key frames"
    out = gemini_json(parts, operation="video", cache_key=ckey, max_tokens=6000)
    if not out:
        return "skipped:The video could not be analysed (private, too long or unavailable). Make it Unlisted, not Private."
    ctx.ai_used = True
    try:
        obs = VideoObservation.model_validate(out)
    except Exception:
        return "skipped:The video analysis reply was not usable."
    for seg in obs.segments[:30]:
        bits = []
        if seg.visible:
            bits.append("shows " + ", ".join(seg.visible[:6]))
        if seg.actions:
            bits.append("action: " + ", ".join(seg.actions[:4]))
        if seg.inputs or seg.outputs:
            bits.append(f"input {', '.join(seg.inputs[:3]) or '—'} → output {', '.join(seg.outputs[:3]) or '—'}")
        if bits:
            ctx.add_evidence(Fact(fact=f"Video {seg.start}–{seg.end or '?'}: " + "; ".join(bits), method="vision_model", confidence="medium",
                                  source_type="video", key="video_seg", locator={"t": seg.start}), seg.start)
        if seg.spoken_summary:
            ctx.add_evidence(Fact(fact=f"Video {seg.start}: said — {seg.spoken_summary[:200]}", method="transcript", confidence="medium",
                                  source_type="video", key="video_speech", locator={"t": seg.start}), seg.start)
    heard = code_found(ctx.challenge_code, obs.challenge_code_value, *[s.spoken_summary for s in obs.segments])
    if ctx.challenge_code:
        if heard:
            ctx.add_evidence(Fact(fact=f"Verification code {ctx.challenge_code} was seen or heard in the video", method="vision_model",
                                  confidence="medium", source_type="video", key="challenge_ok"), "video")
        else:
            ctx.finding(f"The verification code {ctx.challenge_code} was not found in the video — it can't be confirmed the video was recorded for this submission.",
                        severity="warn", kind="challenge_missing", confidence="medium")
    ctx.video = {"source": source, "url": ctx.video_url, "duration_s": obs.duration_s, "segments": [s.model_dump() for s in obs.segments[:30]],
                 "challenge_code_found": heard, "limitations": obs.limitations[:6]}
    return f"done:Video analysed from {source} ({len(obs.segments)} segments)."
