"""
Haversine distance calculation for "jobs near me" filtering.

Straight-line distance between two lat/lng points on Earth. Good enough
for job proximity filtering — this is a convenience sort, not navigation.
"""
import math
from typing import Optional

EARTH_RADIUS_KM = 6371.0


def haversine_km(
    lat1: float, lng1: float,
    lat2: float, lng2: float,
) -> float:
    """Distance in kilometres between two (lat, lng) points using the haversine formula."""
    lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)

    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlng / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return EARTH_RADIUS_KM * c


def distance_or_none(
    lat1: Optional[float], lng1: Optional[float],
    lat2: Optional[float], lng2: Optional[float],
) -> Optional[float]:
    """Like haversine_km but returns None if either point has missing coordinates."""
    if lat1 is None or lng1 is None or lat2 is None or lng2 is None:
        return None
    return haversine_km(lat1, lng1, lat2, lng2)
