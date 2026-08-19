"""Local embedding model. No network calls -> low latency, no per-request API cost.

all-MiniLM-L6-v2 runs on CPU in a few ms per document and is good enough for
resume/JD semantic similarity. Model loads once at process start and is reused.
"""
from sentence_transformers import SentenceTransformer


class EmbeddingModel:
    _instance = None

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
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
