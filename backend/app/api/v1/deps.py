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
from app.models.user_group_access import UserGroupAccess
from app.models.location import Location
from app.models.role import Role

bearer = HTTPBearer(auto_error=False)

# RBAC roles.
#
# В проекте уже есть legacy-рольвая модель. Переход на новую RBAC делаем
# безопасно: добавляем новые роли, но старые значения пока поддерживаем,
# чтобы не сломать существующие данные в БД.
#
# FULL_GLOBAL_ROLE_VALUES: "админский" доступ ко всем активным организациям/локациям.
# (сюда пока включены и legacy значения)
FULL_GLOBAL_ROLE_VALUES: set[str] = {
    Role.admin.value,
    Role.director.value,      # legacy == admin-equivalent (до миграции)
    Role.super_admin.value,   # legacy
    Role.auditor.value,       # auditor теперь основной глобальный аудитор
}

# STATS_GLOBAL_ROLE_VALUES: может читать статистику по всем организациям.
STATS_GLOBAL_ROLE_VALUES: set[str] = set(FULL_GLOBAL_ROLE_VALUES) | {Role.auditor.value}

# Глобальные роли (видят все организации/локации). Добавили "admin" (строкой) для новой RBAC-модели.
GLOBAL_ROLE_VALUES = {"super_admin", "director", "admin", "auditor"}

# Auditor по ТЗ читает статистику по всем организациям (write-запреты закрываем отдельными патчами)
ORG_WIDE_ROLE_VALUES = {Role.manager.value, "ops_director"}

# org-wide: все локации в доступных организациях (добавили "ops_director" строкой для новой RBAC)
ORG_WIDE_ROLE_VALUES = {Role.manager.value, Role.auditor.value, "ops_director"}

# location-scoped (legacy)
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
      - STATS_GLOBAL_ROLE_VALUES -> все активные организации
      - остальные -> union:
          * user_organizations (UserOrganization) where is_active=True
          * organization_id из user_roles (если задано)
          * organization_id из user_group_access (если задано)
    """
    is_stats_global = await user_has_any_role(db, user, STATS_GLOBAL_ROLE_VALUES)

    if is_stats_global:
        rows = (
            await db.execute(
                select(Organization.id).where(Organization.is_active == True)  # noqa: E712
            )
        ).all()
        return [int(r[0]) for r in rows]

    org_ids: set[int] = set()

    # scoped via UserOrganization
    rows = (
        await db.execute(
            select(UserOrganization.organization_id).where(
                UserOrganization.user_id == user.id,
                UserOrganization.is_active == True,  # noqa: E712
            )
        )
    ).all()
    org_ids.update(int(r[0]) for r in rows)

    # legacy/scoped via user_roles.organization_id
    role_org_rows = (
        await db.execute(
            select(UserRole.organization_id).where(
                UserRole.user_id == user.id,
                UserRole.organization_id.isnot(None),
            )
        )
    ).all()
    org_ids.update(int(r[0]) for r in role_org_rows if r[0] is not None)

    # new via user_group_access
    group_org_rows = (
        await db.execute(
            select(UserGroupAccess.organization_id).where(
                UserGroupAccess.user_id == user.id,
                UserGroupAccess.is_active == True,  # noqa: E712
            )
        )
    ).all()
    org_ids.update(int(r[0]) for r in group_org_rows)

    if not org_ids:
        return []

    active_rows = (
        await db.execute(
            select(Organization.id).where(
                Organization.id.in_(list(org_ids)),
                Organization.is_active == True,  # noqa: E712
            )
        )
    ).all()
    return [int(r[0]) for r in active_rows]


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

    Правило (переходный период):
      - GLOBAL_ROLE_VALUES -> все активные локации активных организаций
      - ORG_WIDE_ROLE_VALUES -> все локации в доступных организациях
      - service_manager -> локации по user_group_access (org + group_key) + legacy location-scope fallback
      - employee -> только локации по location-scope
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
        return [int(r[0]) for r in rows]

    role_rows = (
        await db.execute(
            select(UserRole.role, UserRole.organization_id, UserRole.location_id)
            .where(UserRole.user_id == user.id)
        )
    ).all()

    allowed_loc_ids: set[int] = {int(r[2]) for r in role_rows if r[2] is not None}

    # org-wide roles
    has_org_wide = any(r[0] in ORG_WIDE_ROLE_VALUES for r in role_rows)
    if has_org_wide:
        org_ids_from_roles = {int(r[1]) for r in role_rows if r[1] is not None}
        org_ids_from_links = set(await get_allowed_organization_ids(db=db, user=user))
        org_ids = list(org_ids_from_roles.union(org_ids_from_links))

        if org_ids:
            rows = (
                await db.execute(
                    select(Location.id).where(
                        Location.organization_id.in_(org_ids),
                        Location.is_active == True,  # noqa: E712
                    )
                )
            ).all()
            allowed_loc_ids.update(int(r[0]) for r in rows)

    # service_manager: group-based access
    has_service_manager = any(r[0] == Role.service_manager.value for r in role_rows)
    if has_service_manager:
        org_ids = set(await get_allowed_organization_ids(db=db, user=user))

        if org_ids:
            grp_rows = (
                await db.execute(
                    select(UserGroupAccess.organization_id, UserGroupAccess.group_key).where(
                        UserGroupAccess.user_id == user.id,
                        UserGroupAccess.is_active == True,  # noqa: E712
                        UserGroupAccess.organization_id.in_(list(org_ids)),
                    )
                )
            ).all()

            org_groups: dict[int, set[str]] = {}
            for org_id, group_key in grp_rows:
                org_groups.setdefault(int(org_id), set()).add(str(group_key))

            if org_groups:
                for org_id, keys in org_groups.items():
                    rows = (
                        await db.execute(
                            select(Location.id).where(
                                Location.organization_id == org_id,
                                Location.type.in_(list(keys)),
                                Location.is_active == True,  # noqa: E712
                            )
                        )
                    ).all()
                    allowed_loc_ids.update(int(r[0]) for r in rows)
            else:
                # legacy fallback: org-scoped service_manager without any group rows yet
                legacy_org_ids = {
                    int(r[1])
                    for r in role_rows
                    if r[0] == Role.service_manager.value and r[1] is not None and r[2] is None
                }
                for org_id in legacy_org_ids:
                    rows = (
                        await db.execute(
                            select(Location.id).where(
                                Location.organization_id == org_id,
                                Location.is_active == True,  # noqa: E712
                            )
                        )
                    ).all()
                    allowed_loc_ids.update(int(r[0]) for r in rows)

    return sorted(allowed_loc_ids)


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
