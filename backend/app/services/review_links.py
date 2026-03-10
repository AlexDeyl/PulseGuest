from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse


_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*://")
# domain.tld[/...], optional :port
_DOMAIN_RE = re.compile(r"^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(:\d+)?(/|$)", re.IGNORECASE)


def _strip(raw: Any) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def normalize_http_url(raw: Any) -> str | None:
    """Soft normalizer:
    - empty -> None
    - if scheme missing but looks like domain -> prepend https://
    """
    s = _strip(raw)
    if not s:
        return None
    if _SCHEME_RE.match(s):
        return s
    # allow schemeless domains like yandex.ru/maps/.. or 2gis.ru/..
    if _DOMAIN_RE.match(s):
        return f"https://{s}"
    return s


def is_valid_http_url(raw: Any) -> bool:
    s = normalize_http_url(raw)
    if not s:
        return False
    try:
        p = urlparse(s)
    except Exception:
        return False
    if p.scheme not in ("http", "https"):
        return False
    if not p.netloc:
        return False
    return True


def validate_review_links(payload: dict[str, Any]) -> dict[str, str | None]:
    """Soft validation.
    Returns mapping field -> error_code or None. Does NOT raise.
    """
    out: dict[str, str | None] = {"yandex_url": None, "twogis_url": None}

    y = payload.get("yandex_url")
    t = payload.get("twogis_url")

    if _strip(y) and not is_valid_http_url(y):
        out["yandex_url"] = "invalid_url"
    if _strip(t) and not is_valid_http_url(t):
        out["twogis_url"] = "invalid_url"

    return out


def extract_org_group_review_links(org_settings: dict[str, Any] | None, group_key: str) -> dict[str, str | None]:
    s = org_settings or {}
    by_group = s.get("review_links_by_group") or {}
    if not isinstance(by_group, dict):
        by_group = {}
    raw = by_group.get(str(group_key)) or {}
    if not isinstance(raw, dict):
        raw = {}
    return {
        "yandex_url": normalize_http_url(raw.get("yandex_url")),
        "twogis_url": normalize_http_url(raw.get("twogis_url")),
    }


def extract_org_default_review_links(org_settings: dict[str, Any] | None) -> dict[str, str | None]:
    s = org_settings or {}
    raw = s.get("review_links_default") or {}
    if not isinstance(raw, dict):
        raw = {}
    return {
        "yandex_url": normalize_http_url(raw.get("yandex_url")),
        "twogis_url": normalize_http_url(raw.get("twogis_url")),
    }


def extract_location_review_links(loc_settings: dict[str, Any] | None) -> dict[str, Any]:
    s = loc_settings or {}
    raw = s.get("review_links") or {}
    if not isinstance(raw, dict):
        raw = {}
    inherit_raw = raw.get("inherit")
    inherit = True if inherit_raw is None else bool(inherit_raw)
    return {
        "inherit": inherit,
        "yandex_url": normalize_http_url(raw.get("yandex_url")),
        "twogis_url": normalize_http_url(raw.get("twogis_url")),
    }


def compute_effective_review_links(
    *,
    org_settings: dict[str, Any] | None,
    group_key: str,
    location_settings: dict[str, Any] | None,
) -> dict[str, str] | None:
    """Returns validated, effective links for public UI.

    Inheritance rule:
      location override (inherit=False) > org group default > org default > none

    Invalid links are ignored.
    """
    loc_cfg = extract_location_review_links(location_settings)

    candidate: dict[str, str | None]
    if loc_cfg.get("inherit") is False:
        candidate = {
            "yandex_url": loc_cfg.get("yandex_url"),
            "twogis_url": loc_cfg.get("twogis_url"),
        }
    else:
        grp = extract_org_group_review_links(org_settings, group_key)
        dflt = extract_org_default_review_links(org_settings)
        candidate = {
            "yandex_url": grp.get("yandex_url") or dflt.get("yandex_url"),
            "twogis_url": grp.get("twogis_url") or dflt.get("twogis_url"),
        }

    out: dict[str, str] = {}
    y = candidate.get("yandex_url")
    t = candidate.get("twogis_url")

    if is_valid_http_url(y):
        out["yandex_url"] = normalize_http_url(y)  # type: ignore[assignment]
    if is_valid_http_url(t):
        out["twogis_url"] = normalize_http_url(t)  # type: ignore[assignment]

    return out or None
