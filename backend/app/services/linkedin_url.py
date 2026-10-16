"""Validate / normalise a pasted LinkedIn profile URL. Never fetched."""
import re
from typing import Optional

_RE = re.compile(r"^(?:https?://)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com/in/([A-Za-z0-9\-_%]{3,100})/?(?:[?#].*)?$", re.I)


def normalize_linkedin_url(value) -> Optional[str]:
    """'' → None; valid profile URL → https://www.linkedin.com/in/<slug>; otherwise ValueError."""
    raw = str(value or "").strip()
    if not raw:
        return None
    m = _RE.match(raw)
    if not m:
        raise ValueError("Enter your LinkedIn profile link, like linkedin.com/in/your-name")
    return "https://www.linkedin.com/in/" + m.group(1)
