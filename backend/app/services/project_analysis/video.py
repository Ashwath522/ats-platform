"""Provider-independent video observation helpers. The raw video never enters this service."""
import hashlib, json
from .schemas import VideoObservation

FRIENDLY = "Video analysis unavailable right now — use a public YouTube link or upload key moments from the browser."
def _prompt(context): return "Return JSON only matching VideoObservation. Observe only visible or spoken facts. Context: " + json.dumps(context)
def video_analyse_url(url, context, client=None):
    if not client: return None, FRIENDLY
    try: return VideoObservation.model_validate(client.generate_json(_prompt(context), url)), None
    except Exception: return None, FRIENDLY
def video_analyse_frames(keyframes, transcript, context, client=None):
    if not client: return None, FRIENDLY
    try: return VideoObservation.model_validate(client.generate_json(_prompt(context), keyframes, transcript)), None
    except Exception: return None, FRIENDLY
def challenge_match(code, text):
    if not code: return False
    words={'zero':'0','one':'1','two':'2','three':'3','four':'4','five':'5','six':'6','seven':'7','eight':'8','nine':'9'}
    normal=''.join(words.get(x,x) for x in (text or '').lower().replace('-',' ').split())
    return code in normal or code in ''.join(c for c in (text or '') if c.isdigit())
