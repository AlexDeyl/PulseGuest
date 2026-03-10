from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_db, get_current_user, get_allowed_location_ids, get_allowed_organization_ids
from app.models.role import Role
from app.models.user import User
from app.services.rbac import require_roles
from app.services.audit_scoring import (
    calculate_run_score,
    resolve_answer_score,
    resolve_question_scoring,
)
from app.services.audit_scoring import calculate_run_score


from app.models.audit_checklist import (  # type: ignore
    ChecklistRun,
    ChecklistTemplate,
    ChecklistQuestion,
    ChecklistAnswer,
    ChecklistAttachment,
)


try:
    from app.models.location import Location  # type: ignore
except Exception:  # pragma: no cover
    Location = None  # type: ignore

try:
    from app.models.organization import Organization  # type: ignore
except Exception:  # pragma: no cover
    Organization = None  # type: ignore

router = APIRouter(tags=["audit"])


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _dt_iso(dt: Any) -> str | None:
    if not dt:
        return None
    try:
        return dt.isoformat()
    except Exception:
        return str(dt)


def _value_filled(v: Any) -> bool:
    """
    Похоже на логику фронта:
    - строка непустая
    - число есть
    - dict: есть хотя бы один "непустой" элемент
    """
    if v is None:
        return False

    if isinstance(v, str):
        return v.strip() != ""

    if isinstance(v, (int, float, bool)):
        # bool тоже валиден
        return True

    if isinstance(v, list):
        return any(_value_filled(x) for x in v)

    if isinstance(v, dict):
        if not v:
            return False
        # специальная обработка "choice/text/score" если есть
        if "choice" in v and isinstance(v.get("choice"), str) and v.get("choice", "").strip():
            return True
        if "text" in v and isinstance(v.get("text"), str) and v.get("text", "").strip():
            return True
        if "score" in v and isinstance(v.get("score"), (int, float)):
            return True
        # иначе — любой непустой элемент
        return any(_value_filled(x) for x in v.values())

    # fallback
    return True


def _answer_filled(a: ChecklistAnswer) -> bool:
    # comment
    c = getattr(a, "comment", None)
    if isinstance(c, str) and c.strip():
        return True

    # value_text
    vt = getattr(a, "value_text", None)
    if isinstance(vt, str) and vt.strip():
        return True

    # value_json
    vj = getattr(a, "value_json", None)
    if _value_filled(vj):
        return True

    # value (на всякий случай)
    v = getattr(a, "value", None)
    if _value_filled(v):
        return True

    # score
    sc = getattr(a, "score", None)
    if isinstance(sc, (int, float)):
        return True

    return False


async def _ensure_run_access(db: AsyncSession, user: User, run_id: int) -> ChecklistRun:
    run = (await db.execute(select(ChecklistRun).where(ChecklistRun.id == int(run_id)))).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    allowed_orgs = set(int(x) for x in (await get_allowed_organization_ids(db=db, user=user)))
    if int(run.organization_id) not in allowed_orgs:
        raise HTTPException(status_code=403, detail="No access to this organization")

    # если run привязан к location — проверяем allowed_location_ids
    if getattr(run, "location_id", None):
        allowed_locs = set(int(x) for x in (await get_allowed_location_ids(db=db, user=user)))
        if int(run.location_id) not in allowed_locs:
            raise HTTPException(status_code=403, detail="No access to this location")

    # аудиторы видят только свои заполнения (историю)
    if getattr(run, "auditor_user_id", None) and int(run.auditor_user_id) != int(user.id):
        raise HTTPException(status_code=403, detail="Not your run")

    return run


async def _calc_progress(db: AsyncSession, run: ChecklistRun) -> tuple[int, int]:
    """
    Возвращаем (answered_count, total_questions) НЕ по количеству строк answers,
    а по факту заполненности (value/comment).
    Это важно для кнопки "Отправить" и честной валидации.
    """
    qids = (
        await db.execute(
            select(ChecklistQuestion.id).where(ChecklistQuestion.template_id == int(run.template_id))
        )
    ).scalars().all()
    total = int(len(qids))

    if total == 0:
        return 0, 0

    ans_rows = (
        await db.execute(select(ChecklistAnswer).where(ChecklistAnswer.run_id == int(run.id)))
    ).scalars().all()
    ans_by_qid = {int(a.question_id): a for a in ans_rows}

    answered = 0
    for qid in qids:
        a = ans_by_qid.get(int(qid))
        if a is not None and _answer_filled(a):
            answered += 1

    return int(answered), int(total)


def _parse_dt_param(raw: str | None) -> datetime | None:
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid datetime format, use ISO 8601")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _run_ref_dt(run: ChecklistRun) -> datetime | None:
    return getattr(run, "completed_at", None) or getattr(run, "started_at", None) or getattr(run, "updated_at", None)


def _score_percent_value(score_obj: dict[str, Any] | None) -> float | None:
    if not score_obj:
        return None
    raw = score_obj.get("score_percent")
    if raw is None:
        return None
    try:
        return float(raw)
    except Exception:
        return None


def _avg(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def _trend_period_key(dt: datetime, bucket: str) -> str:
    if bucket == "week":
        year, week, _ = dt.isocalendar()
        return f"{year}-W{week:02d}"
    return dt.strftime("%Y-%m-%d")


def _trend_period_label(dt: datetime, bucket: str) -> str:
    if bucket == "week":
        year, week, _ = dt.isocalendar()
        return f"Нед. {week}, {year}"
    return dt.strftime("%d.%m")


def _choose_trend_bucket(dt_from: datetime | None, dt_to: datetime | None, completed_rows_count: int) -> str:
    if dt_from and dt_to:
        if (dt_to - dt_from).days > 31:
            return "week"
        return "day"
    if completed_rows_count > 60:
        return "week"
    return "day"


@router.get("/runs")
async def list_my_runs(
    organization_id: int | None = Query(default=None),
    status: str | None = Query(default=None, description="draft|completed"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.auditor, Role.auditor_global)),
):
    allowed_orgs = set(int(x) for x in (await get_allowed_organization_ids(db=db, user=user)))
    if not allowed_orgs:
        return []

    # базовый селект
    cols: list[Any] = [ChecklistRun, ChecklistTemplate.name]

    # опционально добавим location/org имена, чтобы история выглядела по-человечески
    if Location is not None:
        cols.append(Location.name.label("location_name"))
    if Organization is not None:
        cols.append(Organization.name.label("organization_name"))

    q = (
        select(*cols)
        .join(ChecklistTemplate, ChecklistTemplate.id == ChecklistRun.template_id)
        .where(ChecklistRun.auditor_user_id == int(user.id))
    )

    if Location is not None:
        q = q.outerjoin(Location, Location.id == ChecklistRun.location_id)
    if Organization is not None:
        q = q.outerjoin(Organization, Organization.id == ChecklistRun.organization_id)

    if organization_id is not None:
        if int(organization_id) not in allowed_orgs:
            raise HTTPException(status_code=403, detail="No access to this organization")
        q = q.where(ChecklistRun.organization_id == int(organization_id))
    else:
        q = q.where(ChecklistRun.organization_id.in_(list(allowed_orgs)))

    if status:
        st = str(status).strip().lower()
        if st not in {"draft", "completed"}:
            raise HTTPException(status_code=400, detail="Invalid status")
        q = q.where(ChecklistRun.status == st)

    # FIX: у ChecklistRun нет created_at → сортируем по updated_at
    q = q.order_by(ChecklistRun.completed_at.desc().nullslast(), ChecklistRun.updated_at.desc())

    rows = (await db.execute(q)).all()

    out: list[dict[str, Any]] = []
    for row in rows:
        # row может быть:
        # (run, template_name)
        # (run, template_name, location_name)
        # (run, template_name, location_name, organization_name)
        run = row[0]
        template_name = row[1]
        location_name = row[2] if len(row) >= 3 else None
        organization_name = row[3] if len(row) >= 4 else None

        answered, total = await _calc_progress(db=db, run=run)
        created_dt = getattr(run, "created_at", None) or getattr(run, "updated_at", None)

        run_score = None
        if str(run.status) == "completed":
            qs = (
                await db.execute(
                    select(ChecklistQuestion)
                    .where(ChecklistQuestion.template_id == int(run.template_id))
                    .order_by(ChecklistQuestion.order.asc(), ChecklistQuestion.id.asc())
                )
            ).scalars().all()
            ans_rows = (
                await db.execute(
                    select(ChecklistAnswer).where(ChecklistAnswer.run_id == int(run.id))
                )
            ).scalars().all()
            run_score = calculate_run_score(questions=qs, answers=ans_rows)

        out.append(
            {
                "id": int(run.id),
                "organization_id": int(run.organization_id),
                "organization_name": str(organization_name) if organization_name else None,
                "location_id": int(run.location_id) if getattr(run, "location_id", None) else None,
                "location_name": str(location_name) if location_name else None,
                "template_id": int(run.template_id),
                "template_name": str(template_name),
                "status": str(run.status),
                # FIX: всегда отдаём created_at (fallback на updated_at), чтобы фронт мог показывать дату
                "created_at": _dt_iso(created_dt),
                "completed_at": _dt_iso(getattr(run, "completed_at", None)),
                "answered_count": answered,
                "total_questions": total,
                **({"score": run_score} if run_score is not None else {}),
            }
        )

    return out


@router.get("/dashboard/summary")
async def get_dashboard_summary(
    date_from: str | None = Query(default=None, description="ISO 8601 datetime"),
    date_to: str | None = Query(default=None, description="ISO 8601 datetime"),
    organization_id: int | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.auditor, Role.auditor_global, Role.director)),
):
    """
    Safe analytics endpoint for auditor dashboard.

    Notes / assumptions:
    - scope is restricted by allowed_org_ids + allowed_location_ids
    - runs without location_id are allowed by organization scope
    - period filter uses completed_at for completed runs, otherwise started_at
    - "problem_completed_runs" => score_percent < 70
    """
    allowed_orgs = set(int(x) for x in (await get_allowed_organization_ids(db=db, user=user)))
    if not allowed_orgs:
        return {
            "period": {"date_from": date_from, "date_to": date_to},
            "total_runs": 0,
            "completed_runs": 0,
            "draft_runs": 0,
            "avg_score_percent": None,
            "avg_score_sum": None,
            "avg_score_max": None,
            "problem_completed_runs": 0,
            "by_organization": [],
            "by_group": [],
            "best_locations": [],
            "worst_locations": [],
            "worst_questions": [],
            "recent_completed": [],
        }

    if organization_id is not None and int(organization_id) not in allowed_orgs:
        raise HTTPException(status_code=403, detail="No access to this organization")

    dt_from = _parse_dt_param(date_from)
    dt_to = _parse_dt_param(date_to)

    allowed_locs = set(int(x) for x in (await get_allowed_location_ids(db=db, user=user)))

    cols: list[Any] = [
        ChecklistRun,
        ChecklistTemplate.name.label("template_name"),
        ChecklistTemplate.location_type.label("template_location_type"),
    ]

    if Location is not None:
        cols.append(Location.name.label("location_name"))
        cols.append(Location.type.label("location_type"))
    if Organization is not None:
        cols.append(Organization.name.label("organization_name"))

    q = (
        select(*cols)
        .join(ChecklistTemplate, ChecklistTemplate.id == ChecklistRun.template_id)
    )

    if Location is not None:
        q = q.outerjoin(Location, Location.id == ChecklistRun.location_id)
    if Organization is not None:
        q = q.outerjoin(Organization, Organization.id == ChecklistRun.organization_id)

    if organization_id is not None:
        q = q.where(ChecklistRun.organization_id == int(organization_id))
    else:
        q = q.where(ChecklistRun.organization_id.in_(list(allowed_orgs)))

    rows = (await db.execute(q.order_by(ChecklistRun.completed_at.desc().nullslast(), ChecklistRun.updated_at.desc()))).all()

    filtered_rows: list[Any] = []
    for row in rows:
        run = row[0]

        if getattr(run, "location_id", None) is not None:
            if int(run.location_id) not in allowed_locs:
                continue

        ref_dt = _run_ref_dt(run)
        if dt_from and (ref_dt is None or ref_dt < dt_from):
            continue
        if dt_to and (ref_dt is None or ref_dt > dt_to):
            continue

        filtered_rows.append(row)

    if not filtered_rows:
        return {
            "period": {"date_from": date_from, "date_to": date_to},
            "total_runs": 0,
            "completed_runs": 0,
            "draft_runs": 0,
            "avg_score_percent": None,
            "avg_score_sum": None,
            "avg_score_max": None,
            "problem_completed_runs": 0,
            "by_organization": [],
            "by_group": [],
            "best_locations": [],
            "worst_locations": [],
            "worst_questions": [],
            "recent_completed": [],
        }

    completed_run_ids = [int(row[0].id) for row in filtered_rows if str(row[0].status) == "completed"]
    template_ids = sorted({int(row[0].template_id) for row in filtered_rows})

    questions_rows = (
        await db.execute(
            select(ChecklistQuestion)
            .where(ChecklistQuestion.template_id.in_(template_ids))
            .order_by(ChecklistQuestion.template_id.asc(), ChecklistQuestion.order.asc(), ChecklistQuestion.id.asc())
        )
    ).scalars().all()

    questions_by_template: dict[int, list[ChecklistQuestion]] = {}
    for qrow in questions_rows:
        questions_by_template.setdefault(int(qrow.template_id), []).append(qrow)

    answers_by_run: dict[int, list[ChecklistAnswer]] = {}
    if completed_run_ids:
        answer_rows = (
            await db.execute(
                select(ChecklistAnswer).where(ChecklistAnswer.run_id.in_(completed_run_ids))
            )
        ).scalars().all()
        for a in answer_rows:
            answers_by_run.setdefault(int(a.run_id), []).append(a)

    run_scores: dict[int, dict[str, Any]] = {}
    for row in filtered_rows:
        run = row[0]
        if str(run.status) != "completed":
            continue
        qs = questions_by_template.get(int(run.template_id), [])
        ans = answers_by_run.get(int(run.id), [])
        run_scores[int(run.id)] = calculate_run_score(questions=qs, answers=ans)

    total_runs = len(filtered_rows)
    completed_rows = [row for row in filtered_rows if str(row[0].status) == "completed"]
    draft_rows = [row for row in filtered_rows if str(row[0].status) != "completed"]

    avg_score_percent = _avg(
        [
            float(s["score_percent"])
            for s in run_scores.values()
            if s.get("score_percent") is not None
        ]
    )
    avg_score_sum = _avg([float(s["score_sum"]) for s in run_scores.values()])
    avg_score_max = _avg([float(s["score_max"]) for s in run_scores.values()])

    problem_completed_runs = sum(
        1
        for s in run_scores.values()
        if s.get("score_percent") is not None and float(s["score_percent"]) < 70.0
    )

    by_org_acc: dict[int, dict[str, Any]] = {}
    by_group_acc: dict[str, dict[str, Any]] = {}
    by_loc_acc: dict[int, dict[str, Any]] = {}
    worst_q_acc: dict[int, dict[str, Any]] = {}

    for row in completed_rows:
        run = row[0]
        m = row._mapping
        score_obj = run_scores.get(int(run.id))
        score_percent = _score_percent_value(score_obj)

        org_id = int(run.organization_id)
        org_name = m.get("organization_name") or f"Организация #{org_id}"

        org_item = by_org_acc.setdefault(
            org_id,
            {
                "organization_id": org_id,
                "organization_name": str(org_name),
                "completed_runs": 0,
                "score_percent_values": [],
                "score_sum_values": [],
                "score_max_values": [],
            },
        )
        org_item["completed_runs"] += 1
        if score_percent is not None:
            org_item["score_percent_values"].append(score_percent)
        if score_obj is not None:
            org_item["score_sum_values"].append(float(score_obj["score_sum"]))
            org_item["score_max_values"].append(float(score_obj["score_max"]))

        group_key = str(
            m.get("template_location_type")
            or m.get("location_type")
            or "organization"
        )
        grp_item = by_group_acc.setdefault(
            group_key,
            {
                "group_key": group_key,
                "completed_runs": 0,
                "score_percent_values": [],
                "score_sum_values": [],
                "score_max_values": [],
            },
        )
        grp_item["completed_runs"] += 1
        if score_percent is not None:
            grp_item["score_percent_values"].append(score_percent)
        if score_obj is not None:
            grp_item["score_sum_values"].append(float(score_obj["score_sum"]))
            grp_item["score_max_values"].append(float(score_obj["score_max"]))

        if getattr(run, "location_id", None):
            loc_id = int(run.location_id)
            loc_name = m.get("location_name") or f"Локация #{loc_id}"
            loc_item = by_loc_acc.setdefault(
                loc_id,
                {
                    "location_id": loc_id,
                    "location_name": str(loc_name),
                    "organization_id": org_id,
                    "organization_name": str(org_name),
                    "completed_runs": 0,
                    "score_percent_values": [],
                },
            )
            loc_item["completed_runs"] += 1
            if score_percent is not None:
                loc_item["score_percent_values"].append(score_percent)

        qs = questions_by_template.get(int(run.template_id), [])
        ans_rows = answers_by_run.get(int(run.id), [])
        ans_by_qid = {int(a.question_id): a for a in ans_rows}

        for qrow in qs:
            scoring = resolve_question_scoring(qrow)
            if scoring is None:
                continue

            actual_score = resolve_answer_score(qrow, ans_by_qid.get(int(qrow.id)))
            if actual_score is None:
                continue

            max_score = float(scoring.get("max_score") or 0.0)

            item = worst_q_acc.setdefault(
                int(qrow.id),
                {
                    "question_id": int(qrow.id),
                    "template_id": int(qrow.template_id),
                    "template_name": str(m.get("template_name") or ""),
                    "section": str(getattr(qrow, "section", "") or ""),
                    "text": str(getattr(qrow, "text", "") or ""),
                    "answers_count": 0,
                    "zero_count": 0,
                    "low_count": 0,
                    "score_values": [],
                },
            )
            item["answers_count"] += 1
            item["score_values"].append(float(actual_score))
            if float(actual_score) <= 0:
                item["zero_count"] += 1
            if max_score > 0 and float(actual_score) < max_score:
                item["low_count"] += 1

    by_organization = []
    for item in by_org_acc.values():
        by_organization.append(
            {
                "organization_id": item["organization_id"],
                "organization_name": item["organization_name"],
                "completed_runs": item["completed_runs"],
                "avg_score_percent": _avg(item["score_percent_values"]),
                "avg_score_sum": _avg(item["score_sum_values"]),
                "avg_score_max": _avg(item["score_max_values"]),
            }
        )
    by_organization.sort(key=lambda x: ((x["avg_score_percent"] is None), -(x["avg_score_percent"] or 0), -x["completed_runs"]))

    by_group = []
    for item in by_group_acc.values():
        by_group.append(
            {
                "group_key": item["group_key"],
                "completed_runs": item["completed_runs"],
                "avg_score_percent": _avg(item["score_percent_values"]),
                "avg_score_sum": _avg(item["score_sum_values"]),
                "avg_score_max": _avg(item["score_max_values"]),
            }
        )
    by_group.sort(key=lambda x: ((x["avg_score_percent"] is None), -(x["avg_score_percent"] or 0), -x["completed_runs"]))

    all_locations = []
    for item in by_loc_acc.values():
        all_locations.append(
            {
                "location_id": item["location_id"],
                "location_name": item["location_name"],
                "organization_id": item["organization_id"],
                "organization_name": item["organization_name"],
                "completed_runs": item["completed_runs"],
                "avg_score_percent": _avg(item["score_percent_values"]),
            }
        )

    scored_locations = [x for x in all_locations if x["avg_score_percent"] is not None]
    best_locations = sorted(
        scored_locations,
        key=lambda x: (-(x["avg_score_percent"] or 0), -x["completed_runs"], x["location_name"])
    )[:5]
    worst_locations = sorted(
        scored_locations,
        key=lambda x: ((x["avg_score_percent"] or 0), -x["completed_runs"], x["location_name"])
    )[:5]

    worst_questions = []
    for item in worst_q_acc.values():
        answers_count = int(item["answers_count"])
        low_rate = round((item["low_count"] / answers_count) * 100.0, 2) if answers_count > 0 else None
        worst_questions.append(
            {
                "question_id": item["question_id"],
                "template_id": item["template_id"],
                "template_name": item["template_name"],
                "section": item["section"],
                "text": item["text"],
                "answers_count": answers_count,
                "zero_count": int(item["zero_count"]),
                "low_count": int(item["low_count"]),
                "low_rate": low_rate,
                "avg_score": _avg(item["score_values"]),
            }
        )

    worst_questions.sort(
        key=lambda x: (
            -(x["zero_count"]),
            -((x["low_rate"] or 0)),
            -(x["answers_count"]),
            x["text"],
        )
    )
    worst_questions = worst_questions[:10]

    recent_completed = []
    for row in sorted(
        completed_rows,
        key=lambda r: (
            r[0].completed_at or r[0].updated_at or r[0].started_at
        ),
        reverse=True,
    )[:10]:
        run = row[0]
        m = row._mapping
        recent_completed.append(
            {
                "id": int(run.id),
                "organization_id": int(run.organization_id),
                "organization_name": str(m.get("organization_name") or f"Организация #{int(run.organization_id)}"),
                "location_id": int(run.location_id) if getattr(run, "location_id", None) else None,
                "location_name": str(m.get("location_name")) if m.get("location_name") else None,
                "template_id": int(run.template_id),
                "template_name": str(m.get("template_name") or ""),
                "completed_at": _dt_iso(getattr(run, "completed_at", None)),
                "score": run_scores.get(int(run.id)),
            }
        )

    trend_bucket = _choose_trend_bucket(dt_from, dt_to, len(completed_rows))
    trends_acc: dict[str, dict[str, Any]] = {}

    for row in completed_rows:
        run = row[0]
        score_obj = run_scores.get(int(run.id))
        score_percent = _score_percent_value(score_obj)
        ref_dt = getattr(run, "completed_at", None) or getattr(run, "updated_at", None) or getattr(run, "started_at", None)
        if ref_dt is None:
            continue

        period_key = _trend_period_key(ref_dt, trend_bucket)
        item = trends_acc.setdefault(
            period_key,
            {
                "period_key": period_key,
                "label": _trend_period_label(ref_dt, trend_bucket),
                "bucket": trend_bucket,
                "completed_runs": 0,
                "problem_completed_runs": 0,
                "score_percent_values": [],
                "_sort_dt": ref_dt,
            },
        )
        item["completed_runs"] += 1
        if score_percent is not None:
            item["score_percent_values"].append(float(score_percent))
            if float(score_percent) < 70.0:
                item["problem_completed_runs"] += 1

    trends = []
    for item in sorted(trends_acc.values(), key=lambda x: x["_sort_dt"]):
        trends.append(
            {
                "period_key": item["period_key"],
                "label": item["label"],
                "bucket": item["bucket"],
                "completed_runs": int(item["completed_runs"]),
                "problem_completed_runs": int(item["problem_completed_runs"]),
                "avg_score_percent": _avg(item["score_percent_values"]),
            }
        )

    return {
        "period": {"date_from": date_from, "date_to": date_to},
        "total_runs": int(total_runs),
        "completed_runs": int(len(completed_rows)),
        "draft_runs": int(len(draft_rows)),
        "avg_score_percent": avg_score_percent,
        "avg_score_sum": avg_score_sum,
        "avg_score_max": avg_score_max,
        "problem_completed_runs": int(problem_completed_runs),
        "by_organization": by_organization,
        "by_group": by_group,
        "best_locations": best_locations,
        "worst_locations": worst_locations,
        "worst_questions": worst_questions,
        "recent_completed": recent_completed,
        "trends": trends,
    }


@router.post("/runs/{run_id}/complete")
async def complete_run(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.auditor, Role.auditor_global)),
):
    run = await _ensure_run_access(db=db, user=user, run_id=int(run_id))

    if str(run.status) == "completed":
        return {"ok": True, "status": "completed"}

    answered, total = await _calc_progress(db=db, run=run)
    missing = max(0, int(total) - int(answered))
    if missing > 0:
        raise HTTPException(
            status_code=400,
            detail={"message": "Not all answers filled", "missing": missing, "answered": answered, "total": total},
        )

    run.status = "completed"
    run.completed_at = _now_utc()

    # на всякий случай "touch" updated_at, если у тебя нет автотрекинга
    if hasattr(run, "updated_at"):
        run.updated_at = _now_utc()  # type: ignore

    await db.commit()

    return {"ok": True, "status": "completed", "completed_at": run.completed_at.isoformat()}


@router.get("/runs/{run_id}/pdf")
async def run_pdf(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.auditor, Role.auditor_global)),
):
    """
    Минимально удобный PDF-отчёт (таблица):
    # | Раздел | Вопрос | Ответ | Комментарий | Фото (кол-во)
    """
    run = await _ensure_run_access(db=db, user=user, run_id=int(run_id))
    if str(run.status) != "completed":
        raise HTTPException(status_code=400, detail="Run is not completed")

    # тянем шаблон
    tmpl = (await db.execute(select(ChecklistTemplate).where(ChecklistTemplate.id == int(run.template_id)))).scalar_one()

    # метаданные (организация/локация если есть)
    org_name = None
    if Organization is not None:
        org_name = (
            await db.execute(select(Organization.name).where(Organization.id == int(run.organization_id)))
        ).scalar_one_or_none()

    loc_name = None
    if Location is not None and getattr(run, "location_id", None):
        loc_name = (
            await db.execute(select(Location.name).where(Location.id == int(run.location_id)))
        ).scalar_one_or_none()

    # вопросы
    qs = (
        await db.execute(
            select(ChecklistQuestion)
            .where(ChecklistQuestion.template_id == int(run.template_id))
            .order_by(ChecklistQuestion.order.asc(), ChecklistQuestion.id.asc())
        )
    ).scalars().all()

    # ответы мапой
    ans_rows = (
        await db.execute(select(ChecklistAnswer).where(ChecklistAnswer.run_id == int(run.id)))
    ).scalars().all()
    ans_by_q = {int(a.question_id): a for a in ans_rows}

    # вложения count по question_id
    att_counts_rows = (
        await db.execute(
            select(ChecklistAttachment.question_id, func.count(ChecklistAttachment.id))
            .where(ChecklistAttachment.run_id == int(run.id))
            .group_by(ChecklistAttachment.question_id)
        )
    ).all()
    att_count = {int(qid): int(cnt) for qid, cnt in att_counts_rows}

    # --- PDF ---
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
    )
    styles = getSampleStyleSheet()

    title = f"{getattr(tmpl, 'name', 'Checklist')} — отчет"
    meta_lines = [
        "Статус: completed",
        f"Организация: {org_name or ''}",
        f"Локация: {loc_name or ''}",
        f"Дата: {run.completed_at.strftime('%d.%m.%Y %H:%M') if getattr(run, 'completed_at', None) else ''}",
        f"Run ID: {run.id}",
    ]

    story = [
        Paragraph(title, styles["Title"]),
        Spacer(1, 6),
        Paragraph("<br/>".join(meta_lines), styles["Normal"]),
        Spacer(1, 10),
    ]

    data: list[list[Any]] = [["#", "Раздел", "Вопрос", "Ответ", "Комментарий", "Фото"]]
    i = 1
    for q in qs:
        a = ans_by_q.get(int(q.id))

        answer_text = ""
        if a is not None:
            if hasattr(a, "value_text") and getattr(a, "value_text"):
                answer_text = str(getattr(a, "value_text"))
            elif hasattr(a, "value_json") and getattr(a, "value_json") is not None:
                answer_text = str(getattr(a, "value_json"))
            elif hasattr(a, "value") and getattr(a, "value") is not None:
                answer_text = str(getattr(a, "value"))
            elif hasattr(a, "score") and getattr(a, "score") is not None:
                answer_text = str(getattr(a, "score"))

        comment = ""
        if a is not None and hasattr(a, "comment") and getattr(a, "comment"):
            comment = str(getattr(a, "comment"))

        photos = att_count.get(int(q.id), 0)
        data.append(
            [
                str(i),
                str(getattr(q, "section", "") or ""),
                str(getattr(q, "text", "") or ""),
                answer_text,
                comment,
                str(photos) if photos else "",
            ]
        )
        i += 1

    tbl = Table(data, colWidths=[10 * mm, 25 * mm, 70 * mm, 25 * mm, 50 * mm, 12 * mm])
    tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
            ]
        )
    )

    story.append(tbl)
    doc.build(story)

    pdf_bytes = buf.getvalue()
    filename = f"audit_run_{run.id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/runs/{run_id}")
async def get_run_detail(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.auditor, Role.auditor_global)),
):
    run = await _ensure_run_access(db=db, user=user, run_id=int(run_id))

    template = (
        await db.execute(
            select(ChecklistTemplate).where(ChecklistTemplate.id == run.template_id)
        )
    ).scalar_one()

    questions = (
        await db.execute(
            select(ChecklistQuestion)
            .where(ChecklistQuestion.template_id == run.template_id)
            .order_by(ChecklistQuestion.order.asc())
        )
    ).scalars().all()

    answers = (
        await db.execute(
            select(ChecklistAnswer).where(ChecklistAnswer.run_id == run.id)
        )
    ).scalars().all()

    answers_by_q = {a.question_id: a for a in answers}

    attachments = (
        await db.execute(
            select(ChecklistAttachment).where(ChecklistAttachment.run_id == run.id)
        )
    ).scalars().all()

    att_by_q: dict[int, list] = {}
    for a in attachments:
        att_by_q.setdefault(a.question_id, []).append(a)

    out_questions = []

    for q in questions:
        ans = answers_by_q.get(q.id)

        out_questions.append(
            {
                "id": q.id,
                "text": q.text,
                "section": q.section,
                "order": q.order,
                "answer_type": q.answer_type,
                "is_required": q.is_required,
                "allow_comment": q.allow_comment,
                "allow_photos": q.allow_photos,
                "options": q.options,
                "answer": {
                    "value": getattr(ans, "value_json", None),
                    "comment": getattr(ans, "comment", None),
                }
                if ans
                else None,
                "attachments": [
                    {
                        "id": a.id,
                        "file_name": a.file_name,
                        "content_type": a.content_type,
                    }
                    for a in att_by_q.get(q.id, [])
                ],
            }
        )

    return {
        "id": run.id,
        "status": run.status,
        "completed_at": run.completed_at,
        "template": {
            "id": template.id,
            "name": template.name,
        },
        "questions": out_questions,
    }
