import os

from dotenv import load_dotenv

load_dotenv()  # loads backend/.env if present; no-op (and no error) if it doesn't exist

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .api import candidate, recruiter, auth

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

app.include_router(candidate.router)
app.include_router(recruiter.router)
app.include_router(auth.router)


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/")
async def root():
    return {"status": "ok", "service": "ats-platform-backend"}
