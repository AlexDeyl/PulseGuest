from __future__ import annotations

import hashlib
import logging
import re
import secrets

from fastapi import BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update

from app.core.config import settings
from app.core.redis import get_redis
from app.core.security import hash_password
from app.models.token import RefreshToken
from app.models.user import User
from app.services.mailer import send_email_text, is_smtp_configured


logger = logging.getLogger(__name__)

_SCHEME_RE = re.compile(r"^https?://", re.IGNORECASE)


def _salted_sha256(value: str) -> str:
    raw = f"{settings.JWT_SECRET}:{value}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _normalize_frontend_base() -> str:
    base = (settings.FRONTEND_BASE_URL or "").strip()
    if not base:
        base = (settings.PUBLIC_BASE_URL or "").strip()

    if not base:
        cors = settings.cors_list()
        base = (cors[0] if cors else "").strip()

    base = base.rstrip("/")
    if base and not _SCHEME_RE.match(base):
        base = f"https://{base}"
    return base


def _build_reset_link(token: str) -> str:
    base = _normalize_frontend_base()
    if not base:
        return f"/admin/reset-password?token={token}"
    return f"{base}/admin/reset-password?token={token}"


async def _consume_reset_token(token: str) -> str | None:
    """Atomically get+delete reset token from Redis. Returns user_id as str or None."""
    redis = get_redis()
    if redis is None:
        return None

    token_key = f"pwdreset:token:{token}"

    script = """
    local v = redis.call('GET', KEYS[1])
    if v then
      redis.call('DEL', KEYS[1])
    end
    return v
    """
    try:
        val = await redis.eval(script, 1, token_key)
        if val is None:
            return None
        return str(val)
    except Exception:
        logger.exception("pwdreset: redis error during token consume")
        return None


async def request_password_reset(
    *,
    db: AsyncSession,
    email: str,
    background_tasks: BackgroundTasks,
    client_ip: str | None = None,
) -> None:
    """Issue a one-time reset token and send an email (neutral response from API)."""
    email_norm = (email or "").strip().lower()
    if not email_norm:
        return

    redis = get_redis()
    if redis is None:
        logger.warning("pwdreset: redis not configured; request ignored")
        return

    # Throttle by email (main)
    email_key = f"pwdreset:cooldown:email:{_salted_sha256(email_norm)}"
    try:
        ok = await redis.set(
            email_key,
            "1",
            ex=int(settings.PASSWORD_RESET_COOLDOWN_SECONDS),
            nx=True,
        )
        if not ok:
            return
    except Exception:
        logger.exception("pwdreset: redis error during email cooldown")
        return

    # Optional throttle by IP (best-effort)
    ip_norm = (client_ip or "").strip()
    if ip_norm:
        ip_key = f"pwdreset:cooldown:ip:{_salted_sha256(ip_norm)}"
        try:
            ok_ip = await redis.set(
                ip_key,
                "1",
                ex=int(settings.PASSWORD_RESET_IP_COOLDOWN_SECONDS),
                nx=True,
            )
            if not ok_ip:
                return
        except Exception:
            logger.exception("pwdreset: redis error during ip cooldown")
            return

    # Find user by email (case-insensitive). Keep neutral on not found.
    user = (
        await db.execute(
            select(User).where(
                func.lower(User.email) == email_norm,
                User.is_active == True,  # noqa: E712
            )
        )
    ).scalar_one_or_none()

    # Log without raw email
    logger.info(
        "pwdreset: request received (email_hash=%s, found=%s)",
        _salted_sha256(email_norm)[:12],
        bool(user),
    )

    if not user:
        return

    token = secrets.token_urlsafe(48)
    token_key = f"pwdreset:token:{token}"
    try:
        await redis.set(
            token_key,
            str(user.id),
            ex=int(settings.PASSWORD_RESET_TOKEN_TTL_SECONDS),
        )
    except Exception:
        logger.exception("pwdreset: redis error during token set")
        return

    link = _build_reset_link(token)
    subject = "PulseGuest — сброс пароля"
    body = (
        "Вы запросили сброс пароля для PulseGuest.\n\n"
        f"Чтобы установить новый пароль, перейдите по ссылке:\n{link}\n\n"
        f"Ссылка действует {int(settings.PASSWORD_RESET_TOKEN_TTL_SECONDS) // 60} минут.\n"
        "Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.\n"
    )

    background_tasks.add_task(send_email_text, user.email, subject, body)

    if settings.DEBUG and not is_smtp_configured():
        logger.warning("[DEV] Password reset link for user_id=%s: %s", user.id, link)


async def confirm_password_reset(
    *,
    db: AsyncSession,
    token: str,
    new_password: str,
    background_tasks: BackgroundTasks,
    client_ip: str | None = None,
) -> str:
    """Confirm reset token and set a new password.

    Returns: "ok" | "invalid" | "throttled"
    """
    token = (token or "").strip()
    if not token:
        return "invalid"

    redis = get_redis()
    if redis is None:
        logger.warning("pwdreset: redis not configured; confirm treated as invalid")
        return "invalid"

    # Optional confirm throttle by IP (best-effort)
    ip_norm = (client_ip or "").strip()
    if ip_norm:
        ip_key = f"pwdreset:confirm:cooldown:ip:{_salted_sha256(ip_norm)}"
        try:
            ok_ip = await redis.set(
                ip_key,
                "1",
                ex=int(settings.PASSWORD_RESET_CONFIRM_COOLDOWN_SECONDS),
                nx=True,
            )
            if not ok_ip:
                return "throttled"
        except Exception:
            logger.exception("pwdreset: redis error during confirm ip cooldown")
            # don't block legitimate confirms because of redis issues
            # but token validation still requires redis
            return "invalid"

    user_id_raw = await _consume_reset_token(token)
    if not user_id_raw:
        return "invalid"

    try:
        user_id = int(user_id_raw)
    except ValueError:
        return "invalid"

    user = (
        await db.execute(
            select(User).where(User.id == user_id, User.is_active == True)  # noqa: E712
        )
    ).scalar_one_or_none()
    if not user:
        return "invalid"

    try:
        user.password_hash = hash_password(new_password)

        # Revoke all refresh tokens for the user (access expires naturally).
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user.id)
            .values(is_revoked=True)
        )

        await db.commit()

    except Exception:
        await db.rollback()
        logger.exception("pwdreset: failed to update password for user_id=%s", user_id)
        return "invalid"

    logger.info("pwdreset: password changed (user_id=%s)", user.id)

    # Email notification (best-effort)
    subject = "PulseGuest — пароль изменён"
    body = (
        "Пароль вашего аккаунта PulseGuest был изменён.\n\n"
        "Если это были не вы — срочно обратитесь к администратору системы.\n"
    )
    background_tasks.add_task(send_email_text, user.email, subject, body)

    return "ok"
