from __future__ import annotations
from datetime import datetime, timezone, date
import re
import copy
import csv
import io
import itertools

from fastapi import APIRouter, Depends, HTTPException, Body, Query, UploadFile, File, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select, func, desc, cast, Integer, update

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
from app.models.survey import Survey, SurveyVersion
from app.models.user import User
from app.models.user_organization import UserOrganization
from app.models.token import UserRole
from app.models.stay import Stay
from app.api.v1.stays import router as stays_router

router = APIRouter(prefix="/admin", tags=["admin"])


router.include_router(stays_router)

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


@router.get("/organizations/{organization_id}")
async def get_organization(
    organization_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.manager, Role.service_manager, Role.director, Role.auditor_global)),
):
    """
    Single organization fetch:
      - global roles: can read any org (including inactive)
      - non-global: only allowed orgs AND only if org.is_active
    """
    org = (await db.execute(select(Organization).where(Organization.id == organization_id))).scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    is_global = await user_has_any_role(db, user, GLOBAL_ROLE_VALUES)

    if not is_global:
        allowed_orgs = await get_allowed_organization_ids(db=db, user=user)
        if organization_id not in allowed_orgs:
            raise HTTPException(status_code=403, detail="No access to this organization")
        if not org.is_active:
            # non-global users don't see deactivated orgs
            raise HTTPException(status_code=404, detail="Organization not found")

    return {"id": org.id, "name": org.name, "slug": org.slug, "is_active": org.is_active}


@router.get("/locations/{location_id}")
async def get_location(
    location_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.manager, Role.service_manager, Role.director, Role.auditor_global)),
):
    """
    Single location fetch:
      - global roles: can read any location (including inactive)
      - non-global:
          * must have access to its organization
          * if org-wide manager/auditor -> any ACTIVE location in org
          * else -> only if location_id in allowed_location_ids
          * inactive locations hidden from non-global
    """
    loc = (await db.execute(select(Location).where(Location.id == location_id))).scalar_one_or_none()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")

    is_global = await user_has_any_role(db, user, GLOBAL_ROLE_VALUES)

    if not is_global:
        # hide inactive from non-global
        if not loc.is_active:
            raise HTTPException(status_code=404, detail="Location not found")

        allowed_orgs = await get_allowed_organization_ids(db=db, user=user)
        if loc.organization_id not in allowed_orgs:
            raise HTTPException(status_code=403, detail="No access to this location")

        # org-wide roles check (manager/auditor with no location_id)
        role_rows = (
            await db.execute(
                select(UserRole.role, UserRole.organization_id, UserRole.location_id)
                .where(UserRole.user_id == user.id)
            )
        ).all()

        has_org_wide = any(
            (r[0] in {Role.manager.value, Role.auditor.value})
            and (r[1] is None or r[1] == loc.organization_id)
            and (r[2] is None)
            for r in role_rows
        )

        if not has_org_wide:
            allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
            if loc.id not in allowed_loc_ids:
                raise HTTPException(status_code=403, detail="No access to this location")

    return {
        "id": loc.id,
        "organization_id": loc.organization_id,
        "type": loc.type,
        "code": loc.code,
        "name": loc.name,
        "slug": loc.slug,
        "is_active": loc.is_active,
    }


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
        m = s.meta or {}

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

                # Patch 8.4.1: гостевой контекст (из meta)
                "room": m.get("room") or "",
                "guest_name": m.get("guest_name") or "",
                "reservation_code": m.get("reservation_code"),
                "stay_id": m.get("stay_id"),
            }
        )

    return {"total": int(total), "limit": int(limit), "offset": int(offset), "items": items}


@router.get("/submissions/{submission_id}")
async def get_submission(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(
        require_roles(
            Role.director,
            Role.auditor_global,
            Role.auditor,
            Role.manager,
            Role.service_manager,
            Role.employee,
        )
    ),
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
    m = s.meta or {}

    guest_context = None
    if any(k in m for k in ("stay_id", "guest_name", "room", "checkin_at", "checkout_at", "reservation_code")):
        guest_context = {
            "stay_id": m.get("stay_id"),
            "guest_name": m.get("guest_name"),
            "room": m.get("room"),
            "checkin_at": m.get("checkin_at"),
            "checkout_at": m.get("checkout_at"),
            "reservation_code": m.get("reservation_code"),
            "stay_source": m.get("stay_source"),
        }

    return {
        "id": s.id,
        "location_id": s.location_id,
        "survey_version_id": s.survey_version_id,
        "created_at": s.created_at.isoformat(),
        "answers": a,
        "meta": m,

        # Patch 8.4.1 (не ломает старых клиентов)
        "guest_context": guest_context,
        "room": m.get("room") or "",
        "guest_name": m.get("guest_name") or "",
        "reservation_code": m.get("reservation_code"),
        "stay_id": m.get("stay_id"),

        "rating_overall": a.get("rating_overall"),
        "comment": a.get("comment") or "",
        "name": a.get("name") or "",
        "email": a.get("email") or "",
    }



# =========================
# Stays (Patch 8.2.1)
# =========================

def _decode_csv_bytes(data: bytes) -> tuple[str, str]:
    """Decode bytes to text, максимально терпимо.

    Порядок предпочтений:
      - utf-8-sig / utf-8 (строгий)
      - cp1251
      - latin-1 (как последняя попытка)
    """
    for enc in ("utf-8-sig", "utf-8"):
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            pass

    # cp1251 почти всегда "декодирует", но это ожидаемо для RU выгрузок
    try:
        return data.decode("cp1251"), "cp1251"
    except Exception:
        return data.decode("latin-1", errors="replace"), "latin-1"


def _detect_delimiter(sample: str) -> str:
    sample = sample or ""
    sniffer = csv.Sniffer()
    try:
        dialect = sniffer.sniff(sample, delimiters=";\t,|")
        return dialect.delimiter
    except Exception:
        first = sample.splitlines()[0] if sample.splitlines() else sample
        cands = [";", ",", "\t", "|"]
        best = max(cands, key=lambda d: first.count(d))
        return best


def _norm_header(s: str) -> str:
    s = (s or "").strip().lower()
    s = s.replace("\ufeff", "")
    s = re.sub(r"[\s\-\/]+", "_", s)
    s = re.sub(r"[^a-z0-9а-яё_]+", "", s)
    s = re.sub(r"_{2,}", "_", s).strip("_")
    return s


def _parse_date_any(v: str | None) -> date | None:
    if v is None:
        return None
    s = (str(v) or "").strip()
    if not s:
        return None

    s = s.split("T")[0].split(" ")[0]

    fmts = [
        "%Y-%m-%d",
        "%d.%m.%Y",
        "%d.%m.%y",
        "%d/%m/%Y",
        "%d/%m/%y",
        "%d-%m-%Y",
        "%d-%m-%y",
    ]
    for fmt in fmts:
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            continue

    try:
        return datetime.fromisoformat(s).date()
    except Exception:
        return None


def _build_stay_field_map(headers: list[str]) -> dict[str, str]:
    """Map our canonical fields -> csv header key.

    Returns keys: room, guest_name, checkin, checkout, reservation_code
    """
    norm_to_raw = {_norm_header(h): h for h in headers}
    keys = set(norm_to_raw.keys())

    def pick(cands: set[str]) -> str | None:
        for c in cands:
            if c in keys:
                return norm_to_raw[c]
        return None

    room = pick({"room", "room_no", "roomnumber", "номер", "номеркомнаты", "комната", "rm", "номер_комнаты"})
    checkin = pick({"checkin", "arrival", "arrival_date", "arrive", "datein", "дата_заезда", "заезд"})
    checkout = pick({"checkout", "departure", "departure_date", "depart", "dateout", "дата_выезда", "выезд"})
    reservation_code = pick({"reservation_code", "reservation", "res", "resno", "booking", "booking_id", "confirmation", "folio", "folio_no", "код_брони", "номер_брони", "бронь"})

    guest_name = pick({"guest_name", "guest", "name", "fullname", "fio", "фио", "гость", "клиент", "guestfullname", "guestname"})

    last = pick({"last_name", "lastname", "surname", "фамилия"})
    first = pick({"first_name", "firstname", "имя"})
    middle = pick({"middle_name", "middlename", "patronymic", "отчество"})

    return {
        "room": room or "",
        "guest_name": guest_name or "",
        "guest_last": last or "",
        "guest_first": first or "",
        "guest_middle": middle or "",
        "checkin": checkin or "",
        "checkout": checkout or "",
        "reservation_code": reservation_code or "",
    }


@router.get("/locations/{location_id}/stays")
async def list_stays(
    location_id: int,
    room: str | None = None,
    q: str | None = None,
    on: date | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.director, Role.auditor_global, Role.auditor, Role.manager, Role.service_manager)),
):
    allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
    if location_id not in allowed_loc_ids:
        raise HTTPException(status_code=403, detail="No access to this location")

    where = [Stay.location_id == location_id]
    if room:
        where.append(Stay.room == room.strip())
    if q:
        where.append(func.lower(Stay.guest_name).like(f"%{q.strip().lower()}%"))
    if on:
        where.append(Stay.checkin_at <= on)
        where.append(Stay.checkout_at > on)

    total = (await db.execute(select(func.count(Stay.id)).where(*where))).scalar_one()

    rows = (
        await db.execute(
            select(Stay)
            .where(*where)
            .order_by(Stay.checkin_at.desc(), Stay.room.asc(), Stay.id.desc())
            .offset(max(int(offset), 0))
            .limit(min(max(int(limit), 1), 200))
        )
    ).scalars().all()

    items = []
    for s in rows:
        items.append(
            {
                "id": s.id,
                "location_id": s.location_id,
                "room": s.room,
                "guest_name": s.guest_name,
                "checkin_at": s.checkin_at.isoformat(),
                "checkout_at": s.checkout_at.isoformat(),
                "reservation_code": s.reservation_code,
                "source": s.source,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
        )

    return {"total": int(total), "limit": int(limit), "offset": int(offset), "items": items}


@router.post("/locations/{location_id}/stays/import")
async def import_stays_csv(
    location_id: int,
    file: UploadFile = File(...),
    source: str = Query("csv", max_length=40),
    max_rows: int = Query(20000, ge=1, le=50000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.director, Role.manager, Role.service_manager)),
):
    allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
    if location_id not in allowed_loc_ids:
        raise HTTPException(status_code=403, detail="No access to this location")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")

    text, encoding = _decode_csv_bytes(raw)
    sample = "\n".join(text.splitlines()[:20])
    delimiter = _detect_delimiter(sample)

    buf = io.StringIO(text)
    reader = csv.reader(buf, delimiter=delimiter)

    first_row = None
    for row in reader:
        if any((c or "").strip() for c in row):
            first_row = row
            break

    if first_row is None:
        raise HTTPException(status_code=400, detail="No data rows")

    first_norm = [_norm_header(x) for x in first_row]
    looks_like_header = any(
        k in first_norm for k in ("room", "номер", "комната", "фио", "guest_name", "arrival", "дата_заезда")
    )

    inserted = 0
    updated = 0
    skipped = 0
    errors: list[dict] = []

    if looks_like_header:
        headers = [c.strip() for c in first_row]
        field_map = _build_stay_field_map(headers)
        # важно: header уже прочитан csv.reader → указатель буфера стоит после header
        reader_iter = csv.DictReader(buf, fieldnames=headers, delimiter=delimiter)
    else:
        field_map = {
            "room": "__col0__",
            "guest_name": "__col1__",
            "checkin": "__col2__",
            "checkout": "__col3__",
            "reservation_code": "__col4__",
            "guest_last": "",
            "guest_first": "",
            "guest_middle": "",
        }
        reader_iter = itertools.chain([first_row], reader)

    def get_val(d: dict, key: str) -> str:
        v = d.get(key)
        return (str(v) if v is not None else "").strip()

    def build_guest_name(d: dict) -> str:
        if field_map.get("guest_name"):
            raw_name = get_val(d, field_map["guest_name"])
            if raw_name:
                return raw_name
        parts = []
        if field_map.get("guest_last"):
            parts.append(get_val(d, field_map["guest_last"]))
        if field_map.get("guest_first"):
            parts.append(get_val(d, field_map["guest_first"]))
        if field_map.get("guest_middle"):
            parts.append(get_val(d, field_map["guest_middle"]))
        return " ".join([p for p in parts if p]).strip()

    row_idx = 1

    async def upsert_one(room_v: str, guest_v: str, ci: date, co: date, res_code: str | None):
        nonlocal inserted, updated
        code = (res_code or "").strip() or None
        existing = None
        if code:
            existing = (
                await db.execute(
                    select(Stay).where(Stay.location_id == location_id, Stay.reservation_code == code)
                )
            ).scalar_one_or_none()
        else:
            existing = (
                await db.execute(
                    select(Stay).where(
                        Stay.location_id == location_id,
                        Stay.room == room_v,
                        Stay.guest_name == guest_v,
                        Stay.checkin_at == ci,
                        Stay.checkout_at == co,
                        Stay.reservation_code.is_(None),
                    )
                )
            ).scalar_one_or_none()

        if existing:
            existing.room = room_v
            existing.guest_name = guest_v
            existing.checkin_at = ci
            existing.checkout_at = co
            existing.reservation_code = code
            existing.source = source
            db.add(existing)
            updated += 1
        else:
            db.add(
                Stay(
                    location_id=location_id,
                    room=room_v,
                    guest_name=guest_v,
                    checkin_at=ci,
                    checkout_at=co,
                    reservation_code=code,
                    source=source,
                )
            )
            inserted += 1

    if looks_like_header:
        for d in reader_iter:
            if d is None:
                continue
            row_idx += 1
            if inserted + updated + skipped >= max_rows:
                break

            try:
                room_v = get_val(d, field_map["room"]) if field_map.get("room") else ""
                guest_v = build_guest_name(d)
                ci_s = get_val(d, field_map["checkin"]) if field_map.get("checkin") else ""
                co_s = get_val(d, field_map["checkout"]) if field_map.get("checkout") else ""
                res_code = get_val(d, field_map["reservation_code"]) if field_map.get("reservation_code") else ""

                if not room_v or not guest_v:
                    skipped += 1
                    continue

                ci = _parse_date_any(ci_s)
                co = _parse_date_any(co_s)
                if ci is None or co is None:
                    raise ValueError(f"Bad dates: checkin='{ci_s}', checkout='{co_s}'")
                if co < ci:
                    raise ValueError("checkout < checkin")

                await upsert_one(room_v, guest_v, ci, co, res_code)
            except Exception as e:
                errors.append({"row": row_idx, "error": str(e)})
    else:
        for row in reader_iter:
            if not row or not any((c or "").strip() for c in row):
                continue
            row_idx += 1
            if inserted + updated + skipped >= max_rows:
                break
            try:
                room_v = (row[0] or "").strip() if len(row) > 0 else ""
                guest_v = (row[1] or "").strip() if len(row) > 1 else ""
                ci_s = (row[2] or "").strip() if len(row) > 2 else ""
                co_s = (row[3] or "").strip() if len(row) > 3 else ""
                res_code = (row[4] or "").strip() if len(row) > 4 else ""

                if not room_v or not guest_v:
                    skipped += 1
                    continue
                ci = _parse_date_any(ci_s)
                co = _parse_date_any(co_s)
                if ci is None or co is None:
                    raise ValueError(f"Bad dates: checkin='{ci_s}', checkout='{co_s}'")
                if co < ci:
                    raise ValueError("checkout < checkin")
                await upsert_one(room_v, guest_v, ci, co, res_code)
            except Exception as e:
                errors.append({"row": row_idx, "error": str(e)})

    await db.commit()

    return {
        "ok": True,
        "location_id": location_id,
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
        "errors": errors[:200],
        "encoding": encoding,
        "delimiter": delimiter,
        "has_header": bool(looks_like_header),
        "max_rows": max_rows,
    }


@router.get("/locations/{location_id}/stays/export.csv")
async def export_stays_csv(
    location_id: int,
    template: bool = Query(False),
    room: str | None = None,
    q: str | None = None,
    on: date | None = None,
    max_rows: int = Query(50000, ge=1, le=50000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.director, Role.auditor_global, Role.auditor, Role.manager, Role.service_manager)),
):
    allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
    if location_id not in allowed_loc_ids:
        raise HTTPException(status_code=403, detail="No access to this location")

    headers = ["room", "guest_name", "checkin", "checkout", "reservation_code"]
    output = io.StringIO()
    w = csv.writer(output, delimiter=",", quoting=csv.QUOTE_MINIMAL)
    w.writerow(headers)

    if not template:
        where = [Stay.location_id == location_id]
        if room:
            where.append(Stay.room == room.strip())
        if q:
            where.append(func.lower(Stay.guest_name).like(f"%{q.strip().lower()}%"))
        if on:
            where.append(Stay.checkin_at <= on)
            where.append(Stay.checkout_at > on)

        rows = (
            await db.execute(
                select(Stay)
                .where(*where)
                .order_by(Stay.checkin_at.desc(), Stay.room.asc(), Stay.id.desc())
                .limit(max_rows)
            )
        ).scalars().all()

        for s in rows:
            w.writerow(
                [
                    s.room,
                    s.guest_name,
                    s.checkin_at.isoformat(),
                    s.checkout_at.isoformat(),
                    s.reservation_code or "",
                ]
            )

    # Excel-friendly BOM
    data = ("\ufeff" + output.getvalue()).encode("utf-8")
    filename = f"stays_location_{location_id}.csv" if not template else "stays_template.csv"

    return Response(
        content=data,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\""},
    )



# =========================
# Surveys (read-only, Patch 6.1)
# =========================

@router.get("/locations/{location_id}/surveys")
async def list_surveys_for_location(
    location_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    
    _=Depends(require_roles(Role.manager, Role.service_manager, Role.director, Role.auditor_global, Role.auditor)),
):
    # RBAC: non-global -> only allowed locations
    is_global = await user_has_any_role(db, user, GLOBAL_ROLE_VALUES)
    if not is_global:
        allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
        if location_id not in allowed_loc_ids:
            raise HTTPException(status_code=403, detail="No access to this location")

    loc = (await db.execute(select(Location).where(Location.id == location_id))).scalar_one_or_none()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")

    surveys = (
        await db.execute(
            select(Survey)
            .where(Survey.location_id == location_id)
            .order_by(Survey.is_archived.asc(), Survey.id.asc())
        )
    ).scalars().all()

    if not surveys:
        return []

    survey_ids = [s.id for s in surveys]

    # active versions (can be 0/1 per survey; if data corrupted -> pick latest)
    active_versions = (
        await db.execute(
            select(SurveyVersion)
            .where(
                SurveyVersion.survey_id.in_(survey_ids),
                SurveyVersion.is_active == True,  # noqa: E712
            )
        )
    ).scalars().all()

    active_by_survey: dict[int, SurveyVersion] = {}
    for v in active_versions:
        cur = active_by_survey.get(v.survey_id)
        if not cur or (v.version, v.created_at, v.id) > (cur.version, cur.created_at, cur.id):
            active_by_survey[v.survey_id] = v

    # updated_at per survey = max(version.created_at)
    upd_rows = (
        await db.execute(
            select(SurveyVersion.survey_id, func.max(SurveyVersion.created_at))
            .where(SurveyVersion.survey_id.in_(survey_ids))
            .group_by(SurveyVersion.survey_id)
        )
    ).all()
    updated_by = {int(sid): dt for sid, dt in upd_rows}

    # versions_count per survey
    cnt_rows = (
        await db.execute(
            select(SurveyVersion.survey_id, func.count(SurveyVersion.id))
            .where(SurveyVersion.survey_id.in_(survey_ids))
            .group_by(SurveyVersion.survey_id)
        )
    ).all()
    count_by = {int(sid): int(cnt) for sid, cnt in cnt_rows}

    out = []
    for s in surveys:
        av = active_by_survey.get(s.id)
        upd = updated_by.get(s.id)
        out.append(
            {
                "survey_id": s.id,
                "location_id": s.location_id,
                "name": s.name,
                "is_archived": bool(getattr(s, "is_archived", False)),
                "active_version": av.version if av else None,
                "active_version_id": av.id if av else None,
                "versions_count": count_by.get(s.id, 0),
                "updated_at": upd.isoformat() if upd else None,
            }
        )
    return out


@router.get("/surveys/{survey_id}")
async def get_survey_with_versions(
    survey_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.manager, Role.service_manager, Role.director, Role.auditor_global, Role.auditor)),
):
    survey = (await db.execute(select(Survey).where(Survey.id == survey_id))).scalar_one_or_none()
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    # RBAC by location
    is_global = await user_has_any_role(db, user, GLOBAL_ROLE_VALUES)
    if not is_global:
        allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
        if survey.location_id not in allowed_loc_ids:
            raise HTTPException(status_code=403, detail="No access to this survey")

    versions = (
        await db.execute(
            select(SurveyVersion)
            .where(SurveyVersion.survey_id == survey_id)
            .order_by(desc(SurveyVersion.version), desc(SurveyVersion.created_at), desc(SurveyVersion.id))
        )
    ).scalars().all()

    active_version_id = None
    for v in versions:
        if v.is_active:
            active_version_id = v.id
            break

    return {
        "id": survey.id,
        "location_id": survey.location_id,
        "name": survey.name,
        "is_archived": bool(getattr(survey, "is_archived", False)),
        "created_at": survey.created_at.isoformat() if survey.created_at else None,
        "active_version_id": active_version_id,
        "versions": [
            {
                "id": v.id,
                "version": v.version,
                "is_active": bool(v.is_active),
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in versions
        ],
    }


# =========================
# Survey Versions (edit JSON) - Patch 6.2
# =========================

def _validate_schema_minimal(schema: dict):
    if not isinstance(schema, dict):
        raise HTTPException(status_code=422, detail="schema must be an object")

    # мягкая базовая проверка: не ломаем гибкость
    if "title" not in schema:
        raise HTTPException(status_code=422, detail="schema.title is required")

    slides = schema.get("slides")
    if not isinstance(slides, list):
        raise HTTPException(status_code=422, detail="schema.slides must be an array")

    meta = schema.get("meta")
    if meta is not None and not isinstance(meta, dict):
        raise HTTPException(status_code=422, detail="schema.meta must be an object")


@router.get("/survey-versions/{version_id}")
async def get_survey_version(
    version_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.manager, Role.service_manager, Role.director, Role.auditor_global, Role.auditor)),
):
    # Получаем версию + location_id (через survey)
    row = (
        await db.execute(
            select(SurveyVersion, Survey.location_id)
            .join(Survey, Survey.id == SurveyVersion.survey_id)
            .where(SurveyVersion.id == version_id)
        )
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail="SurveyVersion not found")

    sv: SurveyVersion = row[0]
    location_id: int = int(row[1])

    # RBAC: non-global -> allowed_locations
    roles = (await db.execute(select(UserRole).where(UserRole.user_id == user.id))).scalars().all()
    is_global = any(r.role in GLOBAL_ROLE_VALUES for r in roles)
    if not is_global:
        allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
        if location_id not in allowed_loc_ids:
            raise HTTPException(status_code=403, detail="No access to this survey version")

    return {
        "id": sv.id,
        "survey_id": sv.survey_id,
        "location_id": location_id,
        "version": sv.version,
        "is_active": bool(sv.is_active),
        "schema": sv.schema,
        "widget_config": sv.widget_config,
        "created_at": sv.created_at.isoformat() if sv.created_at else None,
    }


@router.patch("/survey-versions/{version_id}")
async def update_survey_version(
    version_id: int,
    payload: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.manager, Role.service_manager, Role.director, Role.auditor_global, Role.auditor)),
):
    # Получаем версию + location_id
    row = (
        await db.execute(
            select(SurveyVersion, Survey.location_id)
            .join(Survey, Survey.id == SurveyVersion.survey_id)
            .where(SurveyVersion.id == version_id)
        )
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail="SurveyVersion not found")

    sv: SurveyVersion = row[0]
    location_id: int = int(row[1])

    # RBAC: non-global -> allowed_locations
    roles = (await db.execute(select(UserRole).where(UserRole.user_id == user.id))).scalars().all()
    is_global = any(r.role in GLOBAL_ROLE_VALUES for r in roles)
    if not is_global:
        allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
        if location_id not in allowed_loc_ids:
            raise HTTPException(status_code=403, detail="No access to this survey version")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="payload must be an object")

    has_any = False

    if "schema" in payload:
        has_any = True
        schema = payload.get("schema")
        if not isinstance(schema, dict):
            raise HTTPException(status_code=422, detail="schema must be an object")
        _validate_schema_minimal(schema)
        sv.schema = schema

    if "widget_config" in payload:
        has_any = True
        wc = payload.get("widget_config")
        if not isinstance(wc, dict):
            raise HTTPException(status_code=422, detail="widget_config must be an object")
        sv.widget_config = wc

    if not has_any:
        raise HTTPException(status_code=422, detail="Nothing to update (schema/widget_config)")

    await db.commit()
    await db.refresh(sv)

    return {"ok": True, "id": sv.id}


# =========================
# Surveys: Versions + Active (PATCH 6.3)
# =========================

@router.post("/surveys/{survey_id}/versions")
async def create_survey_version_copy(
    survey_id: int,
    payload: dict = Body(default_factory=dict),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.manager, Role.service_manager, Role.director, Role.auditor_global)),
):
    """
    Создаёт новую версию как копию:
      - если payload.from_version_id передан -> копируем её
      - иначе копируем активную версию survey (если есть)
      - иначе копируем самую свежую версию survey
    payload:
      { "from_version_id": 123, "make_active": false }
    """
    from_version_id = payload.get("from_version_id")
    make_active = bool(payload.get("make_active", False))

    survey = (await db.execute(select(Survey).where(Survey.id == survey_id))).scalar_one_or_none()
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    if bool(getattr(survey, "is_archived", False)):
        raise HTTPException(status_code=400, detail="Survey is archived")

    allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
    if survey.location_id not in allowed_loc_ids:
        raise HTTPException(status_code=403, detail="No access to this location")

    # source version
    source: SurveyVersion | None = None
    if from_version_id:
        source = (
            await db.execute(
                select(SurveyVersion).where(
                    SurveyVersion.id == int(from_version_id),
                    SurveyVersion.survey_id == survey_id,
                )
            )
        ).scalar_one_or_none()
        if not source:
            raise HTTPException(status_code=404, detail="Source version not found")
    else:
        source = (
            await db.execute(
                select(SurveyVersion)
                .where(SurveyVersion.survey_id == survey_id, SurveyVersion.is_active == True)  # noqa: E712
                .order_by(desc(SurveyVersion.version), desc(SurveyVersion.id))
                .limit(1)
            )
        ).scalar_one_or_none()

        if not source:
            source = (
                await db.execute(
                    select(SurveyVersion)
                    .where(SurveyVersion.survey_id == survey_id)
                    .order_by(desc(SurveyVersion.version), desc(SurveyVersion.id))
                    .limit(1)
                )
            ).scalar_one_or_none()

        if not source:
            raise HTTPException(status_code=400, detail="No versions to copy")

    max_ver = (
        await db.execute(
            select(func.max(SurveyVersion.version)).where(SurveyVersion.survey_id == survey_id)
        )
    ).scalar_one()
    next_version = int(max_ver or 0) + 1

    now = datetime.now(timezone.utc)

    new_ver = SurveyVersion(
        survey_id=survey_id,
        version=next_version,
        is_active=False,
        schema=copy.deepcopy(source.schema),
        widget_config=copy.deepcopy(source.widget_config),
        created_at=now,  # ключевой фикс против NOT NULL / отсутствующего default
    )

    try:
        db.add(new_ver)
        await db.flush()  # получаем new_ver.id

        if make_active:
            # деактивируем ВСЕ версии по всей локации
            survey_ids = (
                await db.execute(select(Survey.id).where(Survey.location_id == survey.location_id))
            ).scalars().all()

            if survey_ids:
                await db.execute(
                    update(SurveyVersion)
                    .where(SurveyVersion.survey_id.in_(list(survey_ids)))
                    .values(is_active=False)
                )

            new_ver.is_active = True
            db.add(new_ver)

        await db.commit()
        await db.refresh(new_ver)

    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Failed to create version (conflict or missing defaults)") from e
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Failed to create version") from e

    return {
        "id": new_ver.id,
        "survey_id": new_ver.survey_id,
        "location_id": survey.location_id,
        "version": new_ver.version,
        "is_active": bool(new_ver.is_active),
    }


@router.post("/survey-versions/{version_id}/set-active")
async def set_active_survey_version(
    version_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.manager, Role.service_manager, Role.director, Role.auditor_global)),
):
    """
    Делает версию активной. ВАЖНО: активная версия должна быть одна на локацию,
    поэтому перед активацией мы выключаем is_active у всех версий всех опросов этой локации.
    """
    row = (
        await db.execute(
            select(SurveyVersion, Survey)
            .join(Survey, Survey.id == SurveyVersion.survey_id)
            .where(SurveyVersion.id == version_id)
            .limit(1)
        )
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail="Survey version not found")

    ver, survey = row

    if bool(getattr(survey, "is_archived", False)):
        raise HTTPException(status_code=400, detail="Survey is archived")


    allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
    if survey.location_id not in allowed_loc_ids:
        raise HTTPException(status_code=403, detail="No access to this location")

    # 1) деактивируем ВСЕ версии по всей локации
    survey_ids = (
        await db.execute(select(Survey.id).where(Survey.location_id == survey.location_id))
    ).scalars().all()

    if survey_ids:
        await db.execute(
            update(SurveyVersion)
            .where(SurveyVersion.survey_id.in_(list(survey_ids)))
            .values(is_active=False)
        )

    # 2) активируем нужную
    ver.is_active = True
    db.add(ver)

    await db.commit()
    return {"ok": True, "version_id": ver.id, "survey_id": survey.id, "location_id": survey.location_id}


# =========================
# Surveys: create + archive (PATCH 6.5)
# =========================

def _default_schema(location_name: str | None = None) -> dict:
    return {
        "meta": {"version": 1},
        "title": location_name or "Оцените ваш опыт",
        "slides": [
            {
                "id": "s1",
                "type": "rating",
                "field": "rating_overall",
                "scale": 10,
                "title": "Как вам у нас?",
                "required": True,
            },
            {
                "id": "s2",
                "type": "text",
                "field": "comment",
                "title": "Что понравилось/что улучшить?",
                "required": False,
                "maxLength": 800,
            },
            {
                "id": "s3",
                "type": "contact",
                "title": "Контакт (если хотите)",
                "fields": [
                    {"type": "text", "field": "name", "required": False},
                    {"type": "email", "field": "email", "required": False},
                ],
            },
        ],
    }


def _default_widget_config() -> dict:
    return {
        "brand": {"radius": 14, "primary": "#6d28d9"},
        "texts": {"submit": "Отправить", "thanks": "Спасибо за отзыв!"},
    }


@router.post("/locations/{location_id}/surveys")
async def create_survey_for_location(
    location_id: int,
    payload: dict = Body(default_factory=dict),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.manager, Role.service_manager, Role.director, Role.auditor_global)),
):
    """
    Создаёт Survey для локации + первую версию v1.

    payload:
      {
        "name": "Опрос ресторана",
        "copy_from_location_active": true,   # default true
        "make_active": false                 # default false
      }
    """
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")

    copy_from_location_active = payload.get("copy_from_location_active", True)
    make_active = bool(payload.get("make_active", False))

    allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
    if location_id not in allowed_loc_ids:
        raise HTTPException(status_code=403, detail="No access to this location")

    loc = (await db.execute(select(Location).where(Location.id == location_id))).scalar_one_or_none()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")

    # Определяем schema/widget_config для первой версии
    schema = None
    widget_config = None

    if copy_from_location_active:
        # берём активную версию по локации (только не из архивных опросов)
        row = (
            await db.execute(
                select(SurveyVersion, Survey)
                .join(Survey, Survey.id == SurveyVersion.survey_id)
                .where(
                    Survey.location_id == location_id,
                    SurveyVersion.is_active == True,  # noqa: E712
                    Survey.is_archived == False,      # noqa: E712
                )
                .order_by(desc(SurveyVersion.created_at), desc(SurveyVersion.id))
                .limit(1)
            )
        ).first()
        if row:
            sv, _s = row
            schema = copy.deepcopy(sv.schema)
            widget_config = copy.deepcopy(sv.widget_config)

    if schema is None:
        schema = _default_schema(loc.name)
    if widget_config is None:
        widget_config = _default_widget_config()

    now = datetime.now(timezone.utc)

    new_survey = Survey(
        location_id=location_id,
        name=name,
        is_archived=False,
        created_at=now,
    )

    try:
        db.add(new_survey)
        await db.flush()  # получить new_survey.id

        v1 = SurveyVersion(
            survey_id=new_survey.id,
            version=1,
            is_active=False,
            schema=schema,
            widget_config=widget_config,
            created_at=now,
        )
        db.add(v1)
        await db.flush()

        if make_active:
            # деактивируем ВСЕ версии по всей локации
            survey_ids = (
                await db.execute(select(Survey.id).where(Survey.location_id == location_id))
            ).scalars().all()

            if survey_ids:
                await db.execute(
                    update(SurveyVersion)
                    .where(SurveyVersion.survey_id.in_(list(survey_ids)))
                    .values(is_active=False)
                )

            v1.is_active = True
            db.add(v1)

        await db.commit()
        await db.refresh(new_survey)
        await db.refresh(v1)

    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Failed to create survey") from e

    return {
        "survey_id": new_survey.id,
        "location_id": location_id,
        "name": new_survey.name,
        "is_archived": bool(new_survey.is_archived),
        "version_id": v1.id,
        "version": v1.version,
        "is_active": bool(v1.is_active),
    }


@router.patch("/surveys/{survey_id}")
async def update_survey(
    survey_id: int,
    payload: dict = Body(default_factory=dict),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.manager, Role.service_manager, Role.director, Role.auditor_global)),
):
    """
    payload:
      { "name": "New name", "is_archived": true/false }
    """
    survey = (await db.execute(select(Survey).where(Survey.id == survey_id))).scalar_one_or_none()
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
    if survey.location_id not in allowed_loc_ids:
        raise HTTPException(status_code=403, detail="No access to this location")

    changed = False

    if "name" in payload:
        name = (payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=422, detail="name cannot be empty")
        survey.name = name
        changed = True

    if "is_archived" in payload:
        is_archived = bool(payload.get("is_archived"))
        survey.is_archived = is_archived
        changed = True

        if is_archived:
            # при архивировании выключаем активность у версий этого survey,
            # чтобы public/resolve гарантированно его не выбирал
            await db.execute(
                update(SurveyVersion)
                .where(SurveyVersion.survey_id == survey.id)
                .values(is_active=False)
            )

    if not changed:
        raise HTTPException(status_code=422, detail="Nothing to update")

    await db.commit()
    return {"ok": True, "id": survey.id, "is_archived": bool(survey.is_archived), "name": survey.name}


# =========================
# Users assignments (director only) — Patch 7.2
# =========================

@router.post("/users/{user_id}/service-manager/{location_id}")
async def assign_service_manager_to_location(
    user_id: int,
    location_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_roles(Role.director)),
):
    """
    Назначить пользователю роль service_manager на конкретную локацию.
    Director-only.

    Идемпотентно:
      - если роль уже есть -> ok + status=already_assigned
    Дополнительно:
      - гарантируем доступ к организации через user_organizations (иначе у scoped юзера /admin/organizations будет пустой)
    """
    target = (await db.execute(select(User).where(User.id == int(user_id)))).scalar_one_or_none()
    if not target or not target.is_active:
        raise HTTPException(status_code=404, detail="User not found")

    loc = (
        await db.execute(
            select(Location)
            .join(Organization, Organization.id == Location.organization_id)
            .where(
                Location.id == int(location_id),
                Location.is_active == True,      # noqa: E712
                Organization.is_active == True,  # noqa: E712
            )
        )
    ).scalar_one_or_none()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")

    # 1) ensure org access link (user_organizations)
    link = (
        await db.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == target.id,
                UserOrganization.organization_id == loc.organization_id,
            )
        )
    ).scalar_one_or_none()

    if link:
        if not link.is_active:
            link.is_active = True
            db.add(link)
    else:
        db.add(
            UserOrganization(
                user_id=target.id,
                organization_id=loc.organization_id,
                is_active=True,
            )
        )

    # 2) ensure role row (user_roles)
    exists = (
        await db.execute(
            select(UserRole).where(
                UserRole.user_id == target.id,
                UserRole.role == Role.service_manager.value,
                UserRole.location_id == loc.id,
            )
        )
    ).scalar_one_or_none()

    if exists:
        await db.commit()
        return {
            "ok": True,
            "status": "already_assigned",
            "user_id": target.id,
            "location_id": loc.id,
        }

    db.add(
        UserRole(
            user_id=target.id,
            organization_id=loc.organization_id,
            location_id=loc.id,
            role=Role.service_manager.value,
        )
    )

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # на всякий случай считаем идемпотентным (например, гонка)
        return {
            "ok": True,
            "status": "already_assigned",
            "user_id": target.id,
            "location_id": loc.id,
        }

    return {
        "ok": True,
        "status": "assigned",
        "user_id": target.id,
        "location_id": loc.id,
    }


@router.delete("/users/{user_id}/service-manager/{location_id}")
async def remove_service_manager_from_location(
    user_id: int,
    location_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_roles(Role.director)),
):
    """
    Снять у пользователя роль service_manager с конкретной локации.
    Director-only.

    Идемпотентно:
      - если роли нет -> ok + status=not_assigned
    """
    target = (await db.execute(select(User).where(User.id == int(user_id)))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    role_row = (
        await db.execute(
            select(UserRole).where(
                UserRole.user_id == target.id,
                UserRole.role == Role.service_manager.value,
                UserRole.location_id == int(location_id),
            )
        )
    ).scalar_one_or_none()

    if not role_row:
        return {"ok": True, "status": "not_assigned", "user_id": target.id, "location_id": int(location_id)}

    await db.delete(role_row)
    await db.commit()
    return {"ok": True, "status": "removed", "user_id": target.id, "location_id": int(location_id)}
