from __future__ import annotations

import re

from app.core.config import settings


_SCHEME_RE = re.compile(r"^https?://", re.IGNORECASE)


def _normalize_public_base() -> str:
    """Return normalized public base URL (no trailing slash).

    Priority:
      1) settings.PUBLIC_BASE_URL
      2) first entry from settings.CORS_ORIGINS
      3) "" (caller may decide what to do)
    """

    base = (settings.PUBLIC_BASE_URL or "").strip()
    if not base:
        cors = settings.cors_list()
        base = (cors[0] if cors else "").strip()

    base = base.rstrip("/")
    if base and not _SCHEME_RE.match(base):
        # If user provided "example.com" -> assume https.
        base = f"https://{base}"
    return base


def build_public_url(slug: str) -> str:
    """Build the public survey URL for a location slug.

    If PUBLIC_BASE_URL is not configured, we fallback to first CORS origin.
    As the last resort we return a relative path ("/<slug>")
    so that UI can still show/copy something in dev.
    """
    slug_norm = (slug or "").strip().lstrip("/")
    if not slug_norm:
        return "/"

    base = _normalize_public_base()
    if not base:
        return f"/{slug_norm}"
    return f"{base}/{slug_norm}"
