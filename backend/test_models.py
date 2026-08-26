import os
import sys
from dotenv import load_dotenv
load_dotenv()
sys.path.insert(0, os.path.abspath("."))
from app.services.groq_client import GroqClient
from app.services.gemini_client import GeminiClient

groq_client = GroqClient(os.environ.get("GROQ_API_KEY", ""))
try:
    print("Groq models:", groq_client.available_models())
except Exception as e:
    print("Groq models error:", e)

gemini_client = GeminiClient(os.environ.get("GEMINI_API_KEY", ""))
try:
    print("Gemini models:", gemini_client.available_models())
except Exception as e:
    print("Gemini models error:", e)
