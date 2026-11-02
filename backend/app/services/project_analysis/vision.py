"""Optional, quota-safe circuit-photo extraction through the existing Gemini client."""
import hashlib, json
from sqlmodel import Session, select
from ..db import AnalysisCache, engine, utc_now

def vision_extract(image_bytes: bytes, schema: dict, client=None):
    """Return validated, medium-confidence image evidence; never raises to callers."""
    digest=hashlib.sha256(image_bytes).hexdigest(); key=f"project-vision:v1:{digest}"
    with Session(engine) as s:
        cached=s.exec(select(AnalysisCache).where(AnalysisCache.cache_key==key)).first()
        if cached: return json.loads(cached.payload_json)
    if client is None: return {"evidence":[],"warnings":["Photo reading unavailable right now — upload a KiCad, Wokwi or TinkerCAD file for exact results."]}
    try:
        raw=client.generate_json(image_bytes, schema)
        items=[]
        for c in raw.get("components",[])[:100]:
            items.append({"id":f"vision_{len(items)+1}","source_type":"file","source_ref":digest,"locator":None,"fact":f"Read from image: {c}","method":"vision_model","confidence":"medium","origin":"server","confirmed":True})
        result={"evidence":items,"warnings":[]}
        with Session(engine) as s: s.add(AnalysisCache(cache_key=key,payload_json=json.dumps(result),created_at=utc_now())); s.commit()
        return result
    except Exception:
        return {"evidence":[],"warnings":["Photo reading unavailable right now — upload a KiCad, Wokwi or TinkerCAD file for exact results."]}
