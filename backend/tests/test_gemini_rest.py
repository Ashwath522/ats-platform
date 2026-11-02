"""REST replacement for the deprecated google.generativeai SDK (no network: httpx is mocked)."""
import httpx
import pytest
from PIL import Image

from app.services import gemini_rest as genai


class FakeResp:
    def __init__(self, status, data):
        self.status_code, self._data, self.text = status, data, str(data)

    def json(self):
        return self._data


def test_generate_content_text_image_and_config(monkeypatch):
    seen = {}

    def post(url, params, json, timeout):
        seen.update(url=url, params=params, json=json, timeout=timeout)
        return FakeResp(200, {"candidates": [{"content": {"parts": [{"text": "hello "}, {"text": "world"}]}}]})

    monkeypatch.setattr(httpx, "post", post)
    genai.configure(api_key="k1")
    model = genai.GenerativeModel("models/gemini-2.5-flash")
    out = model.generate_content(["describe", Image.new("RGB", (8, 8))],
                                 generation_config=genai.types.GenerationConfig(max_output_tokens=10, temperature=0.1),
                                 request_options={"timeout": 5})
    assert out.text == "hello world"
    assert seen["url"].endswith("/models/gemini-2.5-flash:generateContent") and seen["params"] == {"key": "k1"} and seen["timeout"] == 5
    parts = seen["json"]["contents"][0]["parts"]
    assert parts[0] == {"text": "describe"} and parts[1]["inline_data"]["mime_type"] == "image/png"
    assert seen["json"]["generationConfig"] == {"maxOutputTokens": 10, "temperature": 0.1}


def test_rate_limit_message_keeps_429_and_hides_key(monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: FakeResp(429, {"error": {"message": "Resource exhausted for key k2"}}))
    genai.configure(api_key="k2")
    with pytest.raises(genai.GeminiAPIError) as e:
        genai.GenerativeModel("gemini-2.5-flash").generate_content("x")
    assert "429" in str(e.value) and "k2" not in str(e.value)


def test_list_models_and_client_integration(monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: FakeResp(200, {"models": [
        {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]},
        {"name": "models/embedding-001", "supportedGenerationMethods": ["embedContent"]}]}))
    from app.services.gemini_client import GeminiClient
    c = GeminiClient("k3")
    assert c._available and c.available_models() == ["gemini-2.5-flash"]
