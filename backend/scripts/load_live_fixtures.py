"""
Load the saved live-API fixtures into the local DB through the REAL sync
pipeline (classifier, URL checks, dedupe, SyncRun bookkeeping) — no network.
Use it to demo / screenshot the Live Data features offline.

    cd backend && python scripts/load_live_fixtures.py                    # real SmartRecruiters responses only
    python scripts/load_live_fixtures.py --with-doc-samples               # + Adzuna/Jooble/Greenhouse/Lever/arXiv/YouTube
                                                                          #   sample payloads built from their API docs
    python scripts/load_live_fixtures.py --clear                          # remove all ExternalJob / LiveResource / SyncRun rows first

The real fixtures (tests/fixtures/live_jobs/smartrecruiters_*.json) were captured
from the public SmartRecruiters Posting API. For postings without a captured detail
response the posting/apply URL is built with SmartRecruiters' public URL pattern
(jobs.smartrecruiters.com/{company}/{id}) and the description is left empty.
Doc samples are illustrative (fictional companies) — never load them into production.
NEVER run this against a production database.
"""
import argparse
import asyncio
import copy
import json
import os
import re
import sys
from datetime import timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import httpx  # noqa: E402
from sqlmodel import Session, delete  # noqa: E402

from app.db import ExternalJob, LiveResource, PlatformSetting, SyncRun, engine, init_db, utc_now  # noqa: E402
from app.services import live_sync  # noqa: E402
from app.services.live_sources import PROVIDERS  # noqa: E402

FIX = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures")


def _load(*parts):
    path = os.path.join(FIX, *parts)
    with open(path, encoding="utf-8") as fh:
        return fh.read() if path.endswith(".xml") else json.load(fh)


def _slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def make_handler(doc_samples: bool):
    sr_list = _load("live_jobs", "smartrecruiters_list.json")["content"]
    sr_detail = _load("live_jobs", "smartrecruiters_detail.json")
    now = utc_now()

    def rel(days):
        return (now - timedelta(days=days)).replace(microsecond=0).isoformat() + "Z"

    def handler(request: httpx.Request) -> httpx.Response:
        host, path = request.url.host, request.url.path.strip("/").split("/")
        if host == "api.smartrecruiters.com":
            cid = path[2]
            if len(path) == 4:
                items = [c for c in sr_list if c["company"]["identifier"] == cid]
                return httpx.Response(200, json={"offset": 0, "limit": 100, "totalFound": len(items), "content": items})
            pid = path[4]
            if pid == sr_detail["id"]:
                return httpx.Response(200, json=sr_detail)
            item = next((c for c in sr_list if c["id"] == pid), None)
            if not item:
                return httpx.Response(404, json={})
            d = {k: item[k] for k in ("id", "name", "company", "location", "releasedDate", "experienceLevel", "typeOfEmployment")}
            url = f"https://jobs.smartrecruiters.com/{item['company']['identifier']}/{pid}-{_slug(item['name'])}"
            d.update({"active": True, "postingUrl": url, "applyUrl": url + "?oga=true", "jobAd": {"sections": {}}})
            return httpx.Response(200, json=d)
        if not doc_samples:
            return httpx.Response(404)
        if host == "api.adzuna.com":
            data = _load("live_jobs", "adzuna_search.json")
            for i, r in enumerate(data["results"]):
                r["created"] = rel(1 + i)
            return httpx.Response(200, json=data)
        if host == "jooble.org":
            data = _load("live_jobs", "jooble_search.json")
            for r in data["jobs"]:
                r["updated"] = (now - timedelta(days=2)).strftime("%Y-%m-%dT00:00:00.0000000")
            return httpx.Response(200, json=data)
        if host == "boards-api.greenhouse.io":
            data = _load("live_jobs", "greenhouse_jobs.json")
            for r in data["jobs"]:
                r["first_published"] = r["updated_at"] = rel(3)
            return httpx.Response(200, json=data)
        if host == "api.lever.co":
            data = _load("live_jobs", "lever_postings.json")
            for r in data:
                r["createdAt"] = int((now - timedelta(days=4)).timestamp() * 1000)
            return httpx.Response(200, json=data)
        if host == "export.arxiv.org":
            return httpx.Response(200, text=_load("live_resources", "arxiv_feed.xml"))
        if host == "www.googleapis.com":
            return httpx.Response(200, json=_load("live_resources", "youtube_search.json"))
        return httpx.Response(404)

    return handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--with-doc-samples", action="store_true")
    ap.add_argument("--clear", action="store_true")
    args = ap.parse_args()
    init_db()
    if args.clear:
        with Session(engine) as s:
            for model in (ExternalJob, LiveResource, SyncRun):
                if model is LiveResource:
                    s.exec(delete(LiveResource).where(LiveResource.source != "admin"))
                else:
                    s.exec(delete(model))
            s.exec(delete(PlatformSetting).where(PlatformSetting.key.startswith("live_sync_rejected:")))
            s.commit()
    live_sync.TRANSPORT = httpx.MockTransport(make_handler(args.with_doc_samples))
    PROVIDERS["arxiv"].delay = 0
    only = ["smartrecruiters"]
    if args.with_doc_samples:
        for k in ("ADZUNA_APP_ID", "ADZUNA_APP_KEY", "JOOBLE_API_KEY", "YOUTUBE_API_KEY"):
            os.environ.setdefault(k, "fixture")
        live_sync.save_settings({"greenhouse_boards": ["exampleaero"], "lever_boards": ["examplemotors"]})
        only += ["adzuna", "jooble", "greenhouse", "lever", "arxiv", "youtube"]
    out = asyncio.run(live_sync.run_sync("all", "fixtures", only))
    if args.with_doc_samples:
        # demo only: don't leave fixture boards configured for real syncs
        live_sync.save_settings({"greenhouse_boards": [], "lever_boards": []})
    for src in out["sources"]:
        print(f"{src['source']:16} {src['status']:8} fetched={src.get('fetched', 0):3} added={src.get('added', 0):3} "
              f"updated={src.get('updated', 0):3} expired={src.get('expired', 0):3} {src.get('error') or ''}")


if __name__ == "__main__":
    main()
