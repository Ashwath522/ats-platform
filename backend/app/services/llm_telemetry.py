import json
import logging
import time
from contextlib import contextmanager
from typing import Optional, Dict, Any

telemetry_logger = logging.getLogger("ai_telemetry")
if not telemetry_logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[AI_TELEMETRY] %(message)s"))
    telemetry_logger.addHandler(handler)
    telemetry_logger.setLevel(logging.INFO)


@contextmanager
def trace_llm_call(provider: str, model: str, operation: str, extra: Optional[Dict[str, Any]] = None):
    """
    Context manager for measuring and logging structured telemetry for an LLM call.
    Logs provider, model, latency_ms, status, error, and metadata.
    """
    start = time.perf_counter()
    record = {
        "timestamp": time.time(),
        "provider": provider,
        "model": model,
        "operation": operation,
        "success": False,
        "latency_ms": 0.0,
        "error": None,
    }
    if extra:
        record.update(extra)

    try:
        yield record
        record["success"] = True
    except Exception as exc:
        record["success"] = False
        record["error"] = str(exc)
        raise
    finally:
        record["latency_ms"] = round((time.perf_counter() - start) * 1000, 2)
        try:
            telemetry_logger.info(json.dumps(record))
        except Exception:
            telemetry_logger.info(str(record))
