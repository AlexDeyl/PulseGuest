from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.api.v1.deps import get_db, get_current_user
from app.models.token import UserRole
from app.models.user import User
from app.models.role import Role


def require_roles(*roles: Role):
    role_values = [r.value for r in roles]

    async def _checker(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        q = select(UserRole.id).where(
            and_(
                UserRole.user_id == user.id,
                UserRole.role.in_(role_values),
            )
        )
        has = (await db.execute(q)).scalar_one_or_none()
        if not has:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user

    return _checker