FROM python:3.11-slim

WORKDIR /app

# System deps needed by some resume-parsing libs (pdfplumber pulls in pillow/etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Persisted at runtime via a volume (see docker-compose.yml): sqlite db, chroma
# vector store, and uploaded resume files all live here.
RUN mkdir -p /app/data

# NOTE: the sentence-transformers model (~90MB) downloads from Hugging Face on
# first request unless pre-fetched. To bake it into the image instead (recommended
# for production, avoids a slow/flaky first request), uncomment:
# RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

EXPOSE 8000

# --workers 1 because the embedding model is loaded per-process (see embeddings.py
# singleton) - multiple workers would each load their own copy of the model into
# memory. Scale by running multiple containers behind a load balancer instead if
# you need more throughput, not by bumping --workers here.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
