import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.security import verify_password, create_jwt
from app.models.user import User
from app.models.token import RefreshToken


def _hash_refresh(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def authenticate(db: AsyncSession, email: str, password: str) -> User | None:
    user = (
        await db.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()
    if not user or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


async def issue_tokens(db: AsyncSession, user: User) -> tuple[str, str]:
    access = create_jwt(str(user.id), settings.JWT_ACCESS_TTL_SECONDS, "access")

    refresh_raw = secrets.token_urlsafe(48)
    jti = secrets.token_hex(16)
    refresh = create_jwt(
        str(user.id),
        settings.JWT_REFRESH_TTL_SECONDS,
        "refresh",
        extra={"jti": jti},
    )

    now = datetime.now(timezone.utc)
    db.add(
        RefreshToken(
            user_id=user.id,
            jti=jti,
            token_hash=_hash_refresh(refresh),
            is_revoked=False,
            created_at=now,
            expires_at=now + timedelta(seconds=settings.JWT_REFRESH_TTL_SECONDS),
        )
    )
    await db.commit()
    return access, refresh


async def rotate_refresh(db: AsyncSession, refresh_token: str) -> tuple[str, str]:
    from app.core.security import decode_jwt

    payload = decode_jwt(refresh_token)
    if payload.get("typ") != "refresh":
        raise ValueError("Invalid token type")

    user_id = int(payload["sub"])
    jti = payload.get("jti")
    if not jti:
        raise ValueError("Missing jti")

    rt = (
        await db.execute(select(RefreshToken).where(RefreshToken.jti == jti))
    ).scalar_one_or_none()
    if not rt or rt.is_revoked or rt.token_hash != _hash_refresh(refresh_token):
        raise ValueError("Refresh revoked/invalid")

    rt.is_revoked = True
    await db.commit()

    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user or not user.is_active:
        raise ValueError("User not found or inactive")

    return await issue_tokens(db, user)

