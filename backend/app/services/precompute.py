"""Small background runner for slow student analyses (resume insights, best-fit jobs).

Pages always answer from the last saved result; when that result is missing or
out of date, the work is queued here and the page picks up the fresh result on
its next poll. Each job key runs at most once at a time.

Tests set ``SYNC = True`` (or TESTING=1) so queued work runs inline.
"""
from __future__ import annotations

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

logger = logging.getLogger("ats-platform")

SYNC = os.environ.get("TESTING") == "1"
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="precompute")
_running: set = set()
_lock = threading.Lock()


def is_running(key: str) -> bool:
    with _lock:
        return key in _running


def submit(key: str, fn: Callable, *args, **kwargs) -> bool:
    """Queue fn(*args) under `key`. Returns False if that key is already queued/running."""
    with _lock:
        if key in _running:
            return False
        _running.add(key)

    def run():
        try:
            fn(*args, **kwargs)
        except Exception as e:  # noqa: BLE001
            logger.warning("precompute %s failed: %s", key, e)
        finally:
            with _lock:
                _running.discard(key)

    if SYNC:
        run()
    else:
        _pool.submit(run)
    return True
