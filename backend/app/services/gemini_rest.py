"""Minimal drop-in for the parts of the deprecated ``google.generativeai`` SDK this
app uses, implemented on Gemini's stable REST API (v1beta) with httpx.

Supported surface (exactly what gemini_client.py / scorer.py call):
    genai.configure(api_key=...)
    genai.list_models()                      -> objects with .name, .supported_generation_methods
    genai.types.GenerationConfig(**kwargs)   -> dict
    genai.GenerativeModel(name).generate_content(contents, generation_config=None, request_options=None)
        contents: str | list[str | PIL.Image.Image]  -> response with .text

Errors keep the old behaviour callers rely on: messages contain the HTTP status
("429", "quota", ...) so rate-limit detection keeps working.
"""
from __future__ import annotations

import base64
import io
import threading
from types import SimpleNamespace
from typing import Any, Optional

import httpx

BASE = "https://generativelanguage.googleapis.com/v1beta"
_local = threading.local()
_default_key: Optional[str] = None


class GeminiAPIError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(f"{status} {message}")
        self.status = status


def configure(api_key: str) -> None:
    """Per-thread key (clients for different rotated keys may run in parallel threads)."""
    global _default_key
    _local.api_key = api_key
    _default_key = api_key


def _key() -> str:
    key = getattr(_local, "api_key", None) or _default_key
    if not key:
        raise GeminiAPIError(401, "Gemini API key not configured")
    return key


def _raise_for(resp: httpx.Response) -> None:
    if resp.status_code != 200:
        try:
            msg = resp.json().get("error", {}).get("message", "")
        except Exception:
            msg = resp.text[:200]
        raise GeminiAPIError(resp.status_code, msg.replace(_key(), "***"))


def list_models():
    r = httpx.get(f"{BASE}/models", params={"key": _key(), "pageSize": 200}, timeout=15.0)
    _raise_for(r)
    return [SimpleNamespace(name=m.get("name", ""), supported_generation_methods=m.get("supportedGenerationMethods", []))
            for m in r.json().get("models", [])]


class _Types:
    @staticmethod
    def GenerationConfig(**kwargs) -> dict:
        return dict(kwargs)


types = _Types()

_CONFIG_KEYS = {"max_output_tokens": "maxOutputTokens", "temperature": "temperature", "top_p": "topP", "top_k": "topK",
                "candidate_count": "candidateCount", "stop_sequences": "stopSequences", "response_mime_type": "responseMimeType"}


def _part(item: Any) -> dict:
    if isinstance(item, str):
        return {"text": item}
    if isinstance(item, dict):
        return item
    if hasattr(item, "save"):                      # PIL image
        buf = io.BytesIO()
        fmt = (getattr(item, "format", None) or "PNG").upper()
        fmt = fmt if fmt in {"PNG", "JPEG", "WEBP"} else "PNG"
        item.save(buf, format=fmt)
        return {"inline_data": {"mime_type": f"image/{fmt.lower()}", "data": base64.b64encode(buf.getvalue()).decode()}}
    if isinstance(item, (bytes, bytearray)):
        return {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(bytes(item)).decode()}}
    return {"text": str(item)}


class GenerativeModel:
    def __init__(self, model_name: str):
        self.model_name = model_name.split("/")[-1]
        self._key = _key()

    def generate_content(self, contents, generation_config=None, request_options=None):
        items = contents if isinstance(contents, list) else [contents]
        body: dict = {"contents": [{"role": "user", "parts": [_part(i) for i in items]}]}
        if generation_config:
            cfg = dict(generation_config)
            body["generationConfig"] = {_CONFIG_KEYS.get(k, k): v for k, v in cfg.items() if v is not None}
        timeout = float((request_options or {}).get("timeout", 60.0))
        r = httpx.post(f"{BASE}/models/{self.model_name}:generateContent", params={"key": self._key}, json=body, timeout=timeout)
        _raise_for(r)
        data = r.json()
        cands = data.get("candidates") or []
        text = "".join(p.get("text", "") for p in ((cands[0].get("content") or {}).get("parts") or [])) if cands else ""
        return SimpleNamespace(text=text, raw=data)
