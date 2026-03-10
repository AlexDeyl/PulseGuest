from __future__ import annotations

import logging
import re
from typing import Any

from sqlalchemy import distinct, exists, func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.redis import get_redis
from app.models.role import Role
from app.models.token import UserRole
from app.models.user import User
from app.models.user_group_access import UserGroupAccess
from app.models.user_organization import UserOrganization


logger = logging.getLogger(__name__)

_SCHEME_RE = re.compile(r"^https?://", re.IGNORECASE)

def _safe_email(e: str) -> str | None:
    e = (e or "").strip().lower()
    if not e or "@" not in e or len(e) > 254:
        return None
    return e


async def acquire_negative_notify_lock(*, location_id: int) -> bool:
    """Best-effort cooldown per location to mitigate accidental double-submits.

    Returns True if we should send now, False if throttled.
    If Redis is unavailable -> allow (do not block notifications).
    """
    redis = get_redis()
    if redis is None:
        return True

    try:
        key = f"negnotify:cooldown:loc:{int(location_id)}"
        ok = await redis.set(
            key,
            "1",
            ex=int(settings.NEGATIVE_NOTIFY_COOLDOWN_SECONDS),
            nx=True,
        )
        return bool(ok)
    except Exception:
        logger.exception("negnotify: redis error during cooldown lock")
        return True


def build_negative_email(
    *,
    org_name: str,
    loc_name: str,
    loc_code: str | None,
    group_key: str,
    when_iso: str | None,
    score: int,
    scale: int,
    short_comment: str | None,
    admin_link: str,
) -> tuple[str, str]:
    subject = f"[PulseGuest] Негативный отзыв: {org_name} / {loc_name}"

    parts = [
        "Получен негативный отзыв гостя в PulseGuest.",
        "",
        "Просим принять меры по устранению причины негатива и оставить комментарий «Принятые меры» в карточке отзыва.",
        "",
        f"Открыть отзыв (нужен логин): {admin_link}",
        "",
        "Детали:",
        f"- Организация: {org_name}",
        f"- Локация: {loc_name}" + (f" ({loc_code})" if loc_code else ""),
        f"- Группа: {group_key}",
        f"- Дата/время: {when_iso or ''}",
        f"- Оценка: {score}/{scale}",
    ]
    if short_comment:
        parts.append(f"- Комментарий гостя: {short_comment}")

    parts.append("")
    parts.append("Это автоматическое уведомление PulseGuest.")
    body = "\n".join(parts)
    return subject, body


def compute_overall_score(answers: dict[str, Any], schema: dict[str, Any]) -> tuple[int, int] | None:
    """Compute overall score from answers and active survey schema.

    Returns (score, scale) where scale is expected to be 5 or 10.
    If we can't compute reliably, returns None (safe fallback).
    """
    if not isinstance(answers, dict) or not isinstance(schema, dict):
        return None

    meta = schema.get("meta") or {}
    primary_field = None
    if isinstance(meta, dict):
        primary_field = meta.get("primary_rating_field") or meta.get("primaryRatingField")

    slides = schema.get("slides") or []
    if not isinstance(slides, list):
        slides = []

    def _as_int(x: Any) -> int | None:
        try:
            if isinstance(x, bool):
                return None
            return int(x)
        except Exception:
            return None

    # 1) If primary field declared, try to find slide and scale
    if isinstance(primary_field, str) and primary_field.strip():
        f = primary_field.strip()
        raw = answers.get(f)
        score = _as_int(raw)
        if score is None:
            return None

        chosen_scale: int | None = None
        for s in slides:
            if not isinstance(s, dict):
                continue
            if (s.get("field") == f) and (s.get("type") in ("rating", "nps")):
                chosen_scale = _as_int(s.get("scale"))
                break

        if chosen_scale is None:
            if 1 <= score <= 5:
                chosen_scale = 5
            elif 0 <= score <= 10:
                chosen_scale = 10
            else:
                return None

        if chosen_scale not in (5, 10):
            return None
        return (score, chosen_scale)

    # 2) Otherwise: first rating/nps slide
    for s in slides:
        if not isinstance(s, dict):
            continue
        if s.get("type") not in ("rating", "nps"):
            continue
        field = s.get("field")
        if not isinstance(field, str) or not field.strip():
            continue
        raw = answers.get(field)
        score = _as_int(raw)
        if score is None:
            continue

        chosen_scale = _as_int(s.get("scale"))
        if chosen_scale is None:
            if 1 <= score <= 5:
                chosen_scale = 5
            elif 0 <= score <= 10:
                chosen_scale = 10
            else:
                continue

        if chosen_scale not in (5, 10):
            continue
        return (score, chosen_scale)

    return None


def is_negative(score: int, scale: int) -> bool:
    if scale == 5:
        return score <= 3
    if scale == 10:
        return score <= 6
    return False


def extract_short_comment(answers: dict[str, Any], schema: dict[str, Any], max_len: int = 240) -> str | None:
    """Best-effort short guest comment for email."""
    if not isinstance(answers, dict):
        return None

    def _clean(v: Any) -> str | None:
        if not isinstance(v, str):
            return None
        txt = v.strip()
        if not txt:
            return None
        if len(txt) > max_len:
            return txt[: max_len - 1] + "…"
        return txt

    c = _clean(answers.get("comment"))
    if c:
        return c

    slides = (schema or {}).get("slides") or []
    if isinstance(slides, list):
        for s in slides:
            if not isinstance(s, dict):
                continue
            if s.get("type") != "text":
                continue
            field = s.get("field")
            if isinstance(field, str) and field.strip():
                c2 = _clean(answers.get(field))
                if c2:
                    return c2

    return None


def build_admin_submission_link(submission_id: int) -> str:
    """Build a protected admin deep link to a submission."""
    base = (settings.FRONTEND_BASE_URL or "").strip()
    if not base:
        base = (settings.PUBLIC_BASE_URL or "").strip()
    if not base:
        cors = settings.cors_list()
        base = (cors[0] if cors else "").strip()

    base = base.rstrip("/")
    if base and not _SCHEME_RE.match(base):
        base = f"https://{base}"

    path = f"/admin/submissions/{int(submission_id)}"
    if not base:
        return path
    return f"{base}{path}"


async def get_service_manager_emails_for_location(
    *,
    db: AsyncSession,
    organization_id: int,
    location_id: int,
    group_key: str,
) -> list[str]:
    """Recipients: service_manager users with access to org+location/group."""
    org_id = int(organization_id)
    loc_id = int(location_id)
    gk = (group_key or "").strip()
    if not gk:
        return []

    q_loc = select(UserRole.user_id.label("user_id")).where(
        UserRole.role == Role.service_manager.value,
        UserRole.location_id == loc_id,
    )

    q_grp = select(UserGroupAccess.user_id.label("user_id")).where(
        UserGroupAccess.organization_id == org_id,
        UserGroupAccess.group_key == gk,
        UserGroupAccess.is_active == True,  # noqa: E712
    )

    # Only explicit access grants: direct location assignment OR group access.
    u = union_all(q_loc, q_grp).subquery("sm_ids_union")
    ids_subq = select(u.c.user_id.label("user_id")).distinct().subquery("sm_user_ids")

    has_sm_role = exists(
        select(UserRole.id).where(
            UserRole.user_id == User.id,
            UserRole.role == Role.service_manager.value,
        )
    )

    q = (
        select(User.email)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .where(
            User.is_active == True,  # noqa: E712
            func.length(func.coalesce(User.email, "")) > 3,
            User.id.in_(select(ids_subq.c.user_id)),
            UserOrganization.organization_id == org_id,
            UserOrganization.is_active == True,  # noqa: E712
            has_sm_role,
        )
        .distinct()
    )

    rows = (await db.execute(q)).all()
    emails: list[str] = []
    for r in rows:
        e = _safe_email(r[0] or "")
        if e:
            emails.append(e)

    # de-dupe + hard cap (safety)
    uniq = sorted(list(set(emails)))
    return uniq[:50]
