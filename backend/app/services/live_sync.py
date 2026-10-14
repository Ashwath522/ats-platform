"""Live jobs & resources sync: classification, dedupe, expiry and hygiene.

Triggered over HTTP (admin button or an external cron hitting
/api/internal/live-sync) because free hosts sleep — there is no in-process
scheduler. One run syncs each source in turn; a failing source is recorded
in its SyncRun and never affects the others.

Accuracy rules (students must never be sent to a wrong or expired link):
* only https links on the provider's own domain are stored;
* non-core roles (HR, finance, sales, marketing, legal, pure IT/software)
  are dropped; every kept job is classified into one of the 8 core branches;
* a job not seen in 2 consecutive *successful* syncs of its source, or that
  the provider reports inactive, becomes ``expired`` (hidden from students);
* postings older than 45 days are hidden; expired rows are pruned after 30
  days; at most 2000 active external jobs are kept.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
from datetime import timedelta
from typing import Dict, Iterable, List, Optional, Tuple

import httpx
from sqlalchemy import func
from sqlmodel import Session, select

from ..db import (
    ExternalApplicationLog, ExternalJob, LiveResource, PlatformSetting, SavedExternalJob, SyncRun, engine, utc_now,
)
from . import skills_vocab as V
from .live_sources import JOB_SOURCES, PROVIDERS, RESOURCE_SOURCES, SOURCE_PRIORITY
from .live_sources.base import TIMEOUT, USER_AGENT, FetchResult, RawJob, RawResource, https_on_domain, safe_error
from .live_sources.smartrecruiters import DEFAULT_COMPANIES

log = logging.getLogger("ats-platform.live_sync")

CORE_BRANCHES = ["mechanical", "civil", "eee", "ece", "chemical", "aerospace", "automobile", "metallurgy"]
MAX_AGE_DAYS = 45
PRUNE_AFTER_DAYS = 30
MAX_ACTIVE_JOBS = 2000
MISSES_TO_EXPIRE = 2
RESOURCES_PER_SOURCE_BRANCH = 30
ENRICH_CONCURRENCY = 4
STALE_RUN = timedelta(minutes=20)
SETTINGS_KEY = "live_sync"

# Tests inject an httpx.MockTransport here; production uses the network.
TRANSPORT: Optional[httpx.AsyncBaseTransport] = None

# ── settings (durable, in PlatformSetting) ───────────────────────────────────

DEFAULT_SETTINGS = {
    "enabled": {name: True for name in PROVIDERS},
    "smartrecruiters_companies": list(DEFAULT_COMPANIES),
    "greenhouse_boards": [],
    "lever_boards": [],
}
_BOARD_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$")


def load_settings() -> dict:
    out = json.loads(json.dumps(DEFAULT_SETTINGS))
    try:
        with Session(engine) as s:
            row = s.get(PlatformSetting, SETTINGS_KEY)
            if row:
                saved = json.loads(row.value_json or "{}")
                if isinstance(saved, dict):
                    out["enabled"].update({k: bool(v) for k, v in (saved.get("enabled") or {}).items() if k in PROVIDERS})
                    for k in ("smartrecruiters_companies", "greenhouse_boards", "lever_boards"):
                        if isinstance(saved.get(k), list):
                            out[k] = [str(x) for x in saved[k]]
    except Exception as exc:  # pragma: no cover - settings must never break a sync
        log.warning("live_sync settings unreadable: %s", exc)
    return out


def clean_board_list(values: Iterable, field: str) -> List[str]:
    out: List[str] = []
    for v in values or []:
        v = str(v).strip()
        if not v:
            continue
        if not _BOARD_RE.match(v):
            raise ValueError(f"Invalid id in {field}: {v[:40]!r} (letters, digits, - _ . only)")
        if v.lower() not in {x.lower() for x in out}:
            out.append(v)
    if len(out) > 25:
        raise ValueError(f"At most 25 entries in {field}")
    return out


def save_settings(changes: dict) -> dict:
    cur = load_settings()
    if "enabled" in changes and changes["enabled"] is not None:
        for k, v in changes["enabled"].items():
            if k not in PROVIDERS:
                raise ValueError(f"Unknown source {k!r}")
            cur["enabled"][k] = bool(v)
    for k in ("smartrecruiters_companies", "greenhouse_boards", "lever_boards"):
        if changes.get(k) is not None:
            cur[k] = clean_board_list(changes[k], k)
    with Session(engine) as s:
        row = s.get(PlatformSetting, SETTINGS_KEY)
        if row:
            row.value_json = json.dumps(cur)
            row.updated_at = utc_now()
        else:
            s.add(PlatformSetting(key=SETTINGS_KEY, value_json=json.dumps(cur)))
        s.commit()
    return cur


# ── classification ───────────────────────────────────────────────────────────

def _rx(words: Iterable[str]) -> re.Pattern:
    return re.compile(r"(?<![a-z0-9])(?:" + "|".join(words) + r")(?![a-z0-9])", re.I)


DROP_TITLE = _rx([
    r"hr", r"human resources?", r"recruit\w*", r"talent acquisition", r"payroll", r"people partner",
    r"finance", r"financial", r"accountant", r"accounting", r"accounts? (?:payable|receivable|executive|manager)",
    r"tax", r"treasury", r"fp&a", r"financial controller",
    r"sales", r"business development", r"bdm?", r"key account", r"account manager", r"pre-?sales",
    r"marketing", r"brand", r"digital marketing", r"seo", r"social media", r"public relations", r"communications? (?:manager|specialist)",
    r"legal", r"counsel", r"lawyer", r"paralegal", r"company secretary", r"secretary",
    r"customer (?:service|support|care)", r"call cent(?:er|re)", r"receptionist", r"front office", r"office (?:assistant|administrator)",
    r"administrative", r"admin(?:istrative)? assistant", r"executive assistant", r"data entry",
    r"graphic designer", r"content writer", r"copywriter", r"translator",
    r"teacher", r"nurse", r"doctor", r"pharmacist", r"driver", r"security guard", r"housekeeping", r"chef", r"cook",
])
SOFT_DROP = _rx([r"audit\w*", r"procurement", r"purchas\w*", r"buyer", r"sourcing", r"logistics", r"supply chain", r"warehouse", r"analyst"])
SOFTWARE_TITLE = _rx([
    r"software", r"developer", r"sde", r"programmer", r"full[- ]?stack", r"front[- ]?end", r"back[- ]?end", r"web",
    r"java", r"python", r"\.net", r"c#", r"react", r"angular", r"node(?:\.?js)?", r"golang", r"php",
    r"devops", r"devsecops", r"sre", r"site reliability", r"cloud", r"aws", r"azure", r"gcp", r"kubernetes",
    r"data scien\w*", r"data analy\w*", r"data engineer\w*", r"big data", r"machine learning", r"ml", r"ai", r"llm", r"genai",
    r"deep learning", r"computer vision", r"nlp", r"sap", r"salesforce", r"servicenow", r"oracle", r"erp", r"crm",
    r"it", r"it support", r"helpdesk", r"service desk", r"cyber\s?security", r"security analyst", r"soc", r"network engineer",
    r"qa", r"test automation", r"automation tester", r"manual tester", r"selenium", r"ui", r"ux", r"ui/ux", r"mobile app",
    r"android", r"ios", r"database", r"dba", r"sql", r"business analyst", r"scrum master", r"product owner", r"product manager",
    r"solution architect", r"technical support", r"application support",
])
HARDWARE_OVERRIDE = _rx([
    r"embedded", r"firmware", r"hardware", r"electrical", r"electronics?", r"vlsi", r"fpga", r"asic", r"rtl", r"pcb",
    r"autosar", r"plc", r"scada", r"ecu", r"analog", r"micro-?controller", r"bms", r"powertrain", r"vehicle", r"automotive",
    r"device drivers?", r"bsp", r"hil", r"can bus", r"simulink", r"avionics", r"mechatronics", r"robotics", r"motor control",
    r"power electronics", r"instrumentation", r"dcs",
])

TITLE_KEYWORDS: Dict[str, re.Pattern] = {
    "mechanical": _rx([
        r"mechanical", r"mech", r"cad", r"cae", r"fea", r"hvac", r"piping", r"manufacturing", r"production engineer",
        r"maintenance engineer", r"tool(?:ing)? design", r"machine design", r"thermal", r"mechatronics", r"product design",
        r"plant engineer", r"npd", r"machining", r"cnc", r"solidworks", r"creo", r"catia", r"gd&t", r"design engineer",
        r"tool room", r"fixture", r"sheet metal", r"injection mo(?:u)?ld\w*", r"industrial engineer", r"robotics",
    ]),
    "civil": _rx([
        r"civil", r"structural", r"site engineer", r"construction", r"quantity survey\w*", r"surveyor", r"highway",
        r"bridge", r"geotechnical", r"bim", r"billing engineer", r"execution engineer", r"estimation engineer",
        r"planning engineer", r"building", r"infrastructure engineer", r"water resources", r"tunnel\w*", r"rcc",
    ]),
    "eee": _rx([
        r"electrical", r"power systems?", r"power electronics", r"substation", r"switchgear", r"transformers?", r"plc",
        r"scada", r"instrumentation", r"motors?", r"drives", r"protection engineer", r"energy", r"solar", r"commissioning",
        r"e&i", r"high voltage", r"hv", r"grid", r"electrician", r"dcs", r"control panel", r"wind",
    ]),
    "ece": _rx([
        r"electronics?", r"embedded", r"firmware", r"vlsi", r"fpga", r"asic", r"rtl", r"pcb", r"hardware", r"rf", r"analog",
        r"signal processing", r"dsp", r"telecom\w*", r"iot", r"semiconductor", r"antenna", r"wireless", r"design verification",
        r"physical design", r"board design", r"sensors?", r"chip", r"soc design", r"ece", r"communication engineer",
    ]),
    "chemical": _rx([
        r"chemical", r"process engineer", r"refinery", r"petrochemical", r"polymer", r"process safety", r"hazop",
        r"distillation", r"pharma\w*", r"process technologist", r"chemist", r"oil (?:and|&) gas", r"fertili[sz]er", r"plant process",
    ]),
    "aerospace": _rx([
        r"aerospace", r"aeronautic\w*", r"aircraft", r"avionics", r"propulsion", r"flight", r"airframe", r"satellite",
        r"spacecraft", r"aero", r"gas turbine", r"mro", r"airworthiness", r"jet engine", r"rocket", r"helicopter", r"uav", r"drone",
    ]),
    "automobile": _rx([
        r"automotive", r"automobile", r"vehicles?", r"powertrain", r"chassis", r"ev", r"electric vehicles?", r"autosar",
        r"brakes?", r"homologation", r"calibration engineer", r"nvh", r"battery", r"bms", r"transmission", r"engine", r"adas",
        r"tyres?", r"tires?", r"two[- ]wheeler", r"railway", r"rail", r"locomotive",
    ]),
    "metallurgy": _rx([
        r"metallurg\w*", r"materials? engineer", r"materials? scien\w*", r"welding", r"heat treatment", r"foundry",
        r"casting", r"forging", r"corrosion", r"ndt", r"steel", r"metallograph\w*", r"rolling mill", r"smelter",
    ]),
}

_BRANCH_RAW_SKILLS = {
    "mechanical": V.MECHANICAL_SKILLS, "civil": V.CIVIL_SKILLS, "eee": V.EEE_SKILLS, "ece": V.ECE_SKILLS,
    "chemical": V.CHEMICAL_SKILLS, "aerospace": V.AEROSPACE_SKILLS, "automobile": V.AUTOMOBILE_SKILLS,
    "metallurgy": V.METALLURGY_SKILLS,
}
_GENERIC_SKILLS = {"pumps", "compressors", "sops", "reactors", "systems engineering", "communication protocols", "transmission"}


def _skill_patterns(skills: Iterable[str]) -> List[Tuple[str, re.Pattern]]:
    out = []
    for sk in skills:
        if sk.lower() in _GENERIC_SKILLS:
            continue
        variants = [sk]
        m = re.match(r"^(.*?)\s*\((.*?)\)\s*$", sk)
        if m:
            variants = [m.group(1), m.group(2)]
        pats = [re.escape(v.strip()) for v in variants if len(v.strip()) >= 2]
        if pats:
            out.append((sk, re.compile(r"(?<![a-z0-9])(?:" + "|".join(pats) + r")(?![a-z0-9])", re.I)))
    return out


BRANCH_SKILL_PATTERNS = {b: _skill_patterns(s) for b, s in _BRANCH_RAW_SKILLS.items()}
SOFTWARE_SKILL_PATTERNS = _skill_patterns(V.SOFTWARE_SKILLS)
# Sanity: every core branch exists in the shared vocabulary.
assert all(b in V.BRANCH_SKILLS for b in CORE_BRANCHES)

_PRIORITY = ["ece", "eee", "automobile", "aerospace", "chemical", "metallurgy", "civil", "mechanical"]


def classify(title: str, description: str = "", hint: Optional[str] = None) -> Tuple[Optional[str], List[str], str]:
    """→ (branch | None, skills found, reason). None means: not a core engineering role."""
    t = (title or "").strip()
    if not t:
        return None, [], "no title"
    if DROP_TITLE.search(t):
        return None, [], "non-core role"
    if SOFT_DROP.search(t) and not re.search(r"engineer", t, re.I) and not any(p.search(t) for p in TITLE_KEYWORDS.values()):
        return None, [], "non-core role"
    software_title = bool(SOFTWARE_TITLE.search(t))
    if software_title and not HARDWARE_OVERRIDE.search(t):
        return None, [], "software / IT role"
    desc = (description or "")[:8000]
    scores: Dict[str, float] = {}
    found: Dict[str, List[str]] = {}
    for b in CORE_BRANCHES:
        title_hits = len(set(m.group(0).lower() for m in TITLE_KEYWORDS[b].finditer(t)))
        skills = [sk for sk, p in BRANCH_SKILL_PATTERNS[b] if p.search(t) or p.search(desc)]
        title_skill = sum(1 for sk, p in BRANCH_SKILL_PATTERNS[b] if p.search(t))
        desc_kw = len(set(m.group(0).lower() for m in TITLE_KEYWORDS[b].finditer(desc[:3000])))
        score = 3 * title_hits + 3 * title_skill + min(len(skills), 6) + min(desc_kw, 3) * 0.5
        if hint == b:
            score += 1
        scores[b] = score
        found[b] = skills
    best = max(_PRIORITY, key=lambda b: (scores[b], -_PRIORITY.index(b)))
    if scores[best] < 3:
        return None, [], "no core-branch signal"
    # A title without any branch keyword whose description is mostly software → IT role.
    if not TITLE_KEYWORDS[best].search(t):
        sw = sum(1 for _, p in SOFTWARE_SKILL_PATTERNS if p.search(desc))
        if sw >= 4 and sw > 2 * len(found[best]):
            return None, [], "software / IT role"
    return best, found[best][:10], "ok"


# ── dedupe ───────────────────────────────────────────────────────────────────

_COMPANY_NOISE = re.compile(r"\b(private|pvt|limited|ltd|llp|inc|corp(oration)?|co|gmbh|ag|group|india|the)\b", re.I)
_CITY_SYN = {"bengaluru": "bangalore", "bombay": "mumbai", "madras": "chennai", "gurugram": "gurgaon", "mysuru": "mysore", "new delhi": "delhi"}


def _norm(s: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def dedupe_key(company: str, title: str, city: Optional[str]) -> str:
    c = re.sub(r"\s+", "", _COMPANY_NOISE.sub(" ", _norm(company)))
    ci = _norm(city)
    ci = _CITY_SYN.get(ci, ci)
    return f"{c}|{_norm(title)}|{ci.replace(' ', '')}"


def _prio(source: str) -> int:
    return SOURCE_PRIORITY.get(source, 9)


# ── run bookkeeping ──────────────────────────────────────────────────────────

_LOCK = threading.Lock()


def is_running() -> bool:
    if _LOCK.locked():
        return True
    with Session(engine) as s:
        row = s.exec(select(SyncRun).where(SyncRun.status == "running").order_by(SyncRun.started_at.desc())).first()
        return bool(row and row.started_at > utc_now() - STALE_RUN)


def mark_interrupted_runs() -> int:
    """Called at startup: the API runs as a single process, so any run still
    marked 'running' was killed by a restart/redeploy. Without this a
    redeploy would block new syncs until STALE_RUN passed."""
    n = 0
    with Session(engine) as s:
        for row in s.exec(select(SyncRun).where(SyncRun.status == "running")).all():
            row.status = "error"
            row.error = row.error or "interrupted (server restarted)"
            row.finished_at = row.finished_at or utc_now()
            s.add(row)
            n += 1
        s.commit()
    return n


def sources_for(kind: str) -> List[str]:
    if kind == "jobs":
        return list(JOB_SOURCES)
    if kind == "resources":
        return list(RESOURCE_SOURCES)
    return list(JOB_SOURCES) + list(RESOURCE_SOURCES)


def run_sync_blocking(kind: str = "all", triggered_by: str = "admin", only: Optional[List[str]] = None) -> dict:
    """Entry point for BackgroundTasks (runs in a worker thread)."""
    if not _LOCK.acquire(blocking=False):
        return {"started": False, "reason": "already running"}
    try:
        return asyncio.run(run_sync(kind, triggered_by, only))
    except Exception as exc:  # pragma: no cover - defensive; per-source errors are recorded already
        log.exception("live sync crashed")
        return {"started": True, "error": safe_error(exc)}
    finally:
        _LOCK.release()


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                             transport=TRANSPORT, follow_redirects=True)


async def run_sync(kind: str = "all", triggered_by: str = "admin", only: Optional[List[str]] = None) -> dict:
    settings = load_settings()
    names = [n for n in sources_for(kind) if not only or n in only]
    results = []
    async with _client() as client:
        for name in names:
            results.append(await sync_source(client, name, settings, triggered_by))
    if any(PROVIDERS[n].kind == "jobs" for n in names):
        results_cleanup = cleanup_jobs()
    else:
        results_cleanup = {}
    prune_runs()
    return {"started": True, "kind": kind, "sources": results, "cleanup": results_cleanup}


async def sync_source(client: httpx.AsyncClient, name: str, settings: dict, triggered_by: str = "admin") -> dict:
    provider = PROVIDERS[name]
    if not settings["enabled"].get(name, True):
        return {"source": name, "status": "disabled"}
    with Session(engine) as s:
        run = SyncRun(kind=provider.kind, source=name, triggered_by=triggered_by)
        s.add(run)
        s.commit()
        s.refresh(run)
        run_id = run.id
    stats = {"fetched": 0, "added": 0, "updated": 0, "expired": 0}
    status, error = "ok", None
    reason = provider.not_configured_reason(settings) if not provider.configured(settings) else None
    if reason:
        status, error = "skipped", reason
    else:
        try:
            result = await provider.fetch(client, settings)
            stats["fetched"] = len(result.items)
            with Session(engine) as s2:  # show progress in the admin status while details load
                live = s2.get(SyncRun, run_id)
                if live:
                    live.fetched = stats["fetched"]
                    s2.add(live)
                    s2.commit()
            if provider.kind == "jobs":
                stats.update(await ingest_jobs(client, provider, result))
            else:
                stats.update(ingest_resources(provider, result))
            if result.errors:
                status, error = "partial", "; ".join(result.errors)[:1000]
        except Exception as exc:
            status, error = "error", safe_error(exc)[:1000]
            log.warning("[live-sync] %s failed: %s", name, error)
    with Session(engine) as s:
        run = s.get(SyncRun, run_id)
        run.status = status
        run.error = error
        run.finished_at = utc_now()
        for k, v in stats.items():
            setattr(run, k, int(v))
        s.add(run)
        s.commit()
    return {"source": name, "status": status, "error": error, **stats}


# ── jobs ingest ──────────────────────────────────────────────────────────────

def _apply_raw(row: ExternalJob, raw: RawJob, branch: str, skills: List[str], apply_url: str, posting_url: Optional[str]) -> bool:
    fields = {
        "company_name": raw.company_name[:200], "company_slug": raw.company_slug, "title": raw.title[:300],
        "description_text": raw.description_text or row.description_text or "", "location_text": raw.location_text[:200],
        "city": raw.city, "country": raw.country, "remote_type": raw.remote_type, "job_type": raw.job_type,
        "experience_level": raw.experience_level, "branch": branch, "skills_json": json.dumps(skills),
        "apply_url": apply_url, "posting_url": posting_url, "salary_min": raw.salary_min, "salary_max": raw.salary_max,
        "posted_at": raw.posted_at or row.posted_at, "source_version": raw.version,
        "dedupe_key": dedupe_key(raw.company_name, raw.title, raw.city),
    }
    changed = False
    for k, v in fields.items():
        if getattr(row, k) != v:
            setattr(row, k, v)
            changed = True
    return changed


async def ingest_jobs(client: httpx.AsyncClient, provider, result: FetchResult) -> dict:
    name = provider.name
    now = utc_now()
    cutoff = now - timedelta(days=MAX_AGE_DAYS)
    added = updated = expired = 0

    with Session(engine) as s:
        existing = {e.external_id: e for e in s.exec(select(ExternalJob).where(ExternalJob.source == name)).all()}
        snapshot = {k: (e.source_version, bool(e.description_text), e.apply_url, e.posting_url, e.description_text) for k, e in existing.items()}

    # Postings already rejected after a detail fetch (non-core) — don't refetch until they change.
    rejected_key = f"live_sync_rejected:{name}"
    with Session(engine) as s:
        rrow = s.get(PlatformSetting, rejected_key)
        try:
            rejected: Dict[str, str] = json.loads(rrow.value_json) if rrow else {}
        except ValueError:
            rejected = {}
    new_rejected: Dict[str, str] = {}

    batch: Dict[str, RawJob] = {}
    for raw in result.items:
        if raw.external_id and raw.external_id not in batch:
            batch[raw.external_id] = raw
    seen = set(batch)

    # Cheap filters first so we only call detail endpoints for jobs we may keep.
    dropped: Dict[str, str] = {}
    to_enrich: List[RawJob] = []
    for ext_id, raw in batch.items():
        if not raw.title or DROP_TITLE.search(raw.title) or (SOFTWARE_TITLE.search(raw.title) and not HARDWARE_OVERRIDE.search(raw.title)):
            dropped[ext_id] = "non-core"
            continue
        if raw.posted_at and raw.posted_at < cutoff:
            dropped[ext_id] = "too old"
            continue
        if not raw.has_detail and ext_id not in snapshot and raw.version and rejected.get(ext_id) == raw.version:
            dropped[ext_id] = "non-core"
            new_rejected[ext_id] = raw.version
            continue
        if not raw.has_detail:
            snap = snapshot.get(ext_id)
            if snap and snap[0] == raw.version and snap[1] and snap[2]:
                raw.description_text = snap[4]
                raw.apply_url = raw.apply_url or snap[2]
                raw.posting_url = raw.posting_url or snap[3]
                raw.has_detail = True
            else:
                to_enrich.append(raw)

    failed: set = set()
    sem = asyncio.Semaphore(ENRICH_CONCURRENCY)

    async def enrich(raw: RawJob):
        async with sem:
            try:
                await provider.enrich(client, raw)
            except Exception as exc:
                failed.add(raw.external_id)
                if len(result.errors) < 10:
                    result.errors.append(f"detail {raw.external_id}: {safe_error(exc)}")

    if to_enrich:
        await asyncio.gather(*(enrich(r) for r in to_enrich))

    with Session(engine) as s:
        rows = {e.external_id: e for e in s.exec(select(ExternalJob).where(ExternalJob.source == name)).all()}
        active_by_key: Dict[str, ExternalJob] = {}
        for e in s.exec(select(ExternalJob).where(ExternalJob.status == "active")).all():
            if e.dedupe_key:
                cur = active_by_key.get(e.dedupe_key)
                if cur is None or (_prio(e.source), e.id) < (_prio(cur.source), cur.id):
                    active_by_key[e.dedupe_key] = e

        def expire(row: Optional[ExternalJob]):
            nonlocal expired
            if row is not None and row.status == "active":
                row.status = "expired"
                row.last_checked_at = now
                s.add(row)
                expired += 1

        for ext_id, raw in batch.items():
            row = rows.get(ext_id)
            if ext_id in dropped:
                expire(row)
                continue
            if ext_id in failed:
                if row is not None:  # keep what we know, don't publish anything new we couldn't verify
                    row.last_seen_at = now
                    row.miss_count = 0
                    s.add(row)
                continue
            if not raw.active:
                expire(row)
                continue
            apply_url = https_on_domain(raw.apply_url, provider.domains)
            posting_url = https_on_domain(raw.posting_url, provider.domains)
            if not apply_url:
                expire(row)
                continue
            branch, skills, _why = classify(raw.title, raw.description_text, raw.branch_hint)
            if not branch:
                if raw.version:
                    new_rejected[ext_id] = raw.version
                expire(row)
                continue
            key = dedupe_key(raw.company_name, raw.title, raw.city)
            winner = active_by_key.get(key)
            is_dup = bool(winner and (winner.source, winner.external_id) != (name, ext_id)
                          and (_prio(winner.source), winner.id) < (_prio(name), row.id if row and row.id else 10 ** 12))
            if row is None:
                if is_dup:
                    continue
                row = ExternalJob(source=name, external_id=ext_id, first_seen_at=now)
                _apply_raw(row, raw, branch, skills, apply_url, posting_url)
                row.last_seen_at = row.last_checked_at = now
                s.add(row)
                s.flush()
                active_by_key[key] = row
                added += 1
                continue
            changed = _apply_raw(row, raw, branch, skills, apply_url, posting_url)
            row.last_seen_at = row.last_checked_at = now
            row.miss_count = 0
            if row.status == "expired":
                row.status = "active"
                changed = True
            if is_dup and row.status == "active":
                row.status = "expired"
                expired += 1
            elif row.status == "active":
                active_by_key.setdefault(key, row)
            s.add(row)
            if changed:
                updated += 1

        # Misses → expiry, only after a complete, successful listing.
        if result.complete:
            for ext_id, row in rows.items():
                if ext_id in seen or row.status == "hidden":
                    continue
                if result.complete_scopes is not None and row.company_slug not in result.complete_scopes:
                    continue
                if row.status != "active":
                    continue
                row.miss_count = (row.miss_count or 0) + 1
                row.last_checked_at = now
                if row.miss_count >= MISSES_TO_EXPIRE:
                    row.status = "expired"
                    expired += 1
                s.add(row)
        rrow = s.get(PlatformSetting, rejected_key)
        payload = json.dumps(dict(list(new_rejected.items())[:5000]))
        if rrow:
            rrow.value_json = payload
            rrow.updated_at = now
            s.add(rrow)
        elif new_rejected:
            s.add(PlatformSetting(key=rejected_key, value_json=payload))
        s.commit()
    return {"added": added, "updated": updated, "expired": expired}


def cleanup_jobs() -> dict:
    now = utc_now()
    out = {"too_old": 0, "pruned": 0, "capped": 0}
    with Session(engine) as s:
        for row in s.exec(select(ExternalJob).where(ExternalJob.status == "active", ExternalJob.posted_at < now - timedelta(days=MAX_AGE_DAYS))).all():
            row.status = "expired"
            s.add(row)
            out["too_old"] += 1
        keep = set(s.exec(select(ExternalApplicationLog.external_job_id).where(ExternalApplicationLog.action == "applied")).all())
        keep |= set(s.exec(select(SavedExternalJob.external_job_id)).all())
        old = s.exec(select(ExternalJob).where(ExternalJob.status == "expired", ExternalJob.last_seen_at < now - timedelta(days=PRUNE_AFTER_DAYS))).all()
        for row in old:
            if row.id in keep:
                if row.description_text:
                    row.description_text = ""   # keep the tracking record, drop the bulk
                    s.add(row)
                continue
            s.delete(row)
            out["pruned"] += 1
        n_active = s.exec(select(func.count()).select_from(ExternalJob).where(ExternalJob.status == "active")).one()
        if n_active > MAX_ACTIVE_JOBS:
            extra = s.exec(select(ExternalJob).where(ExternalJob.status == "active")
                           .order_by(ExternalJob.posted_at.asc(), ExternalJob.id.asc()).limit(n_active - MAX_ACTIVE_JOBS)).all()
            for row in extra:
                row.status = "expired"
                s.add(row)
                out["capped"] += 1
        s.commit()
    return out


def prune_runs(keep: int = 500) -> None:
    with Session(engine) as s:
        ids = s.exec(select(SyncRun.id).order_by(SyncRun.started_at.desc()).offset(keep)).all()
        for i in ids:
            row = s.get(SyncRun, i)
            if row:
                s.delete(row)
        # runs that died with the process
        for row in s.exec(select(SyncRun).where(SyncRun.status == "running", SyncRun.started_at < utc_now() - STALE_RUN)).all():
            row.status = "error"
            row.error = row.error or "interrupted (server restarted)"
            row.finished_at = row.finished_at or utc_now()
            s.add(row)
        s.commit()


# ── resources ingest ─────────────────────────────────────────────────────────

def ingest_resources(provider, result: FetchResult) -> dict:
    added = updated = 0
    with Session(engine) as s:
        seen = set()
        for r in result.items:
            if not isinstance(r, RawResource) or r.branch not in CORE_BRANCHES:
                continue
            url = https_on_domain(r.url, provider.domains)
            if not url or url in seen:
                continue
            seen.add(url)
            row = s.exec(select(LiveResource).where(LiveResource.source == provider.name, LiveResource.url == url)).first()
            if row is None:
                s.add(LiveResource(branch=r.branch, kind=r.kind, title=r.title, url=url, source=provider.name, author=r.author,
                                   summary=r.summary, thumbnail_url=r.thumbnail_url, published_at=r.published_at, created_by=provider.name))
                added += 1
            else:
                changed = False
                for k in ("title", "author", "summary", "thumbnail_url", "published_at"):
                    v = getattr(r, k)
                    if v and getattr(row, k) != v:
                        setattr(row, k, v)
                        changed = True
                if changed:
                    s.add(row)
                    updated += 1
        s.commit()
        # keep the newest N per (source, branch); admin items are never pruned
        expired = 0
        for b in CORE_BRANCHES:
            old = s.exec(select(LiveResource).where(LiveResource.source == provider.name, LiveResource.branch == b)
                         .order_by(LiveResource.published_at.desc(), LiveResource.id.desc()).offset(RESOURCES_PER_SOURCE_BRANCH)).all()
            for row in old:
                s.delete(row)
                expired += 1
        s.commit()
    return {"added": added, "updated": updated, "expired": expired}


# ── status ───────────────────────────────────────────────────────────────────

def _iso(d):
    return d.replace(microsecond=0).isoformat() + "Z" if d else None


def run_dict(r: SyncRun) -> dict:
    return {"id": r.id, "kind": r.kind, "source": r.source, "status": r.status, "started_at": _iso(r.started_at),
            "finished_at": _iso(r.finished_at), "fetched": r.fetched, "added": r.added, "updated": r.updated,
            "expired": r.expired, "error": r.error, "triggered_by": r.triggered_by,
            "duration_s": round((r.finished_at - r.started_at).total_seconds(), 1) if r.finished_at and r.started_at else None}


def status_snapshot(history: int = 30) -> dict:
    import os

    settings = load_settings()
    out = []
    with Session(engine) as s:
        job_counts = dict(s.exec(select(ExternalJob.source, func.count()).where(ExternalJob.status == "active").group_by(ExternalJob.source)).all())
        exp_counts = dict(s.exec(select(ExternalJob.source, func.count()).where(ExternalJob.status == "expired").group_by(ExternalJob.source)).all())
        res_counts = dict(s.exec(select(LiveResource.source, func.count()).where(LiveResource.status == "active").group_by(LiveResource.source)).all())
        for name, p in PROVIDERS.items():
            last = s.exec(select(SyncRun).where(SyncRun.source == name).order_by(SyncRun.started_at.desc())).first()
            last_ok = s.exec(select(SyncRun).where(SyncRun.source == name, SyncRun.status.in_(["ok", "partial"])).order_by(SyncRun.started_at.desc())).first()
            configured = p.configured(settings)
            out.append({
                "source": name, "kind": p.kind, "label": p.label, "enabled": settings["enabled"].get(name, True),
                "configured": configured, "reason": None if configured else p.not_configured_reason(settings),
                "keys": p.key_status(), "needs_key": bool(p.key_env),
                "active": job_counts.get(name, 0) if p.kind == "jobs" else res_counts.get(name, 0),
                "expired_total": exp_counts.get(name, 0) if p.kind == "jobs" else None,
                "last_run": run_dict(last) if last else None, "last_success": run_dict(last_ok) if last_ok else None,
            })
        runs = [run_dict(r) for r in s.exec(select(SyncRun).order_by(SyncRun.started_at.desc()).limit(history)).all()]
        totals = {
            "active_jobs": s.exec(select(func.count()).select_from(ExternalJob).where(ExternalJob.status == "active")).one(),
            "expired_jobs": s.exec(select(func.count()).select_from(ExternalJob).where(ExternalJob.status == "expired")).one(),
            "hidden_jobs": s.exec(select(func.count()).select_from(ExternalJob).where(ExternalJob.status == "hidden")).one(),
            "resources": s.exec(select(func.count()).select_from(LiveResource).where(LiveResource.status == "active")).one(),
            "admin_notes": s.exec(select(func.count()).select_from(LiveResource).where(LiveResource.source == "admin")).one(),
        }
    keys = {k: bool((os.environ.get(k) or "").strip()) for k in
            ("ADZUNA_APP_ID", "ADZUNA_APP_KEY", "JOOBLE_API_KEY", "YOUTUBE_API_KEY", "LIVE_SYNC_TOKEN")}
    return {"running": is_running(), "sources": out, "runs": runs, "totals": totals, "keys": keys, "settings": settings,
            "limits": {"max_age_days": MAX_AGE_DAYS, "prune_after_days": PRUNE_AFTER_DAYS, "max_active_jobs": MAX_ACTIVE_JOBS,
                       "misses_to_expire": MISSES_TO_EXPIRE}}


async def test_company(provider: str, ident: str) -> dict:
    p = PROVIDERS.get(provider)
    if p is None or not hasattr(p, "test"):
        raise ValueError("provider must be smartrecruiters, greenhouse or lever")
    if not _BOARD_RE.match(ident or ""):
        raise ValueError("Invalid id (letters, digits, - _ . only)")
    async with _client() as client:
        try:
            r = await p.test(client, ident)
            return {"ok": True, "provider": provider, "id": ident, **r}
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            return {"ok": False, "provider": provider, "id": ident, "count": 0,
                    "error": "Not found — check the id" if code == 404 else f"HTTP {code}"}
        except Exception as exc:
            return {"ok": False, "provider": provider, "id": ident, "count": 0, "error": safe_error(exc)}
