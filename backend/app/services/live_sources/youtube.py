"""YouTube Data API v3 search (free key from console.cloud.google.com).

GET https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=27
    &q=...&order=relevance&publishedAfter=...&relevanceLanguage=en&safeSearch=strict&maxResults=10&key=
→ {"items": [{"id": {"kind": "youtube#video", "videoId"}, "snippet": {publishedAt, channelTitle,
   title, description, thumbnails{medium{url}}, liveBroadcastContent}}]}
Each search costs 100 quota units: 8 branches × 4 syncs/day = 3,200 of the free 10,000.
"""
from __future__ import annotations

import html
from datetime import timedelta
from typing import List

import httpx

from ...db import utc_now
from .base import FetchResult, Provider, RawResource, env, https_on_domain, parse_dt, safe_error

API = "https://www.googleapis.com/youtube/v3/search"
PER_BRANCH = 5

QUERIES = {
    "mechanical": "mechanical engineering lecture machine design",
    "civil": "civil engineering lecture structural analysis",
    "eee": "electrical engineering lecture power systems",
    "ece": "electronics engineering lecture embedded systems VLSI",
    "chemical": "chemical engineering lecture process design",
    "aerospace": "aerospace engineering lecture aerodynamics",
    "automobile": "automobile engineering lecture electric vehicle powertrain",
    "metallurgy": "metallurgy materials engineering lecture heat treatment",
}


def parse_search(data: dict, branch: str) -> List[RawResource]:
    out = []
    for it in data.get("items") or []:
        vid = (it.get("id") or {}).get("videoId")
        sn = it.get("snippet") or {}
        if not vid or sn.get("liveBroadcastContent") in {"live", "upcoming"}:
            continue
        thumbs = sn.get("thumbnails") or {}
        thumb = (thumbs.get("medium") or thumbs.get("high") or thumbs.get("default") or {}).get("url")
        out.append(RawResource(
            source="youtube", branch=branch, kind="video", title=html.unescape(sn.get("title") or "")[:300],
            url=f"https://www.youtube.com/watch?v={vid}", author=html.unescape(sn.get("channelTitle") or "") or None,
            summary=html.unescape(sn.get("description") or "")[:600] or None,
            thumbnail_url=https_on_domain(thumb, ("ytimg.com",)), published_at=parse_dt(sn.get("publishedAt")),
        ))
    out.sort(key=lambda r: r.published_at or utc_now(), reverse=True)
    return out[:PER_BRANCH]


class YouTube(Provider):
    domains = ("youtube.com",)
    name = "youtube"
    kind = "resources"
    label = "YouTube"
    key_env = ("YOUTUBE_API_KEY",)

    async def fetch(self, client: httpx.AsyncClient, settings: dict) -> FetchResult:
        result = FetchResult()
        after = (utc_now() - timedelta(days=365)).replace(microsecond=0).isoformat() + "Z"
        for branch, q in QUERIES.items():
            try:
                r = await client.get(API, params={
                    "part": "snippet", "type": "video", "videoCategoryId": "27", "q": q, "order": "relevance",
                    "publishedAfter": after, "relevanceLanguage": "en", "safeSearch": "strict", "maxResults": 10,
                    "videoEmbeddable": "true", "key": env("YOUTUBE_API_KEY"),
                })
                result.requests += 1
                r.raise_for_status()
                result.items.extend(parse_search(r.json(), branch))
            except Exception as exc:
                result.errors.append(f"{branch}: {safe_error(exc)}")
        if not result.items and result.errors:
            raise RuntimeError("; ".join(result.errors)[:500])
        return result
