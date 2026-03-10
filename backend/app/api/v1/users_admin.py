from __future__ import annotations

from typing import Any, Iterable

from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.api.v1.deps import (
    get_allowed_location_ids,
    get_allowed_organization_ids,
    get_db,
    get_current_user,
)
from app.core.security import hash_password
from app.models.location import Location
from app.models.organization import Organization
from app.models.role import Role
from app.models.token import UserRole
from app.models.user import User
from app.models.user_organization import UserOrganization
from app.models.user_group_access import UserGroupAccess
from app.services.rbac import require_roles

router = APIRouter(prefix="/admin", tags=["admin"])


# --------------------------
# Helpers
# --------------------------

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


def _uniq_ints(xs: Iterable[Any]) -> list[int]:
    out: list[int] = []
    seen: set[int] = set()
    for x in xs:
        try:
            v = int(x)
        except Exception:
            continue
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


def _uniq_strs(xs: Iterable[Any]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for x in xs:
        s = str(x).strip()
        if not s:
            continue
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


ADMIN_LIKE = {Role.admin.value, Role.director.value, Role.super_admin.value}
OPS = {Role.ops_director.value}

# роли, которыми мы управляем в новой модели (и совместимые legacy “админские”)
PRIMARY_ROLE_VALUES = {
    Role.admin.value,
    Role.ops_director.value,
    Role.service_manager.value,
    Role.auditor.value,
    # legacy (чтобы не оставлять “лишние” права)
    Role.director.value,
    Role.super_admin.value,
    Role.manager.value,
    Role.auditor_global.value,
    Role.employee.value,
}


async def _get_user_role_values(db: AsyncSession, user_id: int) -> set[str]:
    rows = (await db.execute(select(UserRole.role).where(UserRole.user_id == int(user_id)))).scalars().all()
    return {str(r) for r in rows}


async def _is_admin_like(db: AsyncSession, user_id: int) -> bool:
    roles = await _get_user_role_values(db, user_id)
    return bool(roles.intersection(ADMIN_LIKE))


async def _is_ops_director(db: AsyncSession, user_id: int) -> bool:
    roles = await _get_user_role_values(db, user_id)
    return bool(roles.intersection(OPS))


async def _target_related_org_ids(db: AsyncSession, target_user_id: int) -> set[int]:
    """
    Какие org_id уже “привязаны” к пользователю (для scope-check у ops_director).
    """
    org_ids: set[int] = set()

    rows = (
        await db.execute(
            select(UserOrganization.organization_id).where(
                UserOrganization.user_id == int(target_user_id),
                UserOrganization.is_active == True,  # noqa: E712
            )
        )
    ).all()
    org_ids.update(int(r[0]) for r in rows)

    rows = (
        await db.execute(
            select(UserGroupAccess.organization_id).where(
                UserGroupAccess.user_id == int(target_user_id),
                UserGroupAccess.is_active == True,  # noqa: E712
            )
        )
    ).all()
    org_ids.update(int(r[0]) for r in rows)

    rows = (
        await db.execute(
            select(UserRole.organization_id).where(
                UserRole.user_id == int(target_user_id),
                UserRole.organization_id.isnot(None),
            )
        )
    ).all()
    org_ids.update(int(r[0]) for r in rows if r[0] is not None)

    rows = (
        await db.execute(
            select(Location.organization_id)
            .select_from(UserRole)
            .join(Location, Location.id == UserRole.location_id)
            .where(UserRole.user_id == int(target_user_id))
        )
    ).all()
    org_ids.update(int(r[0]) for r in rows)

    return org_ids


async def _ops_target_scope_guard(
    db: AsyncSession,
    actor: User,
    target_user_id: int,
    actor_allowed_org_ids: list[int],
) -> None:
    """
    ops_director НЕ может редактировать пользователя, который уже связан с чужими org.
    """
    target_orgs = await _target_related_org_ids(db=db, target_user_id=int(target_user_id))
    allowed_set = {int(x) for x in actor_allowed_org_ids}
    foreign = {oid for oid in target_orgs if oid not in allowed_set}
    if foreign:
        raise HTTPException(status_code=403, detail="Target user belongs to other organization(s)")


async def _filter_users_to_allowed_orgs(
    db: AsyncSession,
    allowed_org_ids: list[int],
) -> set[int]:
    allowed_set = {int(x) for x in allowed_org_ids}
    if not allowed_set:
        return set()

    user_ids: set[int] = set()

    rows = (
        await db.execute(
            select(UserOrganization.user_id).where(
                UserOrganization.organization_id.in_(list(allowed_set)),
                UserOrganization.is_active == True,  # noqa: E712
            )
        )
    ).all()
    user_ids.update(int(r[0]) for r in rows)

    rows = (
        await db.execute(
            select(UserGroupAccess.user_id).where(
                UserGroupAccess.organization_id.in_(list(allowed_set)),
                UserGroupAccess.is_active == True,  # noqa: E712
            )
        )
    ).all()
    user_ids.update(int(r[0]) for r in rows)

    rows = (
        await db.execute(
            select(UserRole.user_id).where(
                UserRole.organization_id.in_(list(allowed_set))
            )
        )
    ).all()
    user_ids.update(int(r[0]) for r in rows)

    rows = (
        await db.execute(
            select(UserRole.user_id)
            .select_from(UserRole)
            .join(Location, Location.id == UserRole.location_id)
            .where(Location.organization_id.in_(list(allowed_set)))
        )
    ).all()
    user_ids.update(int(r[0]) for r in rows)

    return user_ids


async def _ensure_org_exists(db: AsyncSession, organization_id: int) -> None:
    org = (await db.execute(select(Organization.id).where(Organization.id == int(organization_id)))).scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")


async def _valid_group_keys_for_org(db: AsyncSession, organization_id: int) -> set[str]:
    rows = (
        await db.execute(
            select(Location.type)
            .where(
                Location.organization_id == int(organization_id),
                Location.is_active == True,  # noqa: E712
            )
            .distinct()
        )
    ).all()
    return {str(r[0]) for r in rows if r and r[0] is not None}


async def _set_user_org_access_exact(db: AsyncSession, target_user_id: int, org_ids: list[int]) -> None:
    """
    Делает user_organizations = org_ids (активные). Остальные — inactive.
    """
    org_ids = [int(x) for x in org_ids]
    desired = {int(x) for x in org_ids}

    links = (await db.execute(select(UserOrganization).where(UserOrganization.user_id == int(target_user_id)))).scalars().all()
    by_org = {int(l.organization_id): l for l in links}

    for org_id, link in by_org.items():
        want_active = org_id in desired
        if bool(link.is_active) != bool(want_active):
            link.is_active = bool(want_active)
            db.add(link)

    for org_id in desired:
        if org_id not in by_org:
            db.add(UserOrganization(user_id=int(target_user_id), organization_id=int(org_id), is_active=True))


async def _set_user_group_access_exact(db: AsyncSession, target_user_id: int, organization_id: int, group_keys: list[str]) -> None:
    """
    Делает user_group_access для (user, org) = group_keys (активные). Остальные для этой org — inactive.
    """
    desired = {str(g) for g in group_keys}

    rows = (
        await db.execute(
            select(UserGroupAccess).where(
                UserGroupAccess.user_id == int(target_user_id),
                UserGroupAccess.organization_id == int(organization_id),
            )
        )
    ).scalars().all()
    by_key = {str(r.group_key): r for r in rows}

    for key, row in by_key.items():
        want_active = key in desired
        if bool(row.is_active) != bool(want_active):
            row.is_active = bool(want_active)
            db.add(row)

    for key in desired:
        if key not in by_key:
            db.add(
                UserGroupAccess(
                    user_id=int(target_user_id),
                    organization_id=int(organization_id),
                    group_key=str(key),
                    is_active=True,
                )
            )


async def _clear_all_group_access(db: AsyncSession, target_user_id: int) -> None:
    await db.execute(
        delete(UserGroupAccess).where(UserGroupAccess.user_id == int(target_user_id))
    )


async def _replace_primary_role(
    db: AsyncSession,
    target_user_id: int,
    role: str,
    organization_id: int | None,
) -> None:
    # удалить “старые” управляемые роли (и legacy), чтобы не оставалось лишних прав
    await db.execute(
        delete(UserRole).where(
            UserRole.user_id == int(target_user_id),
            UserRole.role.in_(list(PRIMARY_ROLE_VALUES)),
        )
    )
    db.add(
        UserRole(
            user_id=int(target_user_id),
            role=str(role),
            organization_id=int(organization_id) if organization_id is not None else None,
            location_id=None,
        )
    )


# --------------------------
# Schemas
# --------------------------

class UserCreateIn(BaseModel):
    full_name: str | None = Field(default=None, max_length=200)
    email: EmailStr
    password: str = Field(min_length=6, max_length=200)
    role: str = Field(..., description="admin | ops_director | service_manager | auditor")
    organization_id: int | None = None
    group_keys: list[str] | None = None
    is_active: bool = True


class UserPatchIn(BaseModel):
    full_name: str | None = Field(default=None, max_length=200)
    password: str | None = Field(default=None, min_length=6, max_length=200)
    is_active: bool | None = None


class UserRolePutIn(BaseModel):
    role: str
    organization_id: int | None = None
    group_keys: list[str] | None = None


# ==========================================================
# Users (list/detail) — admin + ops_director
# ==========================================================

@router.get("/users")
async def list_users(
    limit: int = 20,
    offset: int = 0,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _rbac=Depends(require_roles(Role.admin, Role.ops_director, Role.director, Role.super_admin)),
):
    """
    Admin/Ops director: list users.
    Scope:
      - admin-like: all users
      - ops_director: only users related to actor.allowed_org_ids
    """
    limit = max(1, min(int(limit), 100))
    offset = max(0, int(offset))

    is_admin_like = await _is_admin_like(db=db, user_id=actor.id)
    allowed_org_ids = await get_allowed_organization_ids(db=db, user=actor)

    where = []
    if q:
        where.append(func.lower(User.email).like(f"%{q.strip().lower()}%"))

    if not is_admin_like:
        user_ids = await _filter_users_to_allowed_orgs(db=db, allowed_org_ids=allowed_org_ids)
        if not user_ids:
            return {"items": [], "total": 0, "limit": limit, "offset": offset}
        where.append(User.id.in_(list(user_ids)))

    total_stmt = select(func.count(User.id))
    users_stmt = select(User).order_by(User.id.asc()).limit(limit).offset(offset)

    if where:
        total_stmt = total_stmt.where(*where)
        users_stmt = users_stmt.where(*where)

    total = (await db.execute(total_stmt)).scalar_one()
    users = (await db.execute(users_stmt)).scalars().all()

    items = []
    for u in users:
        items.append(
            {
                "id": u.id,
                "full_name": u.full_name,
                "email": u.email,
                "is_active": u.is_active,
                "created_at": u.created_at,
            }
        )

    return {"items": items, "total": int(total), "limit": limit, "offset": offset}


@router.get("/users/{user_id}")
async def get_user_detail(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _rbac=Depends(require_roles(Role.admin, Role.ops_director, Role.director, Role.super_admin)),
):
    """
    Admin/Ops director: user details + assignments (legacy + new group/org access).
    Scope:
      - admin-like: any user
      - ops_director: only users within actor.allowed_org_ids (and not belonging to other orgs)
    """
    target = (await db.execute(select(User).where(User.id == int(user_id)))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    is_admin_like = await _is_admin_like(db=db, user_id=actor.id)
    allowed_org_ids = await get_allowed_organization_ids(db=db, user=actor)

    if not is_admin_like:
        await _ops_target_scope_guard(db=db, actor=actor, target_user_id=target.id, actor_allowed_org_ids=allowed_org_ids)
        rel = await _filter_users_to_allowed_orgs(db=db, allowed_org_ids=allowed_org_ids)
        if target.id not in rel:
            raise HTTPException(status_code=403, detail="No access to this user")

    roles = (await db.execute(select(UserRole).where(UserRole.user_id == target.id))).scalars().all()
    org_links = (await db.execute(select(UserOrganization).where(UserOrganization.user_id == target.id))).scalars().all()
    grp_links = (await db.execute(select(UserGroupAccess).where(UserGroupAccess.user_id == target.id))).scalars().all()

    allowed_org_ids_target = await get_allowed_organization_ids(db=db, user=target)
    allowed_loc_ids_target = await get_allowed_location_ids(db=db, user=target)

    allowed_locs: list[Location] = []
    if allowed_loc_ids_target:
        allowed_locs = (
            await db.execute(
                select(Location)
                .where(Location.id.in_(allowed_loc_ids_target), Location.is_active == True)  # noqa: E712
                .order_by(Location.organization_id, Location.name)
            )
        ).scalars().all()

    return {
        "id": target.id,
        "full_name": target.full_name,
        "email": target.email,
        "is_active": target.is_active,
        "created_at": target.created_at,
        "roles": [
            {"role": r.role, "organization_id": r.organization_id, "location_id": r.location_id}
            for r in roles
        ],
        "organizations_access": [
            {"organization_id": int(x.organization_id), "is_active": bool(x.is_active)}
            for x in org_links
        ],
        "groups_access": [
            {"organization_id": int(x.organization_id), "group_key": str(x.group_key), "is_active": bool(x.is_active)}
            for x in grp_links
        ],
        "allowed_organization_ids": allowed_org_ids_target,
        "allowed_location_ids": allowed_loc_ids_target,
        "allowed_locations": [_location_payload(l) for l in allowed_locs],
    }


# ==========================================================
# Utilities for UI
# ==========================================================

@router.get("/organizations/{organization_id}/group-keys")
async def list_group_keys_for_org(
    organization_id: int,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _rbac=Depends(require_roles(Role.admin, Role.ops_director, Role.director, Role.super_admin)),
):
    is_admin_like = await _is_admin_like(db=db, user_id=actor.id)
    allowed_org_ids = await get_allowed_organization_ids(db=db, user=actor)

    if not is_admin_like and int(organization_id) not in {int(x) for x in allowed_org_ids}:
        raise HTTPException(status_code=403, detail="No access to this organization")

    await _ensure_org_exists(db=db, organization_id=int(organization_id))

    rows = (
        await db.execute(
            select(Location.type)
            .where(
                Location.organization_id == int(organization_id),
                Location.is_active == True,  # noqa: E712
            )
            .distinct()
            .order_by(Location.type.asc())
        )
    ).all()
    return [str(r[0]) for r in rows if r and r[0] is not None]


# ==========================================================
# Access management endpoints (from USERS-API-1)
# ==========================================================

@router.put("/users/{user_id}/org-access")
async def set_user_org_access(
    user_id: int,
    payload: dict = Body(default_factory=dict),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _rbac=Depends(require_roles(Role.admin, Role.ops_director, Role.director, Role.super_admin)),
):
    target = (await db.execute(select(User).where(User.id == int(user_id)))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    is_admin_like = await _is_admin_like(db=db, user_id=actor.id)
    allowed_org_ids = await get_allowed_organization_ids(db=db, user=actor)

    org_ids = _uniq_ints(payload.get("organization_ids") or [])

    if not is_admin_like:
        await _ops_target_scope_guard(db=db, actor=actor, target_user_id=target.id, actor_allowed_org_ids=allowed_org_ids)
        allowed_set = {int(x) for x in allowed_org_ids}
        if any(oid not in allowed_set for oid in org_ids):
            raise HTTPException(status_code=403, detail="Cannot grant access outside your organization scope")

    if org_ids:
        existing = (await db.execute(select(Organization.id).where(Organization.id.in_(org_ids)))).scalars().all()
        existing_set = {int(x) for x in existing}
        missing = [oid for oid in org_ids if int(oid) not in existing_set]
        if missing:
            raise HTTPException(status_code=404, detail={"organization_not_found": missing})

    await _set_user_org_access_exact(db=db, target_user_id=target.id, org_ids=org_ids)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict while updating org access")

    return {"ok": True, "user_id": target.id, "set": sorted(list({int(x) for x in org_ids}))}


@router.put("/users/{user_id}/organizations/{organization_id}/group-access")
async def set_user_group_access(
    user_id: int,
    organization_id: int,
    payload: dict = Body(default_factory=dict),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _rbac=Depends(require_roles(Role.admin, Role.ops_director, Role.director, Role.super_admin)),
):
    target = (await db.execute(select(User).where(User.id == int(user_id)))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    is_admin_like = await _is_admin_like(db=db, user_id=actor.id)
    allowed_org_ids = await get_allowed_organization_ids(db=db, user=actor)

    if not is_admin_like:
        await _ops_target_scope_guard(db=db, actor=actor, target_user_id=target.id, actor_allowed_org_ids=allowed_org_ids)
        allowed_set = {int(x) for x in allowed_org_ids}
        if int(organization_id) not in allowed_set:
            raise HTTPException(status_code=403, detail="No access to this organization")

    await _ensure_org_exists(db=db, organization_id=int(organization_id))

    group_keys = _uniq_strs(payload.get("group_keys") or [])
    valid = await _valid_group_keys_for_org(db=db, organization_id=int(organization_id))

    unknown = [g for g in group_keys if g not in valid]
    if unknown:
        raise HTTPException(status_code=422, detail={"unknown_group_keys": unknown, "valid": sorted(list(valid))})

    # ensure org link active
    await _set_user_org_access_exact(db=db, target_user_id=target.id, org_ids=[int(organization_id)])

    await _set_user_group_access_exact(
        db=db,
        target_user_id=target.id,
        organization_id=int(organization_id),
        group_keys=group_keys,
    )

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict while updating group access")

    return {"ok": True, "user_id": target.id, "organization_id": int(organization_id), "set": sorted(list({str(x) for x in group_keys}))}


# ==========================================================
# USERS-API-2: create/update user + role assignment
# ==========================================================

@router.post("/users")
async def create_user(
    data: UserCreateIn,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _rbac=Depends(require_roles(Role.admin, Role.ops_director, Role.director, Role.super_admin)),
):
    """
    POST /users
    - admin-like: can create any role
    - ops_director: cannot create admin/auditor, and must stay within own org scope
    """
    is_admin_like = await _is_admin_like(db=db, user_id=actor.id)
    is_ops = await _is_ops_director(db=db, user_id=actor.id)
    allowed_org_ids = await get_allowed_organization_ids(db=db, user=actor)

    role = str(data.role).strip()

    if role not in {Role.admin.value, Role.ops_director.value, Role.service_manager.value, Role.auditor.value}:
        raise HTTPException(status_code=422, detail="Unsupported role")

    if is_ops and not is_admin_like:
        if role in {Role.admin.value, Role.auditor.value}:
            raise HTTPException(status_code=403, detail="ops_director cannot create admin/auditor")

    org_id = int(data.organization_id) if data.organization_id is not None else None

    if role in {Role.ops_director.value, Role.service_manager.value}:
        if org_id is None:
            raise HTTPException(status_code=422, detail="organization_id is required for this role")
        await _ensure_org_exists(db=db, organization_id=org_id)

        if is_ops and not is_admin_like:
            if org_id not in {int(x) for x in allowed_org_ids}:
                raise HTTPException(status_code=403, detail="Cannot assign outside your organization scope")

    if role in {Role.admin.value, Role.auditor.value}:
        org_id = None

    email = str(data.email).strip().lower()

    u = User(
        full_name=(data.full_name.strip() if data.full_name else None),
        email=email,
        password_hash=hash_password(data.password),
        is_active=bool(data.is_active),
    )
    db.add(u)

    try:
        await db.flush()  # get u.id without commit
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Email already exists")

    # role
    await _replace_primary_role(db=db, target_user_id=u.id, role=role, organization_id=org_id)

    # org/group bindings (optional convenience)
    if role == Role.ops_director.value and org_id is not None:
        await _set_user_org_access_exact(db=db, target_user_id=u.id, org_ids=[org_id])

    if role == Role.service_manager.value and org_id is not None:
        await _set_user_org_access_exact(db=db, target_user_id=u.id, org_ids=[org_id])

        group_keys = _uniq_strs(data.group_keys or [])
        if group_keys:
            valid = await _valid_group_keys_for_org(db=db, organization_id=org_id)
            unknown = [g for g in group_keys if g not in valid]
            if unknown:
                raise HTTPException(status_code=422, detail={"unknown_group_keys": unknown, "valid": sorted(list(valid))})
            await _set_user_group_access_exact(db=db, target_user_id=u.id, organization_id=org_id, group_keys=group_keys)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict while creating user")

    return {"ok": True, "id": u.id, "full_name": u.full_name, "email": u.email, "is_active": u.is_active}


@router.patch("/users/{user_id}")
async def patch_user(
    user_id: int,
    data: UserPatchIn,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _rbac=Depends(require_roles(Role.admin, Role.ops_director, Role.director, Role.super_admin)),
):
    """
    PATCH /users/{id}
    - fields: full_name, password, is_active
    - ops_director: only within own org scope (cannot touch users of other orgs)
    """
    target = (await db.execute(select(User).where(User.id == int(user_id)))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    is_admin_like = await _is_admin_like(db=db, user_id=actor.id)
    is_ops = await _is_ops_director(db=db, user_id=actor.id)
    allowed_org_ids = await get_allowed_organization_ids(db=db, user=actor)

    if is_ops and not is_admin_like:
        await _ops_target_scope_guard(db=db, actor=actor, target_user_id=target.id, actor_allowed_org_ids=allowed_org_ids)
        rel = await _filter_users_to_allowed_orgs(db=db, allowed_org_ids=allowed_org_ids)
        if target.id not in rel:
            raise HTTPException(status_code=403, detail="No access to this user")

    if data.full_name is not None:
        target.full_name = data.full_name.strip() if data.full_name else None

    if data.is_active is not None:
        target.is_active = bool(data.is_active)

    if data.password is not None:
        target.password_hash = hash_password(data.password)

    db.add(target)
    await db.commit()

    return {"ok": True, "id": target.id, "full_name": target.full_name, "email": target.email, "is_active": target.is_active}


@router.put("/users/{user_id}/role")
async def set_user_role(
    user_id: int,
    data: UserRolePutIn,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
    _rbac=Depends(require_roles(Role.admin, Role.ops_director, Role.director, Role.super_admin)),
):
    """
    PUT /users/{id}/role
    - admin-like: can assign any role
    - ops_director: cannot assign admin/auditor and cannot touch foreign org users
    """
    target = (await db.execute(select(User).where(User.id == int(user_id)))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    is_admin_like = await _is_admin_like(db=db, user_id=actor.id)
    is_ops = await _is_ops_director(db=db, user_id=actor.id)
    allowed_org_ids = await get_allowed_organization_ids(db=db, user=actor)

    if is_ops and not is_admin_like:
        await _ops_target_scope_guard(db=db, actor=actor, target_user_id=target.id, actor_allowed_org_ids=allowed_org_ids)

    role = str(data.role).strip()
    if role not in {Role.admin.value, Role.ops_director.value, Role.service_manager.value, Role.auditor.value}:
        raise HTTPException(status_code=422, detail="Unsupported role")

    if is_ops and not is_admin_like:
        if role in {Role.admin.value, Role.auditor.value}:
            raise HTTPException(status_code=403, detail="ops_director cannot assign admin/auditor")

    org_id = int(data.organization_id) if data.organization_id is not None else None

    if role in {Role.ops_director.value, Role.service_manager.value}:
        if org_id is None:
            raise HTTPException(status_code=422, detail="organization_id is required for this role")
        await _ensure_org_exists(db=db, organization_id=org_id)

        if is_ops and not is_admin_like:
            if org_id not in {int(x) for x in allowed_org_ids}:
                raise HTTPException(status_code=403, detail="Cannot assign outside your organization scope")

    if role in {Role.admin.value, Role.auditor.value}:
        org_id = None

    # replace role
    await _replace_primary_role(db=db, target_user_id=target.id, role=role, organization_id=org_id)

    # normalize bindings
    if role in {Role.admin.value, Role.auditor.value}:
        # these roles are global; org/group bindings are not required
        await _set_user_org_access_exact(db=db, target_user_id=target.id, org_ids=[])
        await _clear_all_group_access(db=db, target_user_id=target.id)

    if role == Role.ops_director.value and org_id is not None:
        await _set_user_org_access_exact(db=db, target_user_id=target.id, org_ids=[org_id])
        await _clear_all_group_access(db=db, target_user_id=target.id)

    if role == Role.service_manager.value and org_id is not None:
        await _set_user_org_access_exact(db=db, target_user_id=target.id, org_ids=[org_id])

        group_keys = _uniq_strs(data.group_keys or [])
        if group_keys:
            valid = await _valid_group_keys_for_org(db=db, organization_id=org_id)
            unknown = [g for g in group_keys if g not in valid]
            if unknown:
                raise HTTPException(status_code=422, detail={"unknown_group_keys": unknown, "valid": sorted(list(valid))})
            await _set_user_group_access_exact(db=db, target_user_id=target.id, organization_id=org_id, group_keys=group_keys)
        else:
            # если не передали group_keys — не трогаем существующие (вдруг ты редактируешь только роль)
            pass

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Conflict while updating role")

    return {"ok": True, "user_id": target.id, "role": role, "organization_id": org_id}
