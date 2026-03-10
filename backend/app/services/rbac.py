from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import (
    get_allowed_location_ids,
    get_allowed_organization_ids,
    get_current_user,
    get_db,
)
from app.models.location import Location
from app.models.role import Role
from app.models.token import UserRole
from app.models.user import User


def _to_role_values(items: tuple[Role | str, ...]) -> list[str]:
    out: list[str] = []
    for r in items:
        if isinstance(r, Role):
            out.append(r.value)
        else:
            out.append(str(r))
    return out


def require_roles(*roles: Role | str, detail: str = "Forbidden"):
    """FastAPI dependency: user must have ANY of the roles.

    detail:
      - custom 403 message for better UX/debugging
      - default kept as "Forbidden" for backward compatibility
    """

    role_values = _to_role_values(roles)

    async def _checker(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        if not role_values:
            raise HTTPException(status_code=403, detail=detail)

        q = (
            select(UserRole.id)
            .where(and_(UserRole.user_id == user.id, UserRole.role.in_(role_values)))
            .limit(1)
        )
        has = (await db.execute(q)).scalar_one_or_none()
        if not has:
            raise HTTPException(status_code=403, detail=detail)
        return user

    return _checker


async def require_org_access(db: AsyncSession, user: User, organization_id: int) -> None:
    """RBAC helper: ensures user can access organization_id."""
    allowed = await get_allowed_organization_ids(db=db, user=user)
    if int(organization_id) not in {int(x) for x in allowed}:
        raise HTTPException(status_code=403, detail="No access to this organization")


async def require_group_access(
    db: AsyncSession,
    user: User,
    organization_id: int,
    group_key: str,
) -> list[int]:
    """RBAC helper: returns allowed location_ids inside (organization_id + group_key).

    Current implementation is compatibility-first:
      - org access is checked via get_allowed_organization_ids()
      - group access is derived from allowed location_ids (until RBAC-2 adds explicit group bindings)
    """
    await require_org_access(db=db, user=user, organization_id=organization_id)

    loc_ids = (
        await db.execute(
            select(Location.id).where(
                Location.organization_id == int(organization_id),
                Location.type == str(group_key),
                Location.is_active == True,  # noqa: E712
            )
        )
    ).scalars().all()
    loc_ids_int = [int(x) for x in loc_ids]
    if not loc_ids_int:
        return []

    allowed = await get_allowed_location_ids(db=db, user=user)
    allowed_set = {int(x) for x in allowed}
    return [lid for lid in loc_ids_int if lid in allowed_set]
