"""Vector store with two interchangeable backends.

* ``chroma`` – local ChromaDB on disk (original behaviour). Needs a persistent
  disk.
* ``db``     – embeddings stored in the main SQL database (``VectorDoc``
  table). Works on hosts with an ephemeral filesystem (Render free tier) when
  paired with a hosted Postgres such as Neon. Similarity is computed in
  Python with NumPy, which is plenty fast for thousands of resumes.

Selection: ``VECTOR_BACKEND`` env var (``chroma`` | ``db``). Default is ``db``
when ``DATABASE_URL`` is set or ChromaDB is not installed, else ``chroma``.
"""
import json
import os
from typing import Optional


def _resolve_backend() -> str:
    forced = os.environ.get("VECTOR_BACKEND", "").strip().lower()
    if forced in {"chroma", "db"}:
        return forced
    if os.environ.get("DATABASE_URL"):
        return "db"
    try:
        import chromadb  # noqa: F401
        return "chroma"
    except Exception:
        return "db"


class _ChromaStore:
    def __init__(self, persist_directory: str):
        import chromadb

        os.makedirs(persist_directory, exist_ok=True)
        self.client = chromadb.PersistentClient(path=persist_directory)

    def get_or_create_collection(self, name: str):
        return self.client.get_or_create_collection(name)

    def add_document(self, collection_name, doc_id, document, metadata, embedding):
        coll = self.get_or_create_collection(collection_name)
        coll.upsert(ids=[doc_id], documents=[document], metadatas=[metadata], embeddings=[embedding])

    def query_collection(self, collection_name, query_embedding, n_results=10):
        coll = self.get_or_create_collection(collection_name)
        count = coll.count()
        if count == 0:
            return []
        res = coll.query(
            query_embeddings=[query_embedding],
            n_results=min(n_results, count),
            include=["metadatas", "documents", "distances", "embeddings"],
        )
        out = []
        for i in range(len(res["ids"][0])):
            out.append({
                "id": res["ids"][0][i],
                "document": res["documents"][0][i],
                "metadata": res["metadatas"][0][i],
                "distance": res["distances"][0][i],
                "embedding": res["embeddings"][0][i],
            })
        return out

    def get_document(self, collection_name, doc_id):
        coll = self.get_or_create_collection(collection_name)
        res = coll.get(ids=[doc_id], include=["documents", "metadatas"])
        if res and res.get("ids"):
            return {"id": res["ids"][0], "document": res["documents"][0], "metadata": res["metadatas"][0]}
        return None


class _DbStore:
    """SQL-backed store. Distances mimic Chroma's default (squared L2 on
    normalised vectors) so downstream code that converts distance → similarity
    keeps working unchanged."""

    def add_document(self, collection_name, doc_id, document, metadata, embedding):
        from sqlmodel import Session, select
        from .db import engine, VectorDoc, utc_now

        with Session(engine) as session:
            row = session.exec(
                select(VectorDoc).where(VectorDoc.collection == collection_name, VectorDoc.doc_id == doc_id)
            ).first()
            if row is None:
                row = VectorDoc(collection=collection_name, doc_id=doc_id)
            row.document = document or ""
            row.metadata_json = json.dumps(metadata or {})
            row.embedding_json = json.dumps([float(x) for x in (embedding or [])])
            row.updated_at = utc_now()
            session.add(row)
            session.commit()

    def query_collection(self, collection_name, query_embedding, n_results=10):
        import numpy as np
        from sqlmodel import Session, select
        from .db import engine, VectorDoc

        with Session(engine) as session:
            rows = session.exec(select(VectorDoc).where(VectorDoc.collection == collection_name)).all()
        if not rows:
            return []
        q = np.asarray(query_embedding, dtype="float32")
        scored = []
        for r in rows:
            emb = json.loads(r.embedding_json or "[]")
            if not emb:
                continue
            v = np.asarray(emb, dtype="float32")
            dist = float(np.sum((q - v) ** 2))
            scored.append((dist, r, emb))
        scored.sort(key=lambda t: t[0])
        return [
            {
                "id": r.doc_id,
                "document": r.document,
                "metadata": json.loads(r.metadata_json or "{}"),
                "distance": dist,
                "embedding": emb,
            }
            for dist, r, emb in scored[:n_results]
        ]

    def get_document(self, collection_name, doc_id):
        from sqlmodel import Session, select
        from .db import engine, VectorDoc

        with Session(engine) as session:
            r = session.exec(
                select(VectorDoc).where(VectorDoc.collection == collection_name, VectorDoc.doc_id == doc_id)
            ).first()
            if not r:
                return None
            return {"id": r.doc_id, "document": r.document, "metadata": json.loads(r.metadata_json or "{}")}


class VectorStore:
    def __init__(self, persist_directory: str = "data/chroma", backend: Optional[str] = None):
        self.backend_name = backend or _resolve_backend()
        self._impl = _ChromaStore(persist_directory) if self.backend_name == "chroma" else _DbStore()

    def add_document(self, collection_name: str, doc_id: str, document: str, metadata: dict, embedding: list):
        return self._impl.add_document(collection_name, doc_id, document, metadata, embedding)

    def query_collection(self, collection_name: str, query_embedding: list, n_results: int = 10):
        return self._impl.query_collection(collection_name, query_embedding, n_results)

    def get_document(self, collection_name: str, doc_id: str):
        return self._impl.get_document(collection_name, doc_id)
