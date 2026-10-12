"""Local embedding model. No network calls at inference → low latency, no per-request API cost.

Two interchangeable backends compute the *same* model (all-MiniLM-L6-v2):

  * ``fastembed`` (default) – ONNX Runtime, ~150 MB RAM, no PyTorch. Fits the
    512 MB free tier on Render / Railway / Fly.
  * ``sentence-transformers`` – PyTorch. Heavier (~1 GB RAM) but lets you use
    any HF model. Select with ``EMBEDDING_BACKEND=sentence-transformers``.

The backend is auto-selected: fastembed if installed, otherwise
sentence-transformers. Override with the ``EMBEDDING_BACKEND`` env var.

Optional: set EMBEDDING_MODEL to change the model (must be supported by the
chosen backend), e.g. ``BAAI/bge-small-en-v1.5``.

Model loads once per process via a singleton.
"""
import logging
import os
from typing import List

logger = logging.getLogger("ats-platform")

_EMBEDDING_MODEL_NAME = os.environ.get("EMBEDDING_MODEL", "all-MiniLM-L6-v2")


def _resolve_backend() -> str:
    forced = os.environ.get("EMBEDDING_BACKEND", "").strip().lower()
    if forced in {"fastembed", "sentence-transformers", "sentence_transformers"}:
        return "sentence-transformers" if forced.startswith("sentence") else "fastembed"
    try:
        import fastembed  # noqa: F401
        return "fastembed"
    except Exception:
        return "sentence-transformers"


class _FastEmbedBackend:
    def __init__(self, model_name: str):
        from fastembed import TextEmbedding

        # fastembed uses the fully-qualified HF id
        if "/" not in model_name:
            model_name = f"sentence-transformers/{model_name}"
        cache_dir = os.environ.get("FASTEMBED_CACHE_DIR")
        self.model = TextEmbedding(model_name=model_name, cache_dir=cache_dir) if cache_dir else TextEmbedding(model_name=model_name)

    def encode(self, texts: List[str]) -> List[List[float]]:
        import numpy as np

        out = []
        for vec in self.model.embed(texts):
            v = np.asarray(vec, dtype="float32")
            n = float(np.linalg.norm(v)) or 1.0
            out.append((v / n).tolist())
        return out


class _SentenceTransformersBackend:
    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(model_name)

    def encode(self, texts: List[str]) -> List[List[float]]:
        arr = self.model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
        return [v.tolist() for v in arr]


class _HashingBackend:
    """Dependency-free fallback: signed feature hashing of word unigrams and
    bigrams into 384 dims. Much weaker than a real model; used only when the
    model cannot be loaded (e.g. no network on first boot) so the API keeps
    working instead of crashing. ``/health`` reports when this is active."""

    DIM = 384

    def encode(self, texts: List[str]) -> List[List[float]]:
        import hashlib
        import re

        import numpy as np

        out = []
        for text in texts:
            v = np.zeros(self.DIM, dtype="float32")
            toks = re.findall(r"[a-z0-9+#.]+", (text or "").lower())
            feats = toks + [f"{a}_{b}" for a, b in zip(toks, toks[1:])]
            for f in feats:
                h = int(hashlib.md5(f.encode()).hexdigest(), 16)
                v[h % self.DIM] += 1.0 if (h >> 8) & 1 else -1.0
            n = float(np.linalg.norm(v)) or 1.0
            out.append((v / n).tolist())
        return out


class EmbeddingModel:
    _instance = None

    def __init__(self, model_name: str = _EMBEDDING_MODEL_NAME):
        self.backend_name = _resolve_backend()
        if os.environ.get("EMBEDDING_BACKEND", "").strip().lower() == "hash":
            self.backend_name = "hash"
        try:
            if self.backend_name == "hash":
                self._backend = _HashingBackend()
            elif self.backend_name == "fastembed":
                self._backend = _FastEmbedBackend(model_name)
            else:
                self._backend = _SentenceTransformersBackend(model_name)
        except Exception as exc:
            if os.environ.get("EMBEDDING_FALLBACK", "on").lower() in {"0", "off", "false"}:
                raise
            logger.error("[EMBEDDINGS] could not load %s (%s): %s — using degraded hashing fallback",
                         model_name, self.backend_name, exc)
            self.backend_name = "hash-fallback"
            self._backend = _HashingBackend()
        logger.info("[EMBEDDINGS] backend=%s model=%s", self.backend_name, model_name)

    @classmethod
    def get(cls) -> "EmbeddingModel":
        # Singleton so the model is loaded into memory exactly once per process
        if cls._instance is None:
            cls._instance = EmbeddingModel()
        return cls._instance

    def embed_text(self, text: str):
        return self._backend.encode([text or ""])[0]

    def embed_texts(self, texts):
        return self._backend.encode([t or "" for t in texts])
