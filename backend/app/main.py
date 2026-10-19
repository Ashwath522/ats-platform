import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # loads backend/.env if present; no-op (and no error) if it doesn't exist
if os.environ.get("SENTRY_DSN"):
    import sentry_sdk
    sentry_sdk.init(dsn=os.environ["SENTRY_DSN"], traces_sample_rate=0.1, send_default_pii=False)

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .db import init_db, engine
from . import perf
from .db_pool import DisconnectRetryMiddleware, tune_engine
from .db_indexes import ensure_indexes
from starlette.middleware.gzip import DEFAULT_EXCLUDED_CONTENT_TYPES, GZipMiddleware

# Round-trip budget tuning for a far-away Postgres + per-request query counter
# (counter is a no-op unless PERF_LOG=1 or a test is counting).
tune_engine(engine)
perf.install(engine)
from .api import candidate, recruiter, auth
from .api import candidate_auth, candidate_profile, candidate_jobs, candidate_posts
from .api import recruiter_jobs, recruiter_profile, admin, interview
from .api import student_portal, recruiter_portal, hiring, admin_portal, notifications, live_data, google_auth, linkedin_auth
from .api import proctoring, company_directory, job_match
from .services.media_utils import MEDIA_DIR
from .rate_limit import RateLimitExceeded, _rate_limit_exceeded_handler, limiter

logger = logging.getLogger("ats-platform")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    ensure_indexes(engine)  # idempotent CREATE INDEX IF NOT EXISTS (1 query when nothing is missing)
    auth.ensure_admin_user()
    try:
        from .services.live_sync import mark_interrupted_runs
        mark_interrupted_runs()
    except Exception:  # never block startup on bookkeeping
        logger.exception("[STARTUP] could not reset interrupted live-sync runs")
    try:  # proctoring evidence retention (PROCTOR_RETENTION_DAYS, default 90)
        proctoring.purge_old_proctor_evidence()
    except Exception:
        logger.exception("[STARTUP] proctoring retention sweep failed")

    # Log database configuration
    db_type = "PostgreSQL" if "postgres" in engine.url.drivername else "SQLite"
    logger.info("[STARTUP] Database: %s (%s)", db_type, engine.url.database or "local")

    # One-line runtime LLM operational mode log
    groq_key = os.environ.get("GROQ_API_KEY", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    ollama_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    ollama_model = os.environ.get("OLLAMA_MODEL", "llama3.2")

    from .services.deep_analysis import _ollama_is_reachable

    if groq_key:
        logger.info("[STARTUP] LLM Mode: Groq free tier active (GROQ_API_KEY set)")
    elif gemini_key:
        logger.info("[STARTUP] LLM Mode: Google Gemini free tier active (GEMINI_API_KEY set)")
    elif _ollama_is_reachable():
        logger.info("[STARTUP] LLM Mode: Running with local Ollama — zero-cost operation, no external LLM calls (Model: %s @ %s)", ollama_model, ollama_url)
    else:
        logger.info("[STARTUP] LLM Mode: Deterministic-only scoring active — no cloud API keys or local Ollama detected")

    try:
        import asyncio as _asyncio
        from .services.llm_stream import model_refresh_loop
        if os.environ.get("TESTING") != "1":
            _asyncio.get_event_loop().create_task(model_refresh_loop())
    except Exception:
        logger.exception("[STARTUP] OpenRouter model check skipped")
    try:
        from .services import live_scheduler
        live_scheduler.start()
    except Exception:
        logger.exception("[STARTUP] live-sync scheduler not started")
    yield
    try:
        from .services import live_scheduler
        await live_scheduler.stop()
    except Exception:
        pass


app = FastAPI(title="ATS Platform API", lifespan=lifespan)

# CORS_ORIGINS env var: comma-separated list of allowed origins, e.g.
# "https://app.example.com,https://admin.example.com". Defaults to "*" for
# local dev - set this explicitly before any real deployment.
_cors_origins_env = os.environ.get("CORS_ORIGINS", "*")
allow_origins = ["*"] if _cors_origins_env.strip() == "*" else [
    o.strip() for o in _cors_origins_env.split(",") if o.strip()
]

# JSON payloads (job lists, pipelines, dashboards) compress 5-10x. Streaming
# interview turns (ndjson) must stay unbuffered, so they are excluded.
app.add_middleware(
    GZipMiddleware,
    minimum_size=1024,
    exclude_content_types=DEFAULT_EXCLUDED_CONTENT_TYPES + ("application/x-ndjson", "application/pdf"),
)
app.add_middleware(DisconnectRetryMiddleware)
if perf.perf_enabled():
    app.add_middleware(perf.PerfMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Query-Count", "X-DB-Checkouts", "Server-Timing"],
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_debug_errors = os.environ.get("DEBUG_ERRORS", "").lower() in ("1", "true", "yes")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    content = {"detail": "An unexpected server error occurred."}
    if _debug_errors:
        content["error"] = str(exc)
    return JSONResponse(status_code=500, content=content)

# Original routers
app.include_router(candidate.router)
app.include_router(recruiter.router)
app.include_router(auth.router)

# New portal routers
app.include_router(candidate_auth.router)
app.include_router(candidate_profile.router)
app.include_router(candidate_jobs.router)
app.include_router(candidate_posts.router)
app.include_router(recruiter_jobs.router)
app.include_router(recruiter_profile.router)
app.include_router(admin.router)
app.include_router(interview.router)
app.include_router(google_auth.router)
app.include_router(linkedin_auth.router)
for _r in (student_portal, recruiter_portal, hiring, admin_portal, notifications, live_data, proctoring, company_directory, job_match):
    app.include_router(_r.router)

# Aliases for candidate project-upload and simplified status without /profile prefix
from .api.candidate_profile import upload_candidate_project, get_candidate_status
from .api.recruiter_jobs import run_repo_verification_batch, schedule_interviews_batch, generate_final_shortlist
app.add_api_route("/candidate/project-upload", upload_candidate_project, methods=["POST"])
app.add_api_route("/api/candidate/project-upload", upload_candidate_project, methods=["POST"])
app.add_api_route("/candidate/status", get_candidate_status, methods=["GET"])
app.add_api_route("/api/candidate/status", get_candidate_status, methods=["GET"])
app.add_api_route("/recruiter/jobs/{job_id}/repo-verify", run_repo_verification_batch, methods=["POST"])
app.add_api_route("/recruiter/jobs/{job_id}/schedule-interviews", schedule_interviews_batch, methods=["POST"])
app.add_api_route("/recruiter/jobs/{job_id}/final-shortlist", generate_final_shortlist, methods=["POST"])

# Serve avatars, cover photos and certification files. Disk first, then the
# database mirror (MediaBlob) so uploads survive restarts on ephemeral hosts.
@app.get("/media/{media_path:path}")
async def serve_media(media_path: str):
    from fastapi import HTTPException
    from fastapi.responses import Response
    from .services.media_utils import load_media

    found = load_media(media_path)
    if not found:
        raise HTTPException(status_code=404, detail="Not found")
    data, ctype = found
    return Response(content=data, media_type=ctype, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/")
async def root():
    return {"status": "ok", "service": "ats-platform-backend"}


@app.get("/health")
async def health_check(deep: int = 0):
    """
    Production health check:
    1. Verifies database read/write connectivity.
    2. Reports reachability status for optional AI providers (Groq, Gemini, Ollama).
    Returns HTTP 200 on healthy database, HTTP 503 if database connectivity fails.
    """
    if not deep:
        return {"status": "ok", "database": {"status": "unknown"}}
    import datetime
    import httpx
    from sqlmodel import text, Session
    from .db import engine, utc_now
    db_healthy = False
    db_error = None
    try:
        with Session(engine) as session:
            session.exec(text("SELECT 1")).one()
            db_healthy = True
    except Exception as exc:
        db_error = str(exc)

    # Check AI Providers
    ai_status = {}

    # Groq / Gemini / OpenRouter: probe with the SAME base URL, key and model
    # names the AI interviewer uses (async, parallel, 4 s budget). The old SDK
    # checks blocked the event loop (sync calls + retries) and swallowed the
    # error, so a failing provider only showed "reachable: false".
    # deep=2 also sends a 1-token chat completion to the fast model.
    from .services import llm_stream

    try:
        probes = await llm_stream.probe_providers(chat=deep >= 2, timeout=4.0)
    except Exception as exc:  # pragma: no cover
        probes = {}
        logger.warning("[HEALTH] LLM probe failed: %s", exc)
    for name in ("groq", "gemini", "openrouter"):
        ai_status[name] = probes.get(name) or {"configured": False, "reachable": False}
    if "custom" in probes:
        ai_status["custom"] = probes["custom"]

    # Ollama
    ollama_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    try:
        res = httpx.get(f"{ollama_url}/api/tags", timeout=0.8)
        ai_status["ollama"] = {
            "configured": True,
            "reachable": res.status_code == 200,
            "base_url": ollama_url,
        }
    except Exception:
        ai_status["ollama"] = {
            "configured": bool(os.environ.get("OLLAMA_BASE_URL")),
            "reachable": False,
            "base_url": ollama_url,
        }

    status_code = 200 if db_healthy else 503
    payload = {
        "status": "ok" if db_healthy else "degraded",
        "timestamp": utc_now().isoformat() + "Z",
        "database": {
            "status": "connected" if db_healthy else "error",
            "type": "postgres" if "postgres" in engine.url.drivername else "sqlite",
            "error": db_error,
        },
        "ai_providers": ai_status,
        "interview_llm_order": [p.name for p in llm_stream.configured_providers()],
    }
    return JSONResponse(status_code=status_code, content=payload)
