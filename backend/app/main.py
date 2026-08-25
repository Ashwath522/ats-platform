import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # loads backend/.env if present; no-op (and no error) if it doesn't exist

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .api import candidate, recruiter, auth
from .api import candidate_auth, candidate_profile, candidate_jobs, candidate_posts
from .api import recruiter_jobs, admin
from .rate_limit import RateLimitExceeded, _rate_limit_exceeded_handler, limiter

logger = logging.getLogger("ats-platform")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    auth.ensure_admin_user()
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


@app.get("/")
async def root():
    return {"status": "ok", "service": "ats-platform-backend"}
