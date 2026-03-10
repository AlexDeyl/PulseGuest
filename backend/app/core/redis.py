from __future__ import annotations

import logging
from typing import Optional

from redis.asyncio import Redis

from app.core.config import settings


logger = logging.getLogger(__name__)

_redis: Optional[Redis] = None


def get_redis() -> Optional[Redis]:
    """Return a singleton Redis client.

    We keep it lazy so that importing this module never tries to connect.
    """
    global _redis
    if _redis is not None:
        return _redis

    url = (settings.REDIS_URL or "").strip()
    if not url:
        logger.warning("REDIS_URL is empty; password reset flow will be disabled")
        return None

    # decode_responses=True -> we get str values instead of bytes
    _redis = Redis.from_url(url, decode_responses=True)
    return _redis
