from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import update

from app.api.v1.deps import get_db, get_current_user
from app.schemas.auth import LoginRequest, TokenPair, RefreshRequest
from app.services.auth import authenticate, issue_tokens, rotate_refresh
from app.models.user import User
from app.models.token import RefreshToken

router = APIRouter()

@router.post("/login", response_model=TokenPair)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await authenticate(db, data.email, data.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    access, refresh = await issue_tokens(db, user)
    return TokenPair(access_token=access, refresh_token=refresh)

@router.post("/refresh", response_model=TokenPair)
async def refresh(data: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        access, refresh = await rotate_refresh(db, data.refresh_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    return TokenPair(access_token=access, refresh_token=refresh)

@router.post("/logout")
async def logout(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id)
        .values(is_revoked=True)
    )
    await db.commit()
    return {"ok": True}
