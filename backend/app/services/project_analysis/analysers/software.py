"""Software and AI/ML analysers."""
from __future__ import annotations

import json
import re

from ..context import Ctx
from ..extractors.base import Fact, clip
from ..extractors.documents import metrics_in
from .. import github


def _deps(ctx: Ctx) -> list:
    out = []
    for b in ctx.of_type("archive"):
        for fname, text in (b.get("deps") or {}).items():
            if fname == "package.json":
                try:
                    pj = json.loads(text)
                    out += list((pj.get("dependencies") or {}).keys()) + list((pj.get("devDependencies") or {}).keys())
                except Exception:
                    pass
            elif fname == "requirements.txt":
                out += [re.split(r"[<>=~!\[; ]", l.strip())[0] for l in text.splitlines() if l.strip() and not l.startswith(("#", "-"))]
            elif fname == "platformio.ini":
                out += re.findall(r"^\s*[\w-]+/([\w-]+)", text, re.M)
    return sorted(set(d for d in out if d))


def _github(ctx: Ctx) -> dict | None:
    repo = github.repo_from_links(ctx.links)
    if not repo:
        return None
    gh = github.fetch(repo)
    if not gh.get("ok"):
        ctx.warnings.append(f"GitHub: {gh.get('error')}")
        return gh
    src = f"github.com/{repo}"
    def ev(text, key, conf="high"):
        return ctx.add_evidence(Fact(fact=text, method="api", confidence=conf, source_type="repo", key=key), src)
    langs = clip([f"{k}" for k, _ in sorted(gh["languages"].items(), key=lambda x: -x[1])], 6)
    ev(f"GitHub {repo}: {gh['files']} files, languages {langs or 'unknown'}, {gh['commit_count']} recent commits over {gh['commit_days']} day(s)", "gh:repo")
    if gh["fork"]:
        ctx.finding(f"{repo} is a fork of another repository — original authorship should be checked.", severity="warn", kind="gh_fork", cites=ctx.cite("gh:repo"))
    ev(f"GitHub {repo}: tests {'present' if gh['has_tests'] else 'not found'}, CI {'configured' if gh['has_ci'] else 'not configured'}, README {'present' if gh['has_readme'] else 'missing'}", "gh:quality")
    names = {n.lower() for n in ctx.student_names if n and len(n) > 2}
    authors = [a.lower() for a in list(gh["authors"].keys()) + gh.get("author_names", [])]
    match = any(n and (n in a or a in n) for n in names for a in authors) if names else None
    if match is True:
        ctx.finding("Commit authors on GitHub include the student.", severity="ok", kind="gh_owner", cites=ctx.cite("gh:repo"))
    elif match is False and authors:
        ctx.finding(f"None of the GitHub commit authors ({clip(list(gh['authors'].keys()), 4)}) match the student's name — authorship not confirmed.",
                    severity="warn", kind="gh_owner", cites=ctx.cite("gh:repo"), confidence="medium")
    if gh["commit_count"] and gh["commit_days"] <= 1 and gh["commit_count"] <= 3:
        ctx.finding("The repository history is one or two commits on a single day, so the development process can't be seen.", severity="info", kind="gh_history", cites=ctx.cite("gh:repo"))
    return gh


def analyse_software(ctx: Ctx) -> dict:
    src = ctx.of_type("source")
    deps = _deps(ctx)
    imports = sorted({i for b in src for i in b.get("imports", [])})
    routes = [r for b in src for r in b.get("routes", [])]
    tests = sum(1 for b in src if b.get("is_test")) + sum(b.get("tests", 0) for b in ctx.of_type("archive"))
    todo = sum(b.get("todo", 0) for b in src)
    empty = sum(b.get("empty_functions", 0) for b in src)
    lines = sum(b.get("lines", 0) for b in src)
    gh = _github(ctx)
    if deps:
        ctx.add_evidence(Fact(fact=f"Declared dependencies: {clip(deps, 20)}", method="parsed", key="deps", source_type="file"), "dependency files")
    if src and tests == 0 and not (gh or {}).get("has_tests"):
        ctx.finding("No automated tests were found.", severity="missing", kind="no_tests")
    if todo:
        ctx.finding(f"{todo} TODO/FIXME marker(s) suggest unfinished parts.", severity="warn", kind="todo", cites=ctx.cite("imports", "routes"))
    if empty:
        ctx.finding(f"{empty} empty function(s) (only 'pass' / '...').", severity="warn", kind="empty_functions")
    if not src and not gh:
        ctx.finding("No source code or GitHub repository was provided.", severity="missing", kind="no_code")
    return {"stack": deps or imports[:30], "imports": imports[:40], "routes": routes[:40], "tests": tests, "todo": todo,
            "source_lines": lines, "source_files": len(src), "github": {k: v for k, v in (gh or {}).items() if not k.startswith("_")} or None,
            "ci": any(b.get("ci") for b in ctx.of_type("archive")) or bool((gh or {}).get("has_ci"))}


def analyse_ml(ctx: Ctx) -> dict:
    sw = analyse_software(ctx)
    nbs = ctx.of_type("notebook")
    datasets = ctx.of_type("dataset")
    found = [dict(m, file=b["file"]) for b in nbs for m in b.get("metrics", [])]
    found += [dict(m, file=b["file"], from_doc=True) for b in ctx.of_type("document") for m in b.get("metrics", [])]
    claimed = metrics_in(ctx.description)
    comparisons = []
    for c in claimed:
        same = [f for f in found if f["metric"] == c["metric"] and not f.get("from_doc")]
        if not same:
            comparisons.append({"metric": c["metric"], "claimed": c["value"], "found": None, "status": "not_found"})
            continue
        best = max(same, key=lambda f: f["value"])
        status = "match" if abs(best["value"] - c["value"]) <= 2 else ("lower" if best["value"] < c["value"] else "higher")
        comparisons.append({"metric": c["metric"], "claimed": c["value"], "found": best["value"], "status": status, "file": best["file"]})
        ids = ctx.cite(f"metric:{c['metric']}")
        if status == "lower" and c["value"] - best["value"] > 2:
            ctx.finding(f"Claimed {c['metric']} {c['value']:g}% but the notebook output shows at most {best['value']:g}%.", severity="issue", kind="metric_mismatch", cites=ids)
        elif status == "match":
            ctx.finding(f"Claimed {c['metric']} {c['value']:g}% matches notebook output ({best['value']:g}%).", severity="ok", kind="metric_match", cites=ids)
    for b in nbs:
        for f in b.get("findings", []):
            ctx.finding(f"{b['file']}: {f}", severity="warn", kind="ml_risk", cites=ctx.cite("ml_finding"), confidence="medium")
    for d in datasets:
        if d.get("duplicates", 0) > max(5, d.get("rows", 0) * 0.05):
            ctx.finding(f"{d['file']} has {d['duplicates']} duplicate rows — they can leak between train and test sets.", severity="warn", kind="dup_rows", cites=ctx.cite("quality"))
    if not nbs and not ctx.of_type("source"):
        ctx.finding("No training notebook or code was uploaded.", severity="missing", kind="no_training_code")
    if not datasets:
        ctx.finding("No dataset sample was uploaded.", severity="missing", kind="no_dataset")
    return sw | {"models": sorted({m for b in nbs for m in b.get("models", [])}), "metrics_found": found[:20],
                 "metric_checks": comparisons, "datasets": [{k: d.get(k) for k in ("file", "rows", "cols", "missing_pct", "duplicates")} for d in datasets]}
