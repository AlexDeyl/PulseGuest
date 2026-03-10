from __future__ import annotations

from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_db
from app.schemas.password_reset import PasswordResetRequest, PasswordResetConfirm
from app.services.password_reset import request_password_reset, confirm_password_reset


router = APIRouter(prefix="/auth/password-reset", tags=["auth"])


def _client_ip(req: Request) -> str | None:
    # Prefer X-Forwarded-For when behind proxy/nginx; take first IP.
    xff = (req.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if xff:
        return xff
    if req.client:
        return req.client.host
    return None


@router.post("/request")
async def password_reset_request(
    data: PasswordResetRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    # Always return 200 (no email existence leak).
    await request_password_reset(
        db=db,
        email=data.email,
        background_tasks=background_tasks,
        client_ip=_client_ip(request),
    )
    return {"ok": True}


@router.post("/confirm")
async def password_reset_confirm(
    data: PasswordResetConfirm,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    if not data.new_password or len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="Пароль слишком короткий (минимум 8 символов)")

    res = await confirm_password_reset(
        db=db,
        token=data.token,
        new_password=data.new_password,
        background_tasks=background_tasks,
        client_ip=_client_ip(request),
    )

    if res == "throttled":
        raise HTTPException(status_code=429, detail="Слишком часто. Попробуйте через пару секунд.")
    if res != "ok":
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    return {"ok": True}
