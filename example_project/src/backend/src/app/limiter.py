"""Shared rate limiter configuration.

Uses Redis-backed storage when REDIS_URL is configured; otherwise falls back to
in-memory storage. This makes rate limiting effective on serverless/multi-process
runtimes such as Vercel.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings

if settings.redis_url:
    limiter = Limiter(
        key_func=get_remote_address,
        storage_uri=settings.redis_url,
    )
else:
    limiter = Limiter(key_func=get_remote_address)
