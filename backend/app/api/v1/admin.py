from __future__ import annotations
from datetime import datetime
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, cast, Integer

from app.api.v1.deps import (
    get_db,
    get_current_user,
    get_allowed_organization_ids,
    get_allowed_location_ids,
    GLOBAL_ROLE_VALUES,
    user_has_any_role,
)
from app.models.submission import Submission
from app.services.rbac import require_roles
from app.models.role import Role
from app.models.organization import Organization
from app.models.location import Location
from app.models.user import User
from app.models.user_organization import UserOrganization
from app.models.token import UserRole

router = APIRouter(prefix="/admin", tags=["admin"])


def _slugify(value: str) -> str:
    s = (value or "").strip().lower()
    s = s.replace("_", "-")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s


async def _make_unique_location_slug(db: AsyncSession, base: str) -> str:
    base = _slugify(base)
    if not base:
        raise HTTPException(status_code=400, detail="Cannot generate slug")

    slug = base
    for i in range(0, 50):
        exists = (await db.execute(select(Location.id).where(Location.slug == slug))).scalar_one_or_none()
        if not exists:
            return slug
        slug = f"{base}-{i+2}"

    raise HTTPException(status_code=409, detail="Cannot generate unique slug")


# Оставляем твой endpoint, чтобы ничего не упало
@router.get("/me")
async def me(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _user=Depends(require_roles(Role.manager, Role.service_manager, Role.director, Role.auditor_global)),
):
    roles = (
        await db.execute(select(UserRole).where(UserRole.user_id == user.id))
    ).scalars().all()

    is_global = any(r.role in GLOBAL_ROLE_VALUES for r in roles)

    allowed_org_ids = await get_allowed_organization_ids(db=db, user=user)
    allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)

    locs = []
    if allowed_loc_ids:
        locs = (
            await db.execute(
                select(Location)
                .where(Location.id.in_(allowed_loc_ids), Location.is_active == True)  # noqa: E712
                .order_by(Location.organization_id, Location.name)
            )
        ).scalars().all()

    return {
        "id": user.id,
        "email": user.email,
        "is_global": bool(is_global),
        "roles": [
            {"role": r.role, "organization_id": r.organization_id, "location_id": r.location_id}
            for r in roles
        ],
        "allowed_organization_ids": allowed_org_ids,
        "allowed_locations": [
            {
                "id": l.id,
                "organization_id": l.organization_id,
                "type": l.type,
                "code": l.code,
                "name": l.name,
                "slug": l.slug,
                "is_active": l.is_active,
            }
            for l in locs
        ],
    }


# =========================
# Organizations (Hotels)
# =========================

@router.get("/organizations")
async def list_organizations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.manager, Role.service_manager, Role.director, Role.auditor_global)),
):
    """
    Важно для админки CRUD:
      - для глобальных ролей возвращаем ВСЕ организации (включая is_active=False),
        чтобы можно было реактивировать
      - для scoped пользователей — только доступные активные
    """
    is_global = await user_has_any_role(db, user, GLOBAL_ROLE_VALUES)

    if is_global:
        orgs = (await db.execute(select(Organization).order_by(Organization.id))).scalars().all()
    else:
        allowed = await get_allowed_organization_ids(db=db, user=user)
        if not allowed:
            return []
        orgs = (
            await db.execute(
                select(Organization)
                .where(Organization.id.in_(allowed))
                .order_by(Organization.id)
            )
        ).scalars().all()

    return [{"id": o.id, "name": o.name, "slug": o.slug, "is_active": o.is_active} for o in orgs]


@router.post("/organizations")
async def create_organization(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_roles(Role.director)),  # создавать отели может директор (глобальный)
):
    """
    Создать новую организацию (отель).
    payload: { "name": "Hotel X", "slug": "hotel-x" }
    """
    name = (payload.get("name") or "").strip()
    slug = (payload.get("slug") or "").strip()

    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if not slug:
        raise HTTPException(status_code=400, detail="slug is required")

    org = Organization(name=name, slug=slug, is_active=True)
    db.add(org)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Organization slug already exists")

    await db.refresh(org)
    return {"id": org.id, "name": org.name, "slug": org.slug, "is_active": org.is_active}


@router.patch("/organizations/{organization_id}")
async def update_organization(
    organization_id: int,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_roles(Role.director)),
):
    """
    payload (any subset):
      { "name": "...", "slug": "...", "is_active": true|false }
    """
    org = (await db.execute(select(Organization).where(Organization.id == organization_id))).scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if "name" in payload:
        name = (payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        org.name = name

    if "slug" in payload:
        slug = (payload.get("slug") or "").strip()
        if not slug:
            raise HTTPException(status_code=400, detail="slug cannot be empty")
        org.slug = _slugify(slug) or slug

    if "is_active" in payload:
        org.is_active = bool(payload.get("is_active"))

    db.add(org)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Organization slug already exists")

    await db.refresh(org)
    return {"id": org.id, "name": org.name, "slug": org.slug, "is_active": org.is_active}



@router.post("/organizations/{organization_id}/grant")
async def grant_user_to_organization(
    organization_id: int,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_roles(Role.director)),  # доступы выдаёт директор
):
    """
    Выдать пользователю доступ к организации (отелю).
    payload: { "user_id": 123 }
    """
    try:
        user_id = int(payload["user_id"])
    except Exception:
        raise HTTPException(status_code=400, detail="user_id is required")

    org = (
        await db.execute(select(Organization).where(Organization.id == organization_id))
    ).scalar_one_or_none()
    if not org or not org.is_active:
        raise HTTPException(status_code=404, detail="Organization not found")

    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")

    link = (
        await db.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == user_id,
                UserOrganization.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()

    if link:
        link.is_active = True
        db.add(link)
        await db.commit()
        return {"ok": True, "user_id": user_id, "organization_id": organization_id, "status": "reactivated"}

    link = UserOrganization(user_id=user_id, organization_id=organization_id, is_active=True)
    db.add(link)
    await db.commit()
    return {"ok": True, "user_id": user_id, "organization_id": organization_id, "status": "granted"}


# =========================
# Locations (Rooms/Restaurants/Halls)
# =========================

@router.get("/organizations/{organization_id}/locations")
async def list_locations(
    organization_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.manager, Role.service_manager, Role.director, Role.auditor_global)),
):
    """
    RBAC:
      - director/auditor_global -> все локации org (включая inactive)
      - manager/auditor (org-wide) -> все ACTIVE локации org (если org доступна)
      - service_manager/employee -> только назначенные ACTIVE локации в рамках org
    """
    org = (await db.execute(select(Organization).where(Organization.id == organization_id))).scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    is_global = await user_has_any_role(db, user, GLOBAL_ROLE_VALUES)

    if is_global:
        q = select(Location).where(Location.organization_id == organization_id)
    else:
        allowed_orgs = await get_allowed_organization_ids(db=db, user=user)
        if organization_id not in allowed_orgs:
            raise HTTPException(status_code=403, detail="No access to this organization")

        role_rows = (
            await db.execute(
                select(UserRole.role, UserRole.organization_id, UserRole.location_id)
                .where(UserRole.user_id == user.id)
            )
        ).all()

        has_org_wide = any(
            (r[0] in {Role.manager.value, Role.auditor.value})
            and (r[1] is None or r[1] == organization_id)
            and (r[2] is None)
            for r in role_rows
        )

        if has_org_wide:
            q = select(Location).where(
                Location.organization_id == organization_id,
                Location.is_active == True,  # noqa: E712
            )
        else:
            allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
            if not allowed_loc_ids:
                return []
            q = select(Location).where(
                Location.organization_id == organization_id,
                Location.id.in_(allowed_loc_ids),
                Location.is_active == True,  # noqa: E712
            )

    locs = (await db.execute(q.order_by(Location.name))).scalars().all()

    return [
        {
            "id": l.id,
            "organization_id": l.organization_id,
            "type": l.type,
            "code": l.code,
            "name": l.name,
            "slug": l.slug,
            "is_active": l.is_active,
        }
        for l in locs
    ]


@router.post("/locations")
async def create_location(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_roles(Role.director)),
):
    """
    payload:
    {
      "organization_id": 1,
      "type": "room|restaurant|conference_hall|banquet_hall|other",
      "code": "301",
      "name": "Номер 301",
      "slug": "demo-hotel-301"   # optional; если не задан — генерим {org_slug}-{code}
    }
    """
    try:
        organization_id = int(payload["organization_id"])
    except Exception:
        raise HTTPException(status_code=400, detail="organization_id is required")

    org = (await db.execute(select(Organization).where(Organization.id == organization_id))).scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    loc_type = (payload.get("type") or "room").strip()
    code = (payload.get("code") or "").strip()
    name = (payload.get("name") or "").strip()
    slug = (payload.get("slug") or "").strip()

    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    if slug:
        slug = _slugify(slug)
        if not slug:
            raise HTTPException(status_code=400, detail="Invalid slug")
    else:
        suffix_src = code or name
        suffix = _slugify(suffix_src)
        if not suffix:
            raise HTTPException(status_code=400, detail="code or name must be non-empty to generate slug")
        base = f"{org.slug}-{suffix}"
        slug = await _make_unique_location_slug(db, base)

    loc = Location(
        organization_id=organization_id,
        type=loc_type,
        code=code,
        name=name,
        slug=slug,
        is_active=True,
    )

    db.add(loc)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Location slug already exists")

    await db.refresh(loc)
    return {
        "id": loc.id,
        "organization_id": loc.organization_id,
        "type": loc.type,
        "code": loc.code,
        "name": loc.name,
        "slug": loc.slug,
        "is_active": loc.is_active,
    }


@router.patch("/locations/{location_id}")
async def update_location(
    location_id: int,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_roles(Role.director)),
):
    """
    payload (any subset):
      { "name": "...", "type": "...", "code": "...", "is_active": true|false }
    """
    loc = (await db.execute(select(Location).where(Location.id == location_id))).scalar_one_or_none()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")

    if "name" in payload:
        name = (payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        loc.name = name

    if "type" in payload:
        loc.type = (payload.get("type") or "room").strip() or "room"

    if "code" in payload:
        loc.code = (payload.get("code") or "").strip()

    if "is_active" in payload:
        loc.is_active = bool(payload.get("is_active"))

    db.add(loc)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Location slug already exists")

    await db.refresh(loc)
    return {
        "id": loc.id,
        "organization_id": loc.organization_id,
        "type": loc.type,
        "code": loc.code,
        "name": loc.name,
        "slug": loc.slug,
        "is_active": loc.is_active,
    }



@router.post("/locations/bulk-rooms")
async def bulk_create_rooms(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.service_manager, Role.director)),
):
    """
    Массовое создание номеров (эффектно на демо).
    payload:
    {
      "organization_id": 1,
      "from": 101,
      "to": 120,
      "slug_prefix": "room-",
      "name_prefix": "Номер ",
      "type": "room"
    }
    """
    try:
        organization_id = int(payload["organization_id"])
        start = int(payload["from"])
        end = int(payload["to"])
    except Exception:
        raise HTTPException(status_code=400, detail="organization_id, from, to are required")

    if start > end or start <= 0:
        raise HTTPException(status_code=400, detail="Invalid range")

    allowed = await get_allowed_organization_ids(db=db, user=user)
    if organization_id not in allowed:
        raise HTTPException(status_code=403, detail="No access to this organization")

    slug_prefix = (payload.get("slug_prefix") or "room-").strip()
    name_prefix = (payload.get("name_prefix") or "Номер ").strip()
    loc_type = (payload.get("type") or "room").strip()

    created = 0
    skipped = 0

    for num in range(start, end + 1):
        slug = f"{slug_prefix}{num}"
        name = f"{name_prefix}{num}"
        loc = Location(
            organization_id=organization_id,
            type=loc_type,
            code=str(num),
            name=name,
            slug=slug,
            is_active=True,
        )
        db.add(loc)
        try:
            await db.flush()  # ловим уникальные конфликты в цикле
            created += 1
        except Exception:
            await db.rollback()
            skipped += 1
            continue

    await db.commit()
    return {"ok": True, "created": created, "skipped": skipped}


@router.patch("/locations/{location_id}/deactivate")
async def deactivate_location(
    location_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.manager, Role.service_manager, Role.director)),
):
    loc = (await db.execute(select(Location).where(Location.id == location_id))).scalar_one_or_none()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")

    allowed = await get_allowed_organization_ids(db=db, user=user)
    if loc.organization_id not in allowed:
        raise HTTPException(status_code=403, detail="No access to this location")

    loc.is_active = False
    db.add(loc)
    await db.commit()
    return {"ok": True, "id": loc.id, "is_active": loc.is_active}


@router.patch("/locations/{location_id}/activate")
async def activate_location(
    location_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.manager, Role.service_manager, Role.director)),
):
    loc = (await db.execute(select(Location).where(Location.id == location_id))).scalar_one_or_none()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")

    allowed = await get_allowed_organization_ids(db=db, user=user)
    if loc.organization_id not in allowed:
        raise HTTPException(status_code=403, detail="No access to this location")

    loc.is_active = True
    db.add(loc)
    await db.commit()
    return {"ok": True, "id": loc.id, "is_active": loc.is_active}


@router.get("/locations/{location_id}/submissions")
async def list_submissions(
    location_id: int,
    limit: int = 20,
    offset: int = 0,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    rating_min: int | None = None,
    rating_max: int | None = None,
    has_comment: bool | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.director, Role.auditor_global, Role.auditor, Role.manager, Role.service_manager, Role.employee)),
):
    # RBAC по location
    allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
    if location_id not in allowed_loc_ids:
        raise HTTPException(status_code=403, detail="No access to this location")

    # Базовые выражения по JSON answers
    rating_expr = cast(func.nullif(Submission.answers["rating_overall"].astext, ""), Integer)
    comment_expr = func.coalesce(Submission.answers["comment"].astext, "")

    where = [Submission.location_id == location_id]

    if created_from is not None:
        where.append(Submission.created_at >= created_from)
    if created_to is not None:
        where.append(Submission.created_at <= created_to)

    if rating_min is not None:
        where.append(rating_expr >= int(rating_min))
    if rating_max is not None:
        where.append(rating_expr <= int(rating_max))

    if has_comment is True:
        where.append(func.length(func.trim(comment_expr)) > 0)
    elif has_comment is False:
        where.append(func.length(func.trim(comment_expr)) == 0)

    # total
    total = (
        await db.execute(
            select(func.count(Submission.id)).where(*where)
        )
    ).scalar_one()

    # items
    rows = (
        await db.execute(
            select(Submission)
            .where(*where)
            .order_by(desc(Submission.created_at), desc(Submission.id))
            .offset(offset)
            .limit(min(max(limit, 1), 100))
        )
    ).scalars().all()

    items = []
    for s in rows:
        a = s.answers or {}
        items.append(
            {
                "id": s.id,
                "location_id": s.location_id,
                "survey_version_id": s.survey_version_id,
                "created_at": s.created_at.isoformat(),
                "rating_overall": a.get("rating_overall"),
                "comment": a.get("comment") or "",
                "name": a.get("name") or "",
                "email": a.get("email") or "",
            }
        )

    return {"total": int(total), "limit": int(limit), "offset": int(offset), "items": items}


@router.get("/submissions/{submission_id}")
async def get_submission(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.director, Role.auditor_global, Role.auditor, Role.manager, Role.service_manager, Role.employee)),
):
    s = (
        await db.execute(select(Submission).where(Submission.id == submission_id))
    ).scalar_one_or_none()

    if not s:
        raise HTTPException(status_code=404, detail="Submission not found")

    allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
    if s.location_id not in allowed_loc_ids:
        raise HTTPException(status_code=403, detail="No access to this submission")

    a = s.answers or {}
    return {
        "id": s.id,
        "location_id": s.location_id,
        "survey_version_id": s.survey_version_id,
        "created_at": s.created_at.isoformat(),
        "answers": a,
        "meta": s.meta or {},
        "rating_overall": a.get("rating_overall"),
        "comment": a.get("comment") or "",
        "name": a.get("name") or "",
        "email": a.get("email") or "",
    }
