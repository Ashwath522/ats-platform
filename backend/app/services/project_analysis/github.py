"""Read-only GitHub facts for a repository link (free REST API, cached).

Without a token GitHub allows 60 requests/hour per IP; set GITHUB_TOKEN (a
read-only fine-grained token, free) to raise that. Never clones or runs code.
"""
from __future__ import annotations

import os
import re
import time
from typing import Optional

import httpx

from .ai import cache_get, cache_put

REPO_RE = re.compile(r"https?://(?:www\.)?github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?(?:/|$|\?|#)")
TTL = 6 * 3600


def repo_from_links(links) -> Optional[str]:
    for l in links or []:
        m = REPO_RE.match(((l or {}).get("url") or "") + "/")
        if m:
            return f"{m.group(1)}/{m.group(2)}"
    return None


def fetch(repo: str) -> dict:
    """{ok, repo, ...} or {ok: False, error} — never raises."""
    key = f"pa:gh:{repo.lower()}"
    hit = cache_get(key)
    if hit and time.time() - hit.get("_at", 0) < TTL:
        return hit
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "CoreLink-project-analysis"}
    tok = os.environ.get("GITHUB_TOKEN", "").strip()
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    base = f"https://api.github.com/repos/{repo}"
    try:
        with httpx.Client(timeout=8.0, headers=headers) as c:
            meta = c.get(base)
            if meta.status_code == 404:
                return {"ok": False, "repo": repo, "error": "Repository not found or private."}
            if meta.status_code in (403, 429):
                return {"ok": False, "repo": repo, "error": "GitHub rate limit reached — try again in an hour."}
            meta.raise_for_status()
            m = meta.json()
            langs = c.get(f"{base}/languages").json() if True else {}
            commits = c.get(f"{base}/commits", params={"per_page": 100})
            commits = commits.json() if commits.status_code == 200 else []
            tree = c.get(f"{base}/git/trees/{m.get('default_branch', 'main')}", params={"recursive": "1"})
            tree = tree.json() if tree.status_code == 200 else {}
    except Exception as exc:
        return {"ok": False, "repo": repo, "error": f"GitHub could not be reached ({type(exc).__name__})."}
    paths = [t.get("path", "") for t in (tree.get("tree") or []) if t.get("type") == "blob"][:5000]
    authors = {}
    dates = []
    for cm in commits if isinstance(commits, list) else []:
        a = (cm.get("commit") or {}).get("author") or {}
        login = (cm.get("author") or {}).get("login")
        name = login or a.get("name") or "unknown"
        authors[name] = authors.get(name, 0) + 1
        if a.get("date"):
            dates.append(a["date"][:10])
    out = {
        "ok": True, "repo": repo, "_at": time.time(), "fork": bool(m.get("fork")), "stars": m.get("stargazers_count", 0),
        "description": (m.get("description") or "")[:200], "created": (m.get("created_at") or "")[:10], "pushed": (m.get("pushed_at") or "")[:10],
        "languages": langs if isinstance(langs, dict) else {}, "commit_count": len(dates), "commit_days": len(set(dates)),
        "first_commit": min(dates) if dates else None, "last_commit": max(dates) if dates else None,
        "authors": dict(sorted(authors.items(), key=lambda x: -x[1])[:10]),
        "author_names": sorted({((cm.get("commit") or {}).get("author") or {}).get("name", "") for cm in (commits if isinstance(commits, list) else [])} - {""})[:20],
        "files": len(paths), "has_tests": any(re.search(r"(^|/)(tests?|__tests__|spec)/|test_|\.test\.|_test\.", p) for p in paths),
        "has_ci": any(p.startswith(".github/workflows/") for p in paths), "has_readme": any(p.lower().startswith("readme") for p in paths),
        "dep_files": [p for p in paths if p.rsplit("/", 1)[-1] in {"package.json", "requirements.txt", "pyproject.toml", "pom.xml", "build.gradle", "platformio.ini"}][:10],
    }
    cache_put(key, out)
    return out
