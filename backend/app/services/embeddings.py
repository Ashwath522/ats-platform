"""Local embedding model. No network calls → low latency, no per-request API cost.

Default: all-MiniLM-L6-v2 (fast CPU model, ~80MB, good for resume/JD similarity).
Optional: set EMBEDDING_MODEL env var to use a higher-quality model, e.g.:
  - all-mpnet-base-v2         (~420MB, significantly better quality)
  - BAAI/bge-small-en-v1.5    (~130MB, good accuracy/speed tradeoff)

Model loads once at process start via singleton; only one instance per process.
"""
import os
from sentence_transformers import SentenceTransformer

_EMBEDDING_MODEL_NAME = os.environ.get("EMBEDDING_MODEL", "all-MiniLM-L6-v2")


class EmbeddingModel:
    _instance = None

    def __init__(self, model_name: str = _EMBEDDING_MODEL_NAME):
        self.model = SentenceTransformer(model_name)

    @classmethod
    def get(cls) -> "EmbeddingModel":
        # Singleton so the model is loaded into memory exactly once per process
        if cls._instance is None:
            cls._instance = EmbeddingModel()
        return cls._instance

    def embed_text(self, text: str):
        vec = self.model.encode(text, convert_to_numpy=True, normalize_embeddings=True)
        return vec.tolist()

    def embed_texts(self, texts):
        arr = self.model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
        return [v.tolist() for v in arr]
