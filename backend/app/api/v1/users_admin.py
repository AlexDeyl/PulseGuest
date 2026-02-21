from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import (
    get_allowed_location_ids,
    get_allowed_organization_ids,
    get_db,
    get_current_user,
)
from app.models.location import Location
from app.models.role import Role
from app.models.token import UserRole
from app.models.user import User
from app.services.rbac import require_roles

router = APIRouter(prefix="/admin", tags=["admin"])


def _location_payload(loc: Location) -> dict[str, Any]:
    return {
        "id": loc.id,
        "organization_id": loc.organization_id,
        "type": loc.type,
        "code": loc.code,
        "name": loc.name,
        "slug": loc.slug,
        "is_active": loc.is_active,
    }


@router.get("/users")
async def list_users(
    limit: int = 20,
    offset: int = 0,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
    _rbac=Depends(require_roles(Role.director)),
):
    """Director-only: list users (minimal for Admin UI)."""
    limit = max(1, min(int(limit), 100))
    offset = max(0, int(offset))

    where = []
    if q:
        where.append(func.lower(User.email).like(f"%{q.strip().lower()}%"))

    total_stmt = select(func.count(User.id))
    users_stmt = select(User).order_by(User.id.asc()).limit(limit).offset(offset)
    if where:
        total_stmt = total_stmt.where(*where)
        users_stmt = users_stmt.where(*where)

    total = (await db.execute(total_stmt)).scalar_one()
    users = (await db.execute(users_stmt)).scalars().all()

    user_ids = [u.id for u in users]
    roles: list[UserRole] = []
    if user_ids:
        roles = (
            await db.execute(select(UserRole).where(UserRole.user_id.in_(user_ids)))
        ).scalars().all()

    svc_loc_ids_by_user: dict[int, list[int]] = {uid: [] for uid in user_ids}
    for r in roles:
        if r.role == Role.service_manager.value and r.location_id is not None:
            svc_loc_ids_by_user.setdefault(r.user_id, []).append(int(r.location_id))

    all_loc_ids = sorted({lid for lids in svc_loc_ids_by_user.values() for lid in lids})
    loc_map: dict[int, Location] = {}
    if all_loc_ids:
        locs = (
            await db.execute(select(Location).where(Location.id.in_(all_loc_ids)))
        ).scalars().all()
        loc_map = {l.id: l for l in locs}

    items = []
    for u in users:
        loc_ids = svc_loc_ids_by_user.get(u.id, [])
        locs_short = [
            _location_payload(loc_map[lid]) for lid in loc_ids if lid in loc_map
        ]
        items.append(
            {
                "id": u.id,
                "email": u.email,
                "is_active": u.is_active,
                "created_at": u.created_at,
                "service_manager_locations": locs_short,
                "service_manager_locations_count": len(locs_short),
            }
        )

    return {"items": items, "total": int(total), "limit": limit, "offset": offset}


@router.get("/users/{user_id}")
async def get_user_detail(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
    _rbac=Depends(require_roles(Role.director)),
):
    """Director-only: user details + service_manager assignments."""
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    roles = (await db.execute(select(UserRole).where(UserRole.user_id == u.id))).scalars().all()

    svc_loc_ids = sorted(
        {
            int(r.location_id)
            for r in roles
            if r.role == Role.service_manager.value and r.location_id is not None
        }
    )

    svc_locs: list[Location] = []
    if svc_loc_ids:
        svc_locs = (
            await db.execute(select(Location).where(Location.id.in_(svc_loc_ids)))
        ).scalars().all()
        svc_locs.sort(key=lambda x: (x.organization_id, x.name.lower()))

    # What user will actually see in admin (active + RBAC logic)
    allowed_org_ids = await get_allowed_organization_ids(db=db, user=u)
    allowed_loc_ids = await get_allowed_location_ids(db=db, user=u)

    allowed_locs: list[Location] = []
    if allowed_loc_ids:
        allowed_locs = (
            await db.execute(
                select(Location)
                .where(Location.id.in_(allowed_loc_ids), Location.is_active == True)  # noqa: E712
                .order_by(Location.organization_id, Location.name)
            )
        ).scalars().all()

    return {
        "id": u.id,
        "email": u.email,
        "is_active": u.is_active,
        "created_at": u.created_at,
        "roles": [
            {"role": r.role, "organization_id": r.organization_id, "location_id": r.location_id}
            for r in roles
        ],
        "service_manager_locations": [_location_payload(l) for l in svc_locs],
        "allowed_organization_ids": allowed_org_ids,
        "allowed_location_ids": allowed_loc_ids,
        "allowed_locations": [_location_payload(l) for l in allowed_locs],
    }
