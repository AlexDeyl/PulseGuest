from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast, Integer, desc, case

from app.api.v1.deps import (
    get_db,
    get_current_user,
    get_allowed_location_ids,
    user_has_any_role,
    GLOBAL_ROLE_VALUES,
)
from app.services.rbac import require_roles
from app.models.role import Role
from app.models.submission import Submission
from app.models.location import Location
from app.models.organization import Organization

router = APIRouter()


# Location.type -> человекочитаемое название группы (UI использует эти названия)
GROUP_LABELS_RU: dict[str, str] = {
    "room": "Номера",
    "restaurant": "Рестораны",
    "conference_hall": "Конференц-залы",
    "banquet_hall": "Банкетные залы",
    "other": "Другое",
}


def group_label_ru(group_key: str) -> str:
    return GROUP_LABELS_RU.get(group_key, group_key)


def _comment_text(v) -> str:
    """Stats must never crash on non-string 'comment' values.

    In some surveys, 'comment' may be a list (e.g., multi_select) or another JSON type.
    """
    if v is None:
        return ""

    if isinstance(v, str):
        return v.strip()

    if isinstance(v, list):
        parts: list[str] = []
        for item in v:
            if item is None:
                continue
            if isinstance(item, str):
                t = item.strip()
                if t:
                    parts.append(t)
            else:
                parts.append(str(item))
        return ", ".join(parts).strip()

    return str(v).strip()


@router.get("/organizations/{organization_id}/summary")
async def organization_summary(
    organization_id: int,
    days: int = Query(30, ge=1, le=365),
    comments_limit: int = Query(10, ge=1, le=50),
    locations_limit: int = Query(200, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
    _user=Depends(
        require_roles(
            # new roles
            Role.admin,
            Role.ops_director,
            Role.service_manager,
            Role.auditor,
            # legacy roles (compat)
            Role.director,
            Role.auditor_global,
            Role.manager,
            Role.employee,
        )
    ),
    user=Depends(get_current_user),
):
    """Org-level summary for dashboard.

    RBAC:
      - director/auditor_global/super_admin: can view any org (active)
      - others: can view org only if they have at least one allowed location inside this org
    """

    org = (
        await db.execute(select(Organization).where(Organization.id == organization_id))
    ).scalar_one_or_none()
    if not org or not org.is_active:
        raise HTTPException(status_code=404, detail="Organization not found")

    is_global = await user_has_any_role(db, user, GLOBAL_ROLE_VALUES)

    # Active locations within org (name-sorted)
    loc_q = (
        select(Location.id, Location.name, Location.slug)
        .where(Location.organization_id == organization_id, Location.is_active == True)  # noqa: E712
    )
    loc_rows = (await db.execute(loc_q.order_by(Location.name))).all()
    org_loc_ids = [int(r[0]) for r in loc_rows]

    if not org_loc_ids and not is_global:
        raise HTTPException(status_code=403, detail="No access to this organization")

    if is_global:
        allowed_loc_ids = org_loc_ids
    else:
        allowed = await get_allowed_location_ids(db=db, user=user)
        allowed_set = set(int(x) for x in allowed)
        allowed_loc_ids = [lid for lid in org_loc_ids if lid in allowed_set]

    if not allowed_loc_ids:
        raise HTTPException(status_code=403, detail="No access to this organization")

    # Safe JSONB extract
    rating_text = Submission.answers.op("->>")("rating_overall")
    comment_text = Submission.answers.op("->>")("comment")
    rating_expr = cast(func.nullif(rating_text, ""), Integer)
    comment_expr = func.coalesce(comment_text, "")

    since_dt = datetime.now(timezone.utc) - timedelta(days=days)
    window_where = [
        Submission.location_id.in_(allowed_loc_ids),
        Submission.created_at >= since_dt,
    ]

    # Totals
    totals_q = select(
        func.count(Submission.id).label("total"),
        func.avg(rating_expr).label("avg_rating"),
        func.coalesce(func.sum(case((rating_expr <= 6, 1), else_=0)), 0).label("negative_count"),
        func.coalesce(func.sum(case((rating_expr.isnot(None), 1), else_=0)), 0).label("rated_count"),
    ).where(*window_where)

    totals = (await db.execute(totals_q)).one()
    total = int(totals.total or 0)
    rated_count = int(totals.rated_count or 0)
    negative_count = int(totals.negative_count or 0)
    avg_rating = float(totals.avg_rating) if totals.avg_rating is not None else None
    negative_share = (negative_count / rated_count) if rated_count > 0 else None

    # Distribution 1..10
    dist_rows = (
        await db.execute(
            select(
                rating_expr.label("rating"),
                func.count(Submission.id).label("count"),
            )
            .where(*window_where, rating_expr.isnot(None))
            .group_by(rating_expr)
            .order_by(rating_expr)
        )
    ).all()
    dist_map = {int(r.rating): int(r.count) for r in dist_rows if r.rating is not None}
    rating_distribution = [{"rating": i, "count": int(dist_map.get(i, 0))} for i in range(1, 11)]

    # Timeseries
    day_expr = func.date_trunc("day", Submission.created_at)
    ts_rows = (
        await db.execute(
            select(
                day_expr.label("day"),
                func.count(Submission.id).label("count"),
                func.avg(rating_expr).label("avg_rating"),
            )
            .where(*window_where)
            .group_by(day_expr)
            .order_by(day_expr)
        )
    ).all()

    timeseries = []
    for r in ts_rows:
        day_iso = r.day.date().isoformat() if r.day is not None else None
        timeseries.append(
            {
                "day": day_iso,
                "count": int(r.count or 0),
                "avg_rating": float(r.avg_rating) if r.avg_rating is not None else None,
            }
        )

    # Latest comments with location name
    comment_rows = (
        await db.execute(
            select(Submission, Location.name)
            .join(Location, Location.id == Submission.location_id)
            .where(*window_where, func.length(func.trim(comment_expr)) > 0)
            .order_by(desc(Submission.created_at), desc(Submission.id))
            .limit(comments_limit)
        )
    ).all()

    last_comments = []
    for s, loc_name in comment_rows:
        a = s.answers or {}
        m = s.meta or {}
        last_comments.append(
            {
                "id": s.id,
                "created_at": s.created_at.isoformat(),
                "location_id": s.location_id,
                "location_name": loc_name or "",
                "rating_overall": a.get("rating_overall"),
                "comment": _comment_text(a.get("comment")),
                "name": a.get("name") or "",
                "email": a.get("email") or "",
                "room": m.get("room") or "",
                "guest_name": m.get("guest_name") or "",
                "stay_id": m.get("stay_id"),
            }
        )

    # Per-location overview (all allowed locations, even with zero submissions)
    loc_meta = {int(r[0]): {"name": r[1], "slug": r[2]} for r in loc_rows}

    per_loc_rows = (
        await db.execute(
            select(
                Submission.location_id.label("location_id"),
                func.count(Submission.id).label("total"),
                func.avg(rating_expr).label("avg_rating"),
                func.coalesce(func.sum(case((rating_expr <= 6, 1), else_=0)), 0).label("negative_count"),
                func.coalesce(func.sum(case((rating_expr.isnot(None), 1), else_=0)), 0).label("rated_count"),
                func.max(Submission.created_at).label("last_at"),
            )
            .where(*window_where)
            .group_by(Submission.location_id)
            .order_by(desc(func.count(Submission.id)))
            .limit(locations_limit)
        )
    ).all()

    stats_by_loc: dict[int, dict] = {}
    for r in per_loc_rows:
        lid = int(r.location_id)
        rated = int(r.rated_count or 0)
        neg = int(r.negative_count or 0)
        stats_by_loc[lid] = {
            "total_submissions": int(r.total or 0),
            "avg_rating": float(r.avg_rating) if r.avg_rating is not None else None,
            "negative_share": (neg / rated) if rated > 0 else None,
            "last_submission_at": r.last_at.isoformat() if r.last_at is not None else None,
        }

    locations = []
    for lid in allowed_loc_ids:
        meta = loc_meta.get(int(lid)) or {}
        s = stats_by_loc.get(int(lid)) or {
            "total_submissions": 0,
            "avg_rating": None,
            "negative_share": None,
            "last_submission_at": None,
        }
        locations.append(
            {
                "location_id": int(lid),
                "location_name": meta.get("name") or "",
                "location_slug": meta.get("slug") or "",
                **s,
            }
        )

    return {
        "organization_id": organization_id,
        "organization_name": org.name,
        "total_submissions": total,
        "rated_count": rated_count,
        "avg_rating": avg_rating,
        "negative_count": negative_count,
        "negative_share": negative_share,
        "rating_distribution": rating_distribution,
        "timeseries": timeseries,
        "last_comments": last_comments,
        "locations": locations,
    }


@router.get("/organizations/{organization_id}/groups/{group_key}/summary")
async def organization_group_summary(
    organization_id: int,
    group_key: str,
    days: int = Query(30, ge=1, le=365),
    comments_limit: int = Query(10, ge=1, le=50),
    locations_limit: int = Query(200, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
    _user=Depends(
        require_roles(
            # new roles
            Role.admin,
            Role.ops_director,
            Role.service_manager,
            Role.auditor,
            # legacy roles (compat)
            Role.director,
            Role.auditor_global,
            Role.manager,
            Role.employee,
        )
    ),
    user=Depends(get_current_user),
):
    """Group-level summary inside organization (Location.type is group_key)."""

    org = (
        await db.execute(select(Organization).where(Organization.id == organization_id))
    ).scalar_one_or_none()
    if not org or not org.is_active:
        raise HTTPException(status_code=404, detail="Organization not found")

    is_global = await user_has_any_role(db, user, GLOBAL_ROLE_VALUES)

    # Active locations within org + group
    loc_q = (
        select(Location.id, Location.name, Location.slug)
        .where(
            Location.organization_id == organization_id,
            Location.is_active == True,  # noqa: E712
            Location.type == group_key,
        )
        .order_by(Location.name)
    )
    loc_rows = (await db.execute(loc_q)).all()
    group_loc_ids = [int(r[0]) for r in loc_rows]

    # Если в организации нет активных локаций этого типа — вернём "пустую" статистику
    if not group_loc_ids:
        return {
            "organization_id": organization_id,
            "organization_name": org.name,
            "group_key": group_key,
            "group_name": group_label_ru(group_key),
            "total_submissions": 0,
            "rated_count": 0,
            "avg_rating": None,
            "negative_count": 0,
            "negative_share": None,
            "rating_distribution": [{"rating": i, "count": 0} for i in range(1, 11)],
            "timeseries": [],
            "last_comments": [],
            "locations": [],
        }

    if is_global:
        allowed_loc_ids = group_loc_ids
    else:
        allowed = await get_allowed_location_ids(db=db, user=user)
        allowed_set = set(int(x) for x in allowed)
        allowed_loc_ids = [lid for lid in group_loc_ids if lid in allowed_set]

    if not allowed_loc_ids:
        raise HTTPException(status_code=403, detail="No access to this group")

    # Safe JSONB extract
    rating_text = Submission.answers.op("->>")("rating_overall")
    comment_text = Submission.answers.op("->>")("comment")
    rating_expr = cast(func.nullif(rating_text, ""), Integer)
    comment_expr = func.coalesce(comment_text, "")

    since_dt = datetime.now(timezone.utc) - timedelta(days=days)
    window_where = [
        Submission.location_id.in_(allowed_loc_ids),
        Submission.created_at >= since_dt,
    ]

    # Totals
    totals_q = select(
        func.count(Submission.id).label("total"),
        func.avg(rating_expr).label("avg_rating"),
        func.coalesce(func.sum(case((rating_expr <= 6, 1), else_=0)), 0).label("negative_count"),
        func.coalesce(func.sum(case((rating_expr.isnot(None), 1), else_=0)), 0).label("rated_count"),
    ).where(*window_where)

    totals = (await db.execute(totals_q)).one()
    total = int(totals.total or 0)
    rated_count = int(totals.rated_count or 0)
    negative_count = int(totals.negative_count or 0)
    avg_rating = float(totals.avg_rating) if totals.avg_rating is not None else None
    negative_share = (negative_count / rated_count) if rated_count > 0 else None

    # Distribution 1..10
    dist_rows = (
        await db.execute(
            select(
                rating_expr.label("rating"),
                func.count(Submission.id).label("count"),
            )
            .where(*window_where, rating_expr.isnot(None))
            .group_by(rating_expr)
            .order_by(rating_expr)
        )
    ).all()
    dist_map = {int(r.rating): int(r.count) for r in dist_rows if r.rating is not None}
    rating_distribution = [{"rating": i, "count": int(dist_map.get(i, 0))} for i in range(1, 11)]

    # Timeseries
    day_expr = func.date_trunc("day", Submission.created_at)
    ts_rows = (
        await db.execute(
            select(
                day_expr.label("day"),
                func.count(Submission.id).label("count"),
                func.avg(rating_expr).label("avg_rating"),
            )
            .where(*window_where)
            .group_by(day_expr)
            .order_by(day_expr)
        )
    ).all()

    timeseries = []
    for r in ts_rows:
        day_iso = r.day.date().isoformat() if r.day is not None else None
        timeseries.append(
            {
                "day": day_iso,
                "count": int(r.count or 0),
                "avg_rating": float(r.avg_rating) if r.avg_rating is not None else None,
            }
        )

    # Latest comments with location name
    comment_rows = (
        await db.execute(
            select(Submission, Location.name)
            .join(Location, Location.id == Submission.location_id)
            .where(*window_where, func.length(func.trim(comment_expr)) > 0)
            .order_by(desc(Submission.created_at), desc(Submission.id))
            .limit(comments_limit)
        )
    ).all()

    last_comments = []
    for s, loc_name in comment_rows:
        a = s.answers or {}
        m = s.meta or {}
        last_comments.append(
            {
                "id": s.id,
                "created_at": s.created_at.isoformat(),
                "location_id": s.location_id,
                "location_name": loc_name or "",
                "rating_overall": a.get("rating_overall"),
                "comment": _comment_text(a.get("comment")),
                "name": a.get("name") or "",
                "email": a.get("email") or "",
                "room": m.get("room") or "",
                "guest_name": m.get("guest_name") or "",
                "stay_id": m.get("stay_id"),
            }
        )

    # Per-location overview
    loc_meta = {int(r[0]): {"name": r[1], "slug": r[2]} for r in loc_rows}

    per_loc_rows = (
        await db.execute(
            select(
                Submission.location_id.label("location_id"),
                func.count(Submission.id).label("total"),
                func.avg(rating_expr).label("avg_rating"),
                func.coalesce(func.sum(case((rating_expr <= 6, 1), else_=0)), 0).label("negative_count"),
                func.coalesce(func.sum(case((rating_expr.isnot(None), 1), else_=0)), 0).label("rated_count"),
                func.max(Submission.created_at).label("last_at"),
            )
            .where(*window_where)
            .group_by(Submission.location_id)
            .order_by(desc(func.count(Submission.id)))
            .limit(locations_limit)
        )
    ).all()

    stats_by_loc: dict[int, dict] = {}
    for r in per_loc_rows:
        lid = int(r.location_id)
        rated = int(r.rated_count or 0)
        neg = int(r.negative_count or 0)
        stats_by_loc[lid] = {
            "total_submissions": int(r.total or 0),
            "avg_rating": float(r.avg_rating) if r.avg_rating is not None else None,
            "negative_share": (neg / rated) if rated > 0 else None,
            "last_submission_at": r.last_at.isoformat() if r.last_at is not None else None,
        }

    locations = []
    for lid in allowed_loc_ids:
        meta = loc_meta.get(int(lid)) or {}
        s = stats_by_loc.get(int(lid)) or {
            "total_submissions": 0,
            "avg_rating": None,
            "negative_share": None,
            "last_submission_at": None,
        }
        locations.append(
            {
                "location_id": int(lid),
                "location_name": meta.get("name") or "",
                "location_slug": meta.get("slug") or "",
                **s,
            }
        )

    return {
        "organization_id": organization_id,
        "organization_name": org.name,
        "group_key": group_key,
        "group_name": group_label_ru(group_key),
        "total_submissions": total,
        "rated_count": rated_count,
        "avg_rating": avg_rating,
        "negative_count": negative_count,
        "negative_share": negative_share,
        "rating_distribution": rating_distribution,
        "timeseries": timeseries,
        "last_comments": last_comments,
        "locations": locations,
    }


@router.get("/locations/{location_id}/summary")
async def location_summary(
    location_id: int,
    days: int = Query(30, ge=1, le=365),
    comments_limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    _user=Depends(
        require_roles(
            # new roles
            Role.admin,
            Role.ops_director,
            Role.service_manager,
            Role.auditor,
            # legacy roles (compat)
            Role.director,
            Role.auditor_global,
            Role.manager,
            Role.employee,
        )
    ),
    user=Depends(get_current_user),
):
    # 1) Локация существует/активна
    loc = (await db.execute(select(Location).where(Location.id == location_id))).scalar_one_or_none()
    if not loc or (hasattr(loc, "is_active") and not loc.is_active):
        raise HTTPException(status_code=404, detail="Location not found")

    # 2) RBAC по location
    allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
    if location_id not in allowed_loc_ids:
        raise HTTPException(status_code=403, detail="No access to this location")

    # 3) Безопасное извлечение из JSONB через Postgres operator ->>
    rating_text = Submission.answers.op("->>")("rating_overall")
    comment_text = Submission.answers.op("->>")("comment")

    rating_expr = cast(func.nullif(rating_text, ""), Integer)
    comment_expr = func.coalesce(comment_text, "")

    base_where = [Submission.location_id == location_id]
    since_dt = datetime.now(timezone.utc) - timedelta(days=days)
    window_where = [*base_where, Submission.created_at >= since_dt]

    # 4) Общие метрики (за период) — без FILTER, через CASE
    totals_q = select(
        func.count(Submission.id).label("total"),
        func.avg(rating_expr).label("avg_rating"),
        func.coalesce(func.sum(case((rating_expr <= 6, 1), else_=0)), 0).label("negative_count"),
        func.coalesce(func.sum(case((rating_expr.isnot(None), 1), else_=0)), 0).label("rated_count"),
    ).where(*window_where)

    totals = (await db.execute(totals_q)).one()
    total = int(totals.total or 0)
    rated_count = int(totals.rated_count or 0)
    negative_count = int(totals.negative_count or 0)
    avg_rating = float(totals.avg_rating) if totals.avg_rating is not None else None
    negative_share = (negative_count / rated_count) if rated_count > 0 else None

    # 5) Распределение оценок 1..10 (за период)
    dist_rows = (
        await db.execute(
            select(
                rating_expr.label("rating"),
                func.count(Submission.id).label("count"),
            )
            .where(*window_where, rating_expr.isnot(None))
            .group_by(rating_expr)
            .order_by(rating_expr)
        )
    ).all()

    dist_map = {int(r.rating): int(r.count) for r in dist_rows if r.rating is not None}
    rating_distribution = [{"rating": i, "count": int(dist_map.get(i, 0))} for i in range(1, 11)]

    # 6) Timeseries по дням за последние N дней
    day_expr = func.date_trunc("day", Submission.created_at)

    ts_rows = (
        await db.execute(
            select(
                day_expr.label("day"),
                func.count(Submission.id).label("count"),
                func.avg(rating_expr).label("avg_rating"),
            )
            .where(*window_where)
            .group_by(day_expr)
            .order_by(day_expr)
        )
    ).all()

    timeseries = []
    for r in ts_rows:
        day_iso = r.day.date().isoformat() if r.day is not None else None
        timeseries.append(
            {
                "day": day_iso,
                "count": int(r.count or 0),
                "avg_rating": float(r.avg_rating) if r.avg_rating is not None else None,
            }
        )

    # 7) Последние комментарии (за период, не пустые)
    comment_rows = (
        await db.execute(
            select(Submission)
            .where(*window_where, func.length(func.trim(comment_expr)) > 0)
            .order_by(desc(Submission.created_at), desc(Submission.id))
            .limit(comments_limit)
        )
    ).scalars().all()

    last_comments = []
    for s in comment_rows:
        a = s.answers or {}
        m = s.meta or {}
        last_comments.append(
            {
                "id": s.id,
                "created_at": s.created_at.isoformat(),
                "rating_overall": a.get("rating_overall"),
                "comment": _comment_text(a.get("comment")),
                "name": a.get("name") or "",
                "email": a.get("email") or "",
                # Patch 8.4: гостевые поля (если есть)
                "room": m.get("room") or "",
                "guest_name": m.get("guest_name") or "",
                "stay_id": m.get("stay_id"),
            }
        )

    return {
        "location_id": location_id,
        "total_submissions": total,
        "rated_count": rated_count,
        "avg_rating": avg_rating,
        "negative_count": negative_count,
        "negative_share": negative_share,
        "rating_distribution": rating_distribution,
        "timeseries": timeseries,
        "last_comments": last_comments,
    }
