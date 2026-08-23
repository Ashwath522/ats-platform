import os

from dotenv import load_dotenv

load_dotenv()  # loads backend/.env if present; no-op (and no error) if it doesn't exist

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from .db import init_db
from .api import candidate, recruiter, auth
from .api import candidate_auth, candidate_profile, candidate_jobs, candidate_posts
from .api import recruiter_jobs, admin

app = FastAPI(title="ATS Platform API")

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

from .api.auth import limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected server error occurred.", "error": str(exc)},
    )

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


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/")
async def root():
    return {"status": "ok", "service": "ats-platform-backend"}
