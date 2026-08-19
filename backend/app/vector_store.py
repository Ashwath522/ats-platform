import os
import chromadb


class VectorStore:
    def __init__(self, persist_directory: str = "data/chroma"):
        os.makedirs(persist_directory, exist_ok=True)
        self.client = chromadb.PersistentClient(path=persist_directory)

    def get_or_create_collection(self, name: str):
        return self.client.get_or_create_collection(name)

    def add_document(self, collection_name: str, doc_id: str, document: str, metadata: dict, embedding: list):
        coll = self.get_or_create_collection(collection_name)
        coll.upsert(
            ids=[doc_id],
            documents=[document],
            metadatas=[metadata],
            embeddings=[embedding],
        )

    def query_collection(self, collection_name: str, query_embedding: list, n_results: int = 10):
        coll = self.get_or_create_collection(collection_name)
        count = coll.count()
        if count == 0:
            return []
        res = coll.query(
            query_embeddings=[query_embedding],
            n_results=min(n_results, count),
            # "embeddings" included so callers can reuse each candidate's stored vector
            # instead of re-running the embedding model on every request (see recruiter.py).
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

    def get_document(self, collection_name: str, doc_id: str):
        coll = self.get_or_create_collection(collection_name)
        res = coll.get(ids=[doc_id], include=["documents", "metadatas"])
        if res and res.get("ids"):
            return {
                "id": res["ids"][0],
                "document": res["documents"][0],
                "metadata": res["metadatas"][0],
            }
        return None
