"""Tolerant JSON helpers for columns that may be NULL or hold bad data in old rows."""
import json
from typing import Any


def jloads(value: Any, default: Any = None) -> Any:
    """json.loads that returns ``default`` (a fresh [] when not given) for None/empty/invalid input."""
    if default is None:
        default = []
    if value is None or value == "":
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        out = json.loads(value)
    except (TypeError, ValueError):
        return default
    return default if out is None else out
