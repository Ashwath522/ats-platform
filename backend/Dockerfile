FROM python:3.11-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FASTEMBED_CACHE_DIR=/app/models

# libmagic1: real content-type sniffing for uploads (python-magic).
RUN apt-get update && apt-get install -y --no-install-recommends libmagic1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-nlp.txt ./
RUN pip install -r requirements.txt && pip install -r requirements-nlp.txt

# Bake the ONNX embedding model (all-MiniLM-L6-v2, ~90 MB) into the image so
# cold starts on free hosts don't download it on the first request.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('sentence-transformers/all-MiniLM-L6-v2', cache_dir='/app/models')"

COPY . .
RUN mkdir -p /app/data

EXPOSE 8000

# One worker: the embedding model is loaded per process; 512 MB free-tier
# instances fit exactly one. $PORT is provided by Render/Railway/Fly.
# start.sh is fail-closed: a failed `alembic upgrade head` stops the container
# before uvicorn starts (tested in tests/test_startup_migrations.py).
CMD ["sh", "/app/start.sh"]
