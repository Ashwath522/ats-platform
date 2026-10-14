"""arXiv API (no key; https://info.arxiv.org/help/api/). Newest 5 papers per
branch topic query. arXiv asks for ≤1 request every 3 seconds — honoured.

GET https://export.arxiv.org/api/query?search_query=...&sortBy=submittedDate&sortOrder=descending&max_results=5
→ Atom feed: <entry><id>http://arxiv.org/abs/XXXX</id><published/><title/><summary/>
  <author><name/></author><link rel="alternate" href/><link title="pdf" href/></entry>
"""
from __future__ import annotations

import asyncio
import xml.etree.ElementTree as ET
from typing import List

import httpx

from .base import FetchResult, Provider, RawResource, https_on_domain, parse_dt, safe_error

API = "https://export.arxiv.org/api/query"
NS = {"a": "http://www.w3.org/2005/Atom"}
DOMAINS = ("arxiv.org",)
PER_BRANCH = 5

TOPICS = {
    "mechanical": 'abs:"additive manufacturing" OR abs:"finite element" OR abs:"mechanical design"',
    "civil": 'abs:"structural health monitoring" OR abs:"reinforced concrete" OR abs:"geotechnical"',
    "eee": 'cat:eess.SY AND (abs:"power system" OR abs:"power electronics" OR abs:"smart grid")',
    "ece": '(cat:eess.SP OR cat:cs.AR) AND (abs:FPGA OR abs:VLSI OR abs:embedded OR abs:antenna)',
    "chemical": 'abs:"chemical engineering" OR abs:"process engineering" OR abs:"chemical reactor"',
    "aerospace": 'abs:aerodynamics OR abs:aircraft OR abs:spacecraft',
    "automobile": 'abs:"electric vehicle" OR abs:"vehicle dynamics" OR abs:"battery management"',
    "metallurgy": 'cat:cond-mat.mtrl-sci AND (abs:alloy OR abs:steel OR abs:microstructure)',
}


def parse_feed(xml_text: str, branch: str) -> List[RawResource]:
    out: List[RawResource] = []
    root = ET.fromstring(xml_text)
    for e in root.findall("a:entry", NS):
        title = " ".join((e.findtext("a:title", "", NS) or "").split())
        url = None
        for link in e.findall("a:link", NS):
            if link.get("rel") == "alternate":
                url = link.get("href")
        url = https_on_domain(url or e.findtext("a:id", "", NS), DOMAINS)
        if not title or not url:
            continue
        authors = [a.findtext("a:name", "", NS) for a in e.findall("a:author", NS)]
        author = ", ".join(a for a in authors[:3] if a) + (" et al." if len(authors) > 3 else "")
        summary = " ".join((e.findtext("a:summary", "", NS) or "").split())
        out.append(RawResource(
            source="arxiv", branch=branch, kind="paper", title=title[:300], url=url, author=author or None,
            summary=summary[:600] or None, published_at=parse_dt(e.findtext("a:published", "", NS)),
        ))
    return out


class Arxiv(Provider):
    domains = DOMAINS
    name = "arxiv"
    kind = "resources"
    label = "arXiv"
    delay = 5.0                      # arXiv asks for >= 3 s between calls; shared cloud IPs need more
    timeout = httpx.Timeout(45.0, connect=10.0)   # arXiv search is often slow

    async def fetch(self, client: httpx.AsyncClient, settings: dict) -> FetchResult:
        result = FetchResult()
        for i, (branch, query) in enumerate(TOPICS.items()):
            if i and self.delay:
                await asyncio.sleep(self.delay)
            params = {"search_query": query, "sortBy": "submittedDate", "sortOrder": "descending", "max_results": PER_BRANCH}
            for attempt in range(3):
                try:
                    r = await client.get(API, params=params, timeout=self.timeout)
                    result.requests += 1
                    if r.status_code in (429, 503) and attempt < 2:
                        await asyncio.sleep(self.delay * (attempt + 2))   # back off and retry
                        continue
                    r.raise_for_status()
                    result.items.extend(parse_feed(r.text, branch))
                    break
                except httpx.TimeoutException as exc:
                    if attempt < 2:
                        await asyncio.sleep(self.delay)
                        continue
                    result.errors.append(f"{branch}: {safe_error(exc)}")
                except Exception as exc:
                    result.errors.append(f"{branch}: {safe_error(exc)}")
                    break
        if not result.items and result.errors:
            raise RuntimeError("; ".join(result.errors)[:500])
        return result
