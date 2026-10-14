FROM python:3.11-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FASTEMBED_CACHE_DIR=/app/models

# libmagic1: real content-type sniffing for uploads (python-magic).
RUN apt-get update && apt-get install -y --no-install-recommends libmagic1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

# Bake the ONNX embedding model (all-MiniLM-L6-v2, ~90 MB) into the image so
# cold starts on free hosts don't download it on the first request.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('sentence-transformers/all-MiniLM-L6-v2', cache_dir='/app/models')"

COPY . .
RUN mkdir -p /app/data

EXPOSE 8000

# One worker: the embedding model is loaded per process; 512 MB free-tier
# instances fit exactly one. $PORT is provided by Render/Railway/Fly.
# Schema is created/updated by init_db() at startup. Alembic only runs once
# an alembic.ini exists (see MIGRATIONS.md), so a missing config can never
# block the server from starting.
CMD ["sh", "-c", "if [ -f alembic.ini ]; then alembic upgrade head || echo 'alembic upgrade failed - continuing with init_db()'; fi; exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
