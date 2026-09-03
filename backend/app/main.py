import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # loads backend/.env if present; no-op (and no error) if it doesn't exist

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db, engine
from .api import candidate, recruiter, auth
from .api import candidate_auth, candidate_profile, candidate_jobs, candidate_posts
from .api import recruiter_jobs, admin
from .rate_limit import RateLimitExceeded, _rate_limit_exceeded_handler, limiter

logger = logging.getLogger("ats-platform")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    auth.ensure_admin_user()

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

    yield


app = FastAPI(title="ATS Platform API", lifespan=lifespan)

# CORS_ORIGINS env var: comma-separated list of allowed origins, e.g.
# "https://app.example.com,https://admin.example.com". Defaults to "*" for
# local dev - set this explicitly before any real deployment.
_cors_origins_env = os.environ.get("CORS_ORIGINS", "*")
allow_origins = ["*"] if _cors_origins_env.strip() == "*" else [
    o.strip() for o in _cors_origins_env.split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
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
app.include_router(admin.router)

# Aliases for candidate project-upload and simplified status without /profile prefix
from .api.candidate_profile import upload_candidate_project, get_candidate_status
from .api.recruiter_jobs import run_repo_verification_batch
app.add_api_route("/candidate/project-upload", upload_candidate_project, methods=["POST"])
app.add_api_route("/api/candidate/project-upload", upload_candidate_project, methods=["POST"])
app.add_api_route("/candidate/status", get_candidate_status, methods=["GET"])
app.add_api_route("/api/candidate/status", get_candidate_status, methods=["GET"])
app.add_api_route("/recruiter/jobs/{job_id}/repo-verify", run_repo_verification_batch, methods=["POST"])


@app.get("/")
async def root():
    return {"status": "ok", "service": "ats-platform-backend"}


@app.get("/health")
async def health_check():
    """
    Production health check:
    1. Verifies database read/write connectivity.
    2. Reports reachability status for optional AI providers (Groq, Gemini, Ollama).
    Returns HTTP 200 on healthy database, HTTP 503 if database connectivity fails.
    """
    import datetime
    import httpx
    from sqlmodel import text, Session
    from .db import engine, utc_now
    from .services.groq_client import GroqClient
    from .services.gemini_client import GeminiClient

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

    # Groq
    groq_key = os.environ.get("GROQ_API_KEY", "")
    if groq_key:
        try:
            gc = GroqClient(groq_key)
            test_res = gc.test_connection()
            ai_status["groq"] = {
                "configured": True,
                "reachable": test_res.get("success", False) if isinstance(test_res, dict) else bool(test_res),
                "model": test_res.get("model") if isinstance(test_res, dict) else None,
            }
        except Exception as e:
            ai_status["groq"] = {"configured": True, "reachable": False, "error": str(e)}
    else:
        ai_status["groq"] = {"configured": False, "reachable": False}

    # Gemini
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    if gemini_key:
        try:
            gmc = GeminiClient(gemini_key)
            test_res = gmc.test_connection()
            ai_status["gemini"] = {
                "configured": True,
                "reachable": test_res.get("success", False) if isinstance(test_res, dict) else bool(test_res),
                "model": test_res.get("model") if isinstance(test_res, dict) else None,
            }
        except Exception as e:
            ai_status["gemini"] = {"configured": True, "reachable": False, "error": str(e)}
    else:
        ai_status["gemini"] = {"configured": False, "reachable": False}

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
    }
    return JSONResponse(status_code=status_code, content=payload)

