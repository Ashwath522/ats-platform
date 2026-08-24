import os
import sys

from fastapi.responses import JSONResponse

try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from slowapi.util import get_remote_address
except ModuleNotFoundError:
    class RateLimitExceeded(Exception):
        pass

    async def _rate_limit_exceeded_handler(request, exc):
        return JSONResponse(status_code=429, content={"detail": "Rate limit exceeded"})

    def get_remote_address(request):
        return request.client.host if request.client else "unknown"

    class Limiter:
        def __init__(self, *args, **kwargs):
            pass

        def limit(self, *args, **kwargs):
            def decorator(func):
                return func

            return decorator


limiter = Limiter(key_func=get_remote_address, enabled=not ("pytest" in sys.modules or os.getenv("TESTING") == "1"))
