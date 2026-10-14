"""Shared types + helpers for live data providers.

Every provider talks to an official, documented public API (no scraping).
Providers never write to the database: they return ``RawJob`` /
``RawResource`` objects and ``app.services.live_sync`` decides what to keep.
"""
from __future__ import annotations

import html
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set
from urllib.parse import urlparse

import httpx

TIMEOUT = httpx.Timeout(15.0, connect=6.0)
USER_AGENT = "CoreLink-LiveSync/1.0 (+https://corelink.vercel.app; student job board)"
MAX_DESCRIPTION = 8000


class NotConfigured(Exception):
    """Raised when a provider needs an API key / config that is missing."""


@dataclass
class RawJob:
    source: str
    external_id: str
    title: str
    company_name: str = ""
    company_slug: Optional[str] = None
    description_text: str = ""
    location_text: str = ""
    city: Optional[str] = None
    country: Optional[str] = None
    remote_type: Optional[str] = None
    job_type: Optional[str] = None
    experience_level: Optional[str] = None
    apply_url: str = ""
    posting_url: Optional[str] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    posted_at: Optional[datetime] = None
    active: bool = True
    version: Optional[str] = None       # change marker for "fetch detail only when changed"
    detail_ref: Optional[str] = None    # provider URL for the detail call
    has_detail: bool = True             # False → provider.enrich() must run before saving
    branch_hint: Optional[str] = None   # branch of the search query that found it (aggregators)


@dataclass
class RawResource:
    source: str
    branch: str
    kind: str
    title: str
    url: str
    author: Optional[str] = None
    summary: Optional[str] = None
    thumbnail_url: Optional[str] = None
    published_at: Optional[datetime] = None


@dataclass
class FetchResult:
    items: List[Any] = field(default_factory=list)
    # Scopes (company ids / boards) that were fetched COMPLETELY. Jobs of this
    # source in these scopes that were not seen count as a miss. None = the
    # whole source was fetched completely (aggregators).
    complete_scopes: Optional[Set[str]] = None
    complete: bool = True               # False → no expiry bookkeeping at all
    errors: List[str] = field(default_factory=list)
    requests: int = 0


def env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


_TAG_BREAK = re.compile(r"<\s*(br|/p|/li|/h[1-6]|/div|/tr)\s*/?>", re.I)
_TAG_LI = re.compile(r"<\s*li[^>]*>", re.I)
_TAG = re.compile(r"<[^>]+>")
_SCRIPT = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.I | re.S)


def clean_html(raw: Optional[str], limit: int = MAX_DESCRIPTION) -> str:
    """HTML (possibly entity-escaped, as Greenhouse returns) → readable text."""
    if not raw:
        return ""
    text = str(raw)
    if "&lt;" in text and "<" not in text:
        text = html.unescape(text)
    text = _SCRIPT.sub(" ", text)
    text = _TAG_LI.sub("\n• ", text)
    text = _TAG_BREAK.sub("\n", text)
    text = _TAG.sub(" ", text)
    text = html.unescape(text).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.splitlines()]
    out, blank = [], False
    for ln in lines:
        if not ln:
            if not blank and out:
                out.append("")
            blank = True
            continue
        out.append(ln)
        blank = False
    text = "\n".join(out).strip()
    if len(text) > limit:
        text = text[: limit - 1].rsplit(" ", 1)[0] + "…"
    return text


def strip_tags(raw: Optional[str]) -> str:
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub("", raw or ""))).strip()


def parse_dt(value: Any) -> Optional[datetime]:
    """ISO-8601 string / epoch millis → naive UTC datetime."""
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)):
            v = float(value)
            if v > 1e11:
                v /= 1000.0
            return datetime.fromtimestamp(v, tz=timezone.utc).replace(tzinfo=None)
        s = str(value).strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        # Jooble: 2026-10-10T00:00:00.0000000 (7 fractional digits)
        m = re.match(r"^(.*T\d\d:\d\d:\d\d)\.(\d+)(.*)$", s)
        if m:
            s = f"{m.group(1)}.{m.group(2)[:6]}{m.group(3)}"
        d = datetime.fromisoformat(s)
        if d.tzinfo is not None:
            d = d.astimezone(timezone.utc).replace(tzinfo=None)
        return d
    except (ValueError, OverflowError, OSError):
        return None


def https_on_domain(url: Optional[str], domains: Iterable[str]) -> Optional[str]:
    """Return the URL (upgraded to https) only if its host is one of
    ``domains`` or a subdomain of them; otherwise None."""
    if not url or not isinstance(url, str):
        return None
    u = url.strip()
    if u.startswith("http://"):
        u = "https://" + u[len("http://"):]
    try:
        p = urlparse(u)
    except ValueError:
        return None
    if p.scheme != "https" or not p.hostname or p.username or p.password:
        return None
    host = p.hostname.lower()
    for d in domains:
        d = d.lower()
        if host == d or host.endswith("." + d):
            return u
    return None


INDIA_CITIES = {
    "bangalore", "bengaluru", "mumbai", "pune", "hyderabad", "chennai", "delhi", "new delhi", "noida", "gurgaon",
    "gurugram", "kolkata", "ahmedabad", "vadodara", "coimbatore", "mysore", "mysuru", "nagpur", "jaipur", "lucknow",
    "chandigarh", "kochi", "trivandrum", "thiruvananthapuram", "indore", "bhubaneswar", "visakhapatnam", "surat",
    "nashik", "aurangabad", "hosur", "faridabad", "manesar", "sanand", "jamshedpur", "rourkela", "bhopal", "goa",
}


def looks_indian(*parts: Optional[str]) -> bool:
    text = " ".join(p for p in parts if p).lower()
    if not text:
        return False
    if re.search(r"\bindia\b|\b(in|ind)\b$", text):
        return True
    return any(re.search(rf"\b{re.escape(c)}\b", text) for c in INDIA_CITIES)


def norm_job_type(label: Optional[str]) -> Optional[str]:
    s = (label or "").lower()
    if not s:
        return None
    if "intern" in s:
        return "internship"
    if "apprentic" in s or "trainee" in s:
        return "apprenticeship" if "apprentic" in s else "full-time"
    if "part" in s:
        return "part-time"
    if "full" in s or "permanent" in s or "regular" in s:
        return "full-time"
    if "contract" in s or "temporary" in s:
        return "full-time"
    return None


class Provider:
    """Base class. Subclasses set name/kind/label and implement fetch()."""

    name = "base"
    kind = "jobs"
    label = ""
    key_env: tuple = ()              # env vars that must be set
    domains: tuple = ()              # the only hosts our outbound links may point at

    def key_status(self) -> Dict[str, bool]:
        return {k: bool(env(k)) for k in self.key_env}

    def configured(self, settings: dict) -> bool:
        return all(env(k) for k in self.key_env)

    def not_configured_reason(self, settings: dict) -> Optional[str]:
        missing = [k for k in self.key_env if not env(k)]
        return f"not configured (set {', '.join(missing)})" if missing else None

    async def fetch(self, client: httpx.AsyncClient, settings: dict) -> FetchResult:  # pragma: no cover
        raise NotImplementedError

    async def enrich(self, client: httpx.AsyncClient, job: RawJob) -> RawJob:
        return job

    def source_label(self, company: str) -> str:
        return f"{company} · {self.label}" if company else self.label


def safe_error(exc: Exception) -> str:
    """Error text that never contains a request URL (URLs can carry API keys)."""
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, httpx.HTTPError):
        return type(exc).__name__
    msg = str(exc)
    msg = re.sub(r"https?://\S+", "<url>", msg)
    return f"{type(exc).__name__}: {msg[:160]}" if msg else type(exc).__name__
