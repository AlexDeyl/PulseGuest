from __future__ import annotations

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_jwt
from app.db.session import get_session
from app.models.organization import Organization
from app.models.token import UserRole
from app.models.user import User
from app.models.user_organization import UserOrganization
from app.models.location import Location
from app.models.role import Role

bearer = HTTPBearer(auto_error=False)

# Глобальные роли по ТЗ (видят все организации/отели)
# service_manager НЕ глобальный
GLOBAL_ROLE_VALUES = {"super_admin", "director", "auditor_global"}
ORG_WIDE_ROLE_VALUES = {Role.manager.value, Role.auditor.value}
SCOPED_LOCATION_ROLE_VALUES = {Role.service_manager.value, Role.employee.value}


async def get_db() -> AsyncSession:
    async for s in get_session():  # type: ignore
        yield s


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_jwt(creds.credentials)
    if payload.get("typ") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user_id = int(payload["sub"])
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return user


async def user_has_any_role(db: AsyncSession, user: User, role_values: set[str]) -> bool:
    """
    Проверка: есть ли у пользователя хотя бы одна роль из множества role_values.
    Роли хранятся в таблице UserRole.
    """
    if not role_values:
        return False
    q = (
        select(UserRole.id)
        .where(UserRole.user_id == user.id, UserRole.role.in_(list(role_values)))
        .limit(1)
    )
    return (await db.execute(q)).scalar_one_or_none() is not None


async def get_allowed_organization_ids(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[int]:
    """
    Возвращает список organization_id, которые пользователь имеет право видеть.

    Правило:
      - GLOBAL_ROLE_VALUES (director/auditor_global/super_admin) -> все активные организации
      - остальные -> только организации из user_organizations (UserOrganization)

    Дополнительно: фильтруем только Organization.is_active == True
    """
    is_global = await user_has_any_role(db, user, GLOBAL_ROLE_VALUES)

    if is_global:
        rows = (
            await db.execute(
                select(Organization.id).where(Organization.is_active == True)  # noqa: E712
            )
        ).all()
        return [r[0] for r in rows]

    # scoped доступ: user -> organizations через UserOrganization
    rows = (
        await db.execute(
            select(UserOrganization.organization_id).where(
                UserOrganization.user_id == user.id,
                UserOrganization.is_active == True,  # noqa: E712
            )
        )
    ).all()
    allowed = [r[0] for r in rows]
    if not allowed:
        return []

    active_rows = (
        await db.execute(
            select(Organization.id).where(
                Organization.id.in_(allowed),
                Organization.is_active == True,  # noqa: E712
            )
        )
    ).all()
    return [r[0] for r in active_rows]


def ensure_organization_access(org_id_param: str = "organization_id"):
    """
    Dependency: проверяет, что пользователь имеет доступ к organization_id (query/path),
    и возвращает org_id (int).
    """
    async def _wrapper(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
        **kwargs,
    ) -> int:
        raw = kwargs.get(org_id_param)
        if raw is None:
            raise HTTPException(status_code=400, detail=f"Missing {org_id_param}")

        try:
            org_id = int(raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"Invalid {org_id_param}")

        allowed = await get_allowed_organization_ids(db=db, user=user)
        if org_id not in allowed:
            raise HTTPException(status_code=403, detail="No access to this organization")

        return org_id

    return _wrapper


async def get_allowed_location_ids(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[int]:
    """
    Возвращает список location_id, которые пользователь имеет право видеть.

    Правило:
      - director / auditor_global / super_admin -> все активные локации активных организаций
      - manager / auditor (org-wide) -> все локации в организациях, к которым есть доступ (через org-scope или UserOrganization)
      - service_manager / employee -> только локации, назначенные в user_roles.location_id
    """
    is_global = await user_has_any_role(db, user, GLOBAL_ROLE_VALUES)
    if is_global:
        rows = (
            await db.execute(
                select(Location.id)
                .join(Organization, Organization.id == Location.organization_id)
                .where(
                    Organization.is_active == True,  # noqa: E712
                    Location.is_active == True,       # noqa: E712
                )
            )
        ).all()
        return [r[0] for r in rows]

    # Считываем все роли пользователя (с scope)
    role_rows = (
        await db.execute(
            select(UserRole.role, UserRole.organization_id, UserRole.location_id)
            .where(UserRole.user_id == user.id)
        )
    ).all()

    # Локации из location-scope ролей
    scoped_loc_ids = {r[2] for r in role_rows if r[2] is not None}

    # Если у пользователя есть org-wide роли (manager/auditor) — даём все локации в доступных org
    has_org_wide = any(r[0] in ORG_WIDE_ROLE_VALUES for r in role_rows)

    if has_org_wide:
        org_ids_from_roles = {r[1] for r in role_rows if r[1] is not None}
        org_ids_from_links = set(await get_allowed_organization_ids(db=db, user=user))
        org_ids = list(org_ids_from_roles.union(org_ids_from_links))

        if org_ids:
            rows = (
                await db.execute(
                    select(Location.id)
                    .where(
                        Location.organization_id.in_(org_ids),
                        Location.is_active == True,  # noqa: E712
                    )
                )
            ).all()
            scoped_loc_ids.update([r[0] for r in rows])

    # service_manager/employee без org-wide ролей -> только scoped_loc_ids
    return sorted([int(x) for x in scoped_loc_ids])


def ensure_location_access(location_id_param: str = "location_id"):
    """
    Dependency: проверяет, что пользователь имеет доступ к location_id (query/path),
    и возвращает location_id (int).
    """
    async def _wrapper(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
        **kwargs,
    ) -> int:
        raw = kwargs.get(location_id_param)
        if raw is None:
            raise HTTPException(status_code=400, detail=f"Missing {location_id_param}")

        try:
            location_id = int(raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"Invalid {location_id_param}")

        allowed = await get_allowed_location_ids(db=db, user=user)
        if location_id not in allowed:
            raise HTTPException(status_code=403, detail="No access to this location")

        return location_id

    return _wrapper
