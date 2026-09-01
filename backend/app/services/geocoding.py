"""
Free geocoding via Nominatim (OpenStreetMap).

Nominatim usage policy: max 1 request/second, must include a descriptive
User-Agent header. No API key needed. This is fine for low-volume job
posting (recruiters create a handful of jobs, not thousands per second).

For high-volume production use, consider a paid provider or self-hosted
Nominatim instance.
"""
import time
import urllib.parse
import urllib.request
import json
from typing import Optional, Tuple

_USER_AGENT = "ATS-Platform/1.0 (job-posting-geocoder)"
_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_last_request_time = 0.0


def geocode(location_text: str) -> Optional[Tuple[float, float]]:
    """Convert a location string (city, address, etc.) to (latitude, longitude).
    Returns None if geocoding fails or the location can't be found."""
    global _last_request_time

    if not location_text or not location_text.strip():
        return None

    # Rate limit: 1 req/sec per Nominatim policy
    now = time.time()
    elapsed = now - _last_request_time
    if elapsed < 1.0:
        time.sleep(1.0 - elapsed)

    params = urllib.parse.urlencode({
        "q": location_text.strip(),
        "format": "json",
        "limit": 1,
    })
    url = f"{_NOMINATIM_URL}?{params}"

    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})

    try:
        _last_request_time = time.time()
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data and len(data) > 0:
                return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception:
        pass

    return None
