from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast, Integer, desc, case

from app.api.v1.deps import get_db, get_current_user, get_allowed_location_ids
from app.services.rbac import require_roles
from app.models.role import Role
from app.models.submission import Submission
from app.models.location import Location

router = APIRouter()


@router.get("/locations/{location_id}/summary")
async def location_summary(
    location_id: int,
    days: int = Query(30, ge=1, le=365),
    comments_limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    _user=Depends(
        require_roles(
            Role.director,
            Role.auditor_global,
            Role.auditor,
            Role.manager,
            Role.service_manager,
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

    # 4) Общие метрики (за всё время) — без FILTER, через CASE
    totals_q = select(
        func.count(Submission.id).label("total"),
        func.avg(rating_expr).label("avg_rating"),
        func.coalesce(func.sum(case((rating_expr <= 6, 1), else_=0)), 0).label("negative_count"),
        func.coalesce(func.sum(case((rating_expr.isnot(None), 1), else_=0)), 0).label("rated_count"),
    ).where(*base_where)

    totals = (await db.execute(totals_q)).one()
    total = int(totals.total or 0)
    rated_count = int(totals.rated_count or 0)
    negative_count = int(totals.negative_count or 0)
    avg_rating = float(totals.avg_rating) if totals.avg_rating is not None else None
    negative_share = (negative_count / rated_count) if rated_count > 0 else None

    # 5) Распределение оценок 1..10
    dist_rows = (
        await db.execute(
            select(
                rating_expr.label("rating"),
                func.count(Submission.id).label("count"),
            )
            .where(*base_where, rating_expr.isnot(None))
            .group_by(rating_expr)
            .order_by(rating_expr)
        )
    ).all()

    dist_map = {int(r.rating): int(r.count) for r in dist_rows if r.rating is not None}
    rating_distribution = [{"rating": i, "count": int(dist_map.get(i, 0))} for i in range(1, 11)]

    # 6) Timeseries по дням за последние N дней
    since_dt = datetime.now(timezone.utc) - timedelta(days=days)
    day_expr = func.date_trunc("day", Submission.created_at)

    ts_rows = (
        await db.execute(
            select(
                day_expr.label("day"),
                func.count(Submission.id).label("count"),
                func.avg(rating_expr).label("avg_rating"),
            )
            .where(*base_where, Submission.created_at >= since_dt)
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

    # 7) Последние комментарии (не пустые)
    comment_rows = (
        await db.execute(
            select(Submission)
            .where(*base_where, func.length(func.trim(comment_expr)) > 0)
            .order_by(desc(Submission.created_at), desc(Submission.id))
            .limit(comments_limit)
        )
    ).scalars().all()

    last_comments = []
    for s in comment_rows:
        a = s.answers or {}
        last_comments.append(
            {
                "id": s.id,
                "created_at": s.created_at.isoformat(),
                "rating_overall": a.get("rating_overall"),
                "comment": (a.get("comment") or "").strip(),
                "name": a.get("name") or "",
                "email": a.get("email") or "",
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
