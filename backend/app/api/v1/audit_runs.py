from __future__ import annotations
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any
import ast
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

from app.api.v1.deps import (
    get_allowed_location_ids,
    get_allowed_organization_ids,
    get_current_user,
    get_db,
)
from app.models.audit_checklist import (  # type: ignore
    ChecklistAnswer,
    ChecklistAttachment,
    ChecklistQuestion,
    ChecklistRun,
    ChecklistTemplate,
)
from app.schemas.audit import ChecklistRunCreateIn, ChecklistRunMetaUpdateIn
from app.models.role import Role
from app.models.user import User
from app.services.audit_scoring import (
    calculate_run_score,
    resolve_answer_score,
    resolve_question_scoring,
)
from app.services.rbac import require_roles

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


def _run_status_label(status: Any) -> str:
    s = str(status or "").strip().lower()
    if s == "completed":
        return "Завершен"
    if s == "draft":
        return "Черновик"
    return str(status or "—")


def _register_pdf_font() -> str:
    """
    Возвращает имя шрифта для PDF.
    Пытаемся зарегистрировать кириллический TTF.
    Если не получилось — fallback на Helvetica.
    """
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/app/fonts/DejaVuSans.ttf",
    ]
    for p in candidates:
        try:
            path = Path(p)
            if path.exists():
                pdfmetrics.registerFont(TTFont("PGDejaVuSans", str(path)))
                return "PGDejaVuSans"
        except Exception:
            pass
    return "Helvetica"


def _normalize_answer_parts(answer: ChecklistAnswer | None) -> tuple[str, str]:
    """
    Возвращает (human_answer, score_text)
    Без техмусора вида {'score': 1, 'choice': 'yes'}.
    """
    if answer is None:
        return "", ""

    value_json = getattr(answer, "value_json", None)
    value = getattr(answer, "value", None)
    value_text = getattr(answer, "value_text", None)
    score = getattr(answer, "score", None)

    human_answer = ""
    score_text = ""

    def _as_score_text(v: Any) -> str:
        if v is None:
            return ""
        try:
            fv = float(v)
            if fv.is_integer():
                return str(int(fv))
            return str(round(fv, 2))
        except Exception:
            return str(v)

    if isinstance(value_json, dict):
        choice = str(value_json.get("choice") or "").strip().lower()
        text = str(value_json.get("text") or "").strip()
        score_from_json = value_json.get("score")

        if choice == "yes":
            human_answer = "Да"
        elif choice == "no":
            human_answer = "Нет"
        elif choice:
            human_answer = choice

        if text:
            human_answer = f"{human_answer} ({text})" if human_answer else text

        if score is None and score_from_json is not None:
            score_text = _as_score_text(score_from_json)

    elif isinstance(value_json, list):
        vals = [str(x).strip() for x in value_json if str(x).strip()]
        human_answer = ", ".join(vals)

    elif isinstance(value_json, (str, int, float, bool)):
        if isinstance(value_json, bool):
            human_answer = "Да" if value_json else "Нет"
        else:
            human_answer = str(value_json).strip()

    if not human_answer:
        if isinstance(value_text, str) and value_text.strip():
            human_answer = value_text.strip()
        elif isinstance(value, bool):
            human_answer = "Да" if value else "Нет"
        elif value not in (None, ""):
            human_answer = str(value).strip()

    if not score_text and score is not None:
        score_text = _as_score_text(score)

    if human_answer in ("yes", "Yes", "YES"):
        human_answer = "Да"
    elif human_answer in ("no", "No", "NO"):
        human_answer = "Нет"

    return human_answer, score_text


def _attachments_mark(answer_attachments: list[ChecklistAttachment] | None) -> str:
    return "Есть" if answer_attachments else "Нет"


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
        return True

    if isinstance(v, list):
        return any(_value_filled(x) for x in v)

    if isinstance(v, dict):
        if not v:
            return False
        if "choice" in v and isinstance(v.get("choice"), str) and v.get("choice", "").strip():
            return True
        if "text" in v and isinstance(v.get("text"), str) and v.get("text", "").strip():
            return True
        if "score" in v and isinstance(v.get("score"), (int, float)):
            return True
        return any(_value_filled(x) for x in v.values())

    return True


def _answer_filled(a: ChecklistAnswer) -> bool:
    c = getattr(a, "comment", None)
    if isinstance(c, str) and c.strip():
        return True

    vt = getattr(a, "value_text", None)
    if isinstance(vt, str) and vt.strip():
        return True

    vj = getattr(a, "value_json", None)
    if _value_filled(vj):
        return True

    v = getattr(a, "value", None)
    if _value_filled(v):
        return True

    sc = getattr(a, "score", None)
    if isinstance(sc, (int, float)):
        return True

    return False


async def _ensure_run_access(db: AsyncSession, user: User, run_id: int) -> ChecklistRun:
    run = (
        await db.execute(select(ChecklistRun).where(ChecklistRun.id == int(run_id)))
    ).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    allowed_orgs = set(int(x) for x in (await get_allowed_organization_ids(db=db, user=user)))
    if int(run.organization_id) not in allowed_orgs:
        raise HTTPException(status_code=403, detail="No access to this organization")

    if getattr(run, "location_id", None):
        allowed_locs = set(int(x) for x in (await get_allowed_location_ids(db=db, user=user)))
        if int(run.location_id) not in allowed_locs:
            raise HTTPException(status_code=403, detail="No access to this location")

    user_role = str(getattr(user, "role", "") or "")
    is_own_only_role = user_role == Role.auditor.value

    if user_role == Role.ops_director.value and str(getattr(run, "status", "") or "") != "completed":
        raise HTTPException(status_code=403, detail="Draft runs are not available")

    if is_own_only_role and getattr(run, "auditor_user_id", None) and int(run.auditor_user_id) != int(user.id):
        raise HTTPException(status_code=403, detail="Not your run")

    return run


async def _calc_progress(db: AsyncSession, run: ChecklistRun) -> tuple[int, int]:
    """
    Возвращаем (answered_count, total_questions) НЕ по количеству строк answers,
    а по факту заполненности (value/comment).
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
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid datetime format, use ISO 8601") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _run_ref_dt(run: ChecklistRun) -> datetime | None:
    return (
        getattr(run, "completed_at", None)
        or getattr(run, "started_at", None)
        or getattr(run, "updated_at", None)
    )


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


def _choose_trend_bucket(
    dt_from: datetime | None, dt_to: datetime | None, completed_rows_count: int
) -> str:
    if dt_from and dt_to:
        if (dt_to - dt_from).days > 31:
            return "week"
        return "day"
    if completed_rows_count > 60:
        return "week"
    return "day"


@router.post("/runs")
async def create_run(
    payload: ChecklistRunCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.auditor, Role.auditor_global, Role.admin, Role.super_admin)),
):
    allowed_orgs = set(int(x) for x in (await get_allowed_organization_ids(db=db, user=user)))
    if int(payload.organization_id) not in allowed_orgs:
        raise HTTPException(status_code=403, detail="No access to this organization")

    if payload.location_id is not None:
        allowed_locs = set(int(x) for x in (await get_allowed_location_ids(db=db, user=user)))
        if allowed_locs and int(payload.location_id) not in allowed_locs:
            raise HTTPException(status_code=403, detail="No access to this location")

    template = (
        await db.execute(select(ChecklistTemplate).where(ChecklistTemplate.id == int(payload.template_id)))
    ).scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Checklist template not found")

    run = ChecklistRun(
        template_id=int(payload.template_id),
        organization_id=int(payload.organization_id),
        location_id=int(payload.location_id) if payload.location_id is not None else None,
        location_text=(str(getattr(payload, "location_text", "") or "").strip() or None),
        auditor_user_id=int(user.id),
        status="draft",
    )

    if hasattr(run, "updated_at"):
        run.updated_at = _now_utc()  # type: ignore

    db.add(run)
    await db.commit()
    await db.refresh(run)

    answered_count, total_questions = await _calc_progress(db=db, run=run)

    return {
        "id": int(run.id),
        "template_id": int(run.template_id),
        "organization_id": int(run.organization_id),
        "location_id": int(run.location_id) if getattr(run, "location_id", None) else None,
        "location_text": (str(getattr(run, "location_text", "") or "").strip() or None),
        "auditor_user_id": int(run.auditor_user_id),
        "status": str(run.status),
        "started_at": _dt_iso(getattr(run, "started_at", None)),
        "updated_at": _dt_iso(getattr(run, "updated_at", None)),
        "completed_at": _dt_iso(getattr(run, "completed_at", None)),
        "answered_count": int(answered_count),
        "total_questions": int(total_questions),
    }


@router.get("/runs")
async def list_my_runs(
    organization_id: int | None = Query(default=None),
    status: str | None = Query(default=None, description="draft|completed"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(
        require_roles(
            Role.auditor,
            Role.auditor_global,
            Role.ops_director,
            Role.director,
            Role.admin,
            Role.super_admin,
        )
    ),
):
    allowed_orgs = set(int(x) for x in (await get_allowed_organization_ids(db=db, user=user)))
    if not allowed_orgs:
        return []

    cols: list[Any] = [ChecklistRun, ChecklistTemplate.name]

    has_location = Location is not None
    has_organization = Organization is not None

    if has_location:
        cols.append(Location.name.label("location_name"))
    if has_organization:
        cols.append(Organization.name.label("organization_name"))

    q = select(*cols).join(ChecklistTemplate, ChecklistTemplate.id == ChecklistRun.template_id)

    if str(getattr(user, "role", "") or "") == Role.auditor.value:
        q = q.where(ChecklistRun.auditor_user_id == int(user.id))

    if has_location:
        q = q.outerjoin(Location, Location.id == ChecklistRun.location_id)
    if has_organization:
        q = q.outerjoin(Organization, Organization.id == ChecklistRun.organization_id)

    if organization_id is not None:
        if int(organization_id) not in allowed_orgs:
            raise HTTPException(status_code=403, detail="No access to this organization")
        q = q.where(ChecklistRun.organization_id == int(organization_id))
    else:
        q = q.where(ChecklistRun.organization_id.in_(list(allowed_orgs)))

    user_role = str(getattr(user, "role", "") or "")

    if status:
        st = str(status).strip().lower()
        if st not in {"draft", "completed"}:
            raise HTTPException(status_code=400, detail="Invalid status")
        q = q.where(ChecklistRun.status == st)

    # ops_director в истории видит только completed
    if user_role == Role.ops_director.value:
        q = q.where(ChecklistRun.status == "completed")

    q = q.order_by(ChecklistRun.completed_at.desc().nullslast(), ChecklistRun.updated_at.desc())

    rows = (await db.execute(q)).all()

    out: list[dict[str, Any]] = []
    for row in rows:
        run = row[0]
        template_name = row[1]

        idx = 2
        location_name = row[idx] if has_location else None
        if has_location:
            idx += 1
        organization_name = row[idx] if has_organization else None

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
                "location_text": (str(getattr(run, "location_text", "") or "").strip() or None),
                "template_id": int(run.template_id),
                "template_name": str(template_name),
                "status": str(run.status),
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
    _=Depends(
        require_roles(
            Role.auditor,
            Role.auditor_global,
            Role.ops_director,
            Role.director,
            Role.admin,
            Role.super_admin,
        )
    ),
):
    dt_from = _parse_dt_param(date_from)
    dt_to = _parse_dt_param(date_to)

    allowed_orgs = set(int(x) for x in (await get_allowed_organization_ids(db=db, user=user)))
    allowed_locs = set(int(x) for x in (await get_allowed_location_ids(db=db, user=user)))

    if organization_id is not None:
        if int(organization_id) not in allowed_orgs:
            raise HTTPException(status_code=403, detail="No access to this organization")
        allowed_orgs = {int(organization_id)}

    empty_response = {
        "period": {
            "date_from": _dt_iso(dt_from),
            "date_to": _dt_iso(dt_to),
        },
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
        "trends": [],
    }

    if not allowed_orgs:
        return empty_response

    q = select(ChecklistRun).where(ChecklistRun.organization_id.in_(list(allowed_orgs)))
    rows = (await db.execute(q)).scalars().all()

    visible_runs: list[ChecklistRun] = []
    for run in rows:
        loc_id = getattr(run, "location_id", None)
        if loc_id is not None and allowed_locs and int(loc_id) not in allowed_locs:
            continue

        ref_dt = _run_ref_dt(run)
        if dt_from and ref_dt and ref_dt < dt_from:
            continue
        if dt_to and ref_dt and ref_dt > dt_to:
            continue

        user_role = str(getattr(user, "role", "") or "")

        if user_role == Role.auditor.value:
            if int(getattr(run, "auditor_user_id", 0) or 0) != int(user.id):
                continue

        if user_role == Role.ops_director.value and str(getattr(run, "status", "") or "") != "completed":
            continue

        visible_runs.append(run)

    if not visible_runs:
        return empty_response

    run_ids = [int(r.id) for r in visible_runs]
    template_ids = sorted({int(r.template_id) for r in visible_runs})
    org_ids = sorted({int(r.organization_id) for r in visible_runs})
    loc_ids = sorted({int(r.location_id) for r in visible_runs if getattr(r, "location_id", None)})

    templates = (
        await db.execute(select(ChecklistTemplate).where(ChecklistTemplate.id.in_(template_ids)))
    ).scalars().all()
    tpl_by_id = {int(t.id): t for t in templates}

    questions = (
        await db.execute(
            select(ChecklistQuestion)
            .where(ChecklistQuestion.template_id.in_(template_ids))
            .order_by(ChecklistQuestion.order.asc(), ChecklistQuestion.id.asc())
        )
    ).scalars().all()
    qs_by_template: dict[int, list[ChecklistQuestion]] = {}
    for qrow in questions:
        tid = int(qrow.template_id)
        qs_by_template.setdefault(tid, []).append(qrow)

    answers = (
        await db.execute(select(ChecklistAnswer).where(ChecklistAnswer.run_id.in_(run_ids)))
    ).scalars().all()
    answers_by_run: dict[int, list[ChecklistAnswer]] = {}
    for ans in answers:
        answers_by_run.setdefault(int(ans.run_id), []).append(ans)

    org_by_id: dict[int, Any] = {}
    if Organization is not None and org_ids:
        org_rows = (
            await db.execute(select(Organization).where(Organization.id.in_(org_ids)))
        ).scalars().all()
        org_by_id = {int(o.id): o for o in org_rows}

    loc_by_id: dict[int, Any] = {}
    if Location is not None and loc_ids:
        loc_rows = (
            await db.execute(select(Location).where(Location.id.in_(loc_ids)))
        ).scalars().all()
        loc_by_id = {int(l.id): l for l in loc_rows}

    total_runs = len(visible_runs)
    completed_rows = [r for r in visible_runs if str(r.status) == "completed"]
    draft_rows = [r for r in visible_runs if str(r.status) != "completed"]

    completed_items: list[dict[str, Any]] = []

    by_org_acc: dict[int, dict[str, Any]] = {}
    by_group_acc: dict[str, dict[str, Any]] = {}
    by_loc_acc: dict[int, dict[str, Any]] = {}
    worst_q_acc: dict[int, dict[str, Any]] = {}

    all_score_percents: list[float] = []
    all_score_sums: list[float] = []
    all_score_maxes: list[float] = []

    for run in completed_rows:
        tid = int(run.template_id)
        rid = int(run.id)
        questions_for_run = qs_by_template.get(tid, [])
        answers_for_run = answers_by_run.get(rid, [])
        score = calculate_run_score(questions=questions_for_run, answers=answers_for_run)

        score_percent = _score_percent_value(score)
        score_sum = score.get("score_sum")
        score_max = score.get("score_max")

        if score_percent is not None:
            all_score_percents.append(float(score_percent))
        if isinstance(score_sum, (int, float)):
            all_score_sums.append(float(score_sum))
        if isinstance(score_max, (int, float)):
            all_score_maxes.append(float(score_max))

        org_id = int(run.organization_id)
        org_obj = org_by_id.get(org_id)
        org_name = str(getattr(org_obj, "name", "") or f"Организация #{org_id}")

        org_acc = by_org_acc.setdefault(
            org_id,
            {
                "organization_id": org_id,
                "organization_name": org_name,
                "completed_runs": 0,
                "_score_percents": [],
                "_score_sums": [],
                "_score_maxes": [],
            },
        )
        org_acc["completed_runs"] += 1
        if score_percent is not None:
            org_acc["_score_percents"].append(float(score_percent))
        if isinstance(score_sum, (int, float)):
            org_acc["_score_sums"].append(float(score_sum))
        if isinstance(score_max, (int, float)):
            org_acc["_score_maxes"].append(float(score_max))

        loc_id = getattr(run, "location_id", None)
        loc_obj = loc_by_id.get(int(loc_id)) if loc_id else None
        loc_name = str(getattr(loc_obj, "name", "") or (f"Локация #{loc_id}" if loc_id else "Без локации"))
        group_key = str(getattr(loc_obj, "type", "") or "other")

        grp_acc = by_group_acc.setdefault(
            group_key,
            {
                "group_key": group_key,
                "completed_runs": 0,
                "_score_percents": [],
                "_score_sums": [],
                "_score_maxes": [],
            },
        )
        grp_acc["completed_runs"] += 1
        if score_percent is not None:
            grp_acc["_score_percents"].append(float(score_percent))
        if isinstance(score_sum, (int, float)):
            grp_acc["_score_sums"].append(float(score_sum))
        if isinstance(score_max, (int, float)):
            grp_acc["_score_maxes"].append(float(score_max))

        if loc_id is not None:
            loc_key = int(loc_id)
            loc_acc = by_loc_acc.setdefault(
                loc_key,
                {
                    "location_id": int(loc_id),
                    "location_name": loc_name,
                    "organization_id": org_id,
                    "organization_name": org_name,
                    "completed_runs": 0,
                    "_score_percents": [],
                },
            )
            loc_acc["completed_runs"] += 1
            if score_percent is not None:
                loc_acc["_score_percents"].append(float(score_percent))

        ans_map = {int(a.question_id): a for a in answers_for_run}
        for qrow in questions_for_run:
            qscore_meta = resolve_question_scoring(qrow)
            if not qscore_meta.get("scoreable"):
                continue

            ans = ans_map.get(int(qrow.id))
            if ans is None:
                continue

            resolved = resolve_answer_score(qrow, getattr(ans, "value", None))
            if resolved.get("excluded"):
                continue

            value = resolved.get("score")
            if value is None:
                continue

            qacc = worst_q_acc.setdefault(
                int(qrow.id),
                {
                    "question_id": int(qrow.id),
                    "template_id": int(qrow.template_id),
                    "template_name": str(
                        getattr(tpl_by_id.get(int(qrow.template_id)), "name", "")
                        or f"Template #{int(qrow.template_id)}"
                    ),
                    "section": str(getattr(qrow, "section", "") or ""),
                    "text": str(getattr(qrow, "text", "") or ""),
                    "answers_count": 0,
                    "zero_count": 0,
                    "low_count": 0,
                    "_scores": [],
                },
            )

            qacc["answers_count"] += 1
            try:
                f_value = float(value)
            except Exception:
                continue

            qacc["_scores"].append(f_value)
            if f_value <= 0:
                qacc["zero_count"] += 1
            if f_value < 1:
                qacc["low_count"] += 1

        completed_items.append(
            {
                "id": rid,
                "organization_id": org_id,
                "organization_name": org_name,
                "location_id": int(loc_id) if loc_id is not None else None,
                "location_name": loc_name if loc_id is not None else None,
                "template_id": tid,
                "template_name": str(getattr(tpl_by_id.get(tid), "name", "") or f"Template #{tid}"),
                "completed_at": _dt_iso(getattr(run, "completed_at", None)),
                "score": score,
                "_score_percent": score_percent,
                "_ref_dt": _run_ref_dt(run),
            }
        )

    avg_score_percent = _avg(all_score_percents)
    avg_score_sum = _avg(all_score_sums)
    avg_score_max = _avg(all_score_maxes)

    problem_completed_runs = 0
    for item in completed_items:
        sp = item.get("_score_percent")
        if sp is not None and float(sp) < 80.0:
            problem_completed_runs += 1

    by_organization = []
    for _, acc in by_org_acc.items():
        by_organization.append(
            {
                "organization_id": acc["organization_id"],
                "organization_name": acc["organization_name"],
                "completed_runs": acc["completed_runs"],
                "avg_score_percent": _avg(acc["_score_percents"]),
                "avg_score_sum": _avg(acc["_score_sums"]),
                "avg_score_max": _avg(acc["_score_maxes"]),
            }
        )
    by_organization.sort(
        key=lambda x: (
            -(x["completed_runs"] or 0),
            -1 if x["avg_score_percent"] is None else -(x["avg_score_percent"] or 0),
        )
    )

    by_group = []
    for _, acc in by_group_acc.items():
        by_group.append(
            {
                "group_key": acc["group_key"],
                "completed_runs": acc["completed_runs"],
                "avg_score_percent": _avg(acc["_score_percents"]),
                "avg_score_sum": _avg(acc["_score_sums"]),
                "avg_score_max": _avg(acc["_score_maxes"]),
            }
        )
    by_group.sort(
        key=lambda x: (
            -(x["completed_runs"] or 0),
            -1 if x["avg_score_percent"] is None else -(x["avg_score_percent"] or 0),
        )
    )

    locations_ranked = []
    for _, acc in by_loc_acc.items():
        locations_ranked.append(
            {
                "location_id": acc["location_id"],
                "location_name": acc["location_name"],
                "organization_id": acc["organization_id"],
                "organization_name": acc["organization_name"],
                "completed_runs": acc["completed_runs"],
                "avg_score_percent": _avg(acc["_score_percents"]),
            }
        )

    best_locations = sorted(
        [x for x in locations_ranked if x["avg_score_percent"] is not None],
        key=lambda x: (-(x["avg_score_percent"] or 0), -(x["completed_runs"] or 0)),
    )[:5]

    worst_locations = sorted(
        [x for x in locations_ranked if x["avg_score_percent"] is not None],
        key=lambda x: ((x["avg_score_percent"] or 0), -(x["completed_runs"] or 0)),
    )[:5]

    worst_questions = []
    for _, acc in worst_q_acc.items():
        scores = acc["_scores"]
        answers_count = int(acc["answers_count"])
        low_count = int(acc["low_count"])
        worst_questions.append(
            {
                "question_id": acc["question_id"],
                "template_id": acc["template_id"],
                "template_name": acc["template_name"],
                "section": acc["section"],
                "text": acc["text"],
                "answers_count": answers_count,
                "zero_count": int(acc["zero_count"]),
                "low_count": low_count,
                "low_rate": round((low_count / answers_count) * 100, 2) if answers_count > 0 else None,
                "avg_score": _avg(scores),
            }
        )

    worst_questions.sort(
        key=lambda x: (
            -1 if x["low_rate"] is None else -(x["low_rate"] or 0),
            -1 if x["answers_count"] is None else -(x["answers_count"] or 0),
        )
    )
    worst_questions = worst_questions[:10]

    recent_completed = sorted(
        completed_items,
        key=lambda x: x["_ref_dt"] or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )[:10]
    recent_completed = [
        {
            "id": item["id"],
            "organization_id": item["organization_id"],
            "organization_name": item["organization_name"],
            "location_id": item["location_id"],
            "location_name": item["location_name"],
            "template_id": item["template_id"],
            "template_name": item["template_name"],
            "completed_at": item["completed_at"],
            "score": item["score"],
        }
        for item in recent_completed
    ]

    bucket = _choose_trend_bucket(dt_from, dt_to, len(completed_items))
    trend_acc: dict[str, dict[str, Any]] = {}

    for item in completed_items:
        ref_dt = item.get("_ref_dt")
        if not ref_dt:
            continue

        period_key = _trend_period_key(ref_dt, bucket)
        entry = trend_acc.setdefault(
            period_key,
            {
                "period_key": period_key,
                "label": _trend_period_label(ref_dt, bucket),
                "bucket": bucket,
                "completed_runs": 0,
                "problem_completed_runs": 0,
                "_score_percents": [],
                "_sort_dt": ref_dt,
            },
        )

        entry["completed_runs"] += 1
        sp = item.get("_score_percent")
        if sp is not None:
            entry["_score_percents"].append(float(sp))
            if float(sp) < 80.0:
                entry["problem_completed_runs"] += 1

    trends = []
    for _, acc in sorted(trend_acc.items(), key=lambda kv: kv[1]["_sort_dt"]):
        trends.append(
            {
                "period_key": acc["period_key"],
                "label": acc["label"],
                "bucket": acc["bucket"],
                "completed_runs": acc["completed_runs"],
                "problem_completed_runs": acc["problem_completed_runs"],
                "avg_score_percent": _avg(acc["_score_percents"]),
            }
        )

    return {
        "period": {
            "date_from": _dt_iso(dt_from),
            "date_to": _dt_iso(dt_to),
        },
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


@router.patch("/runs/{run_id}")
async def update_run_meta(
    run_id: int,
    payload: ChecklistRunMetaUpdateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.auditor, Role.auditor_global, Role.admin, Role.super_admin)),
):
    run = await _ensure_run_access(db=db, user=user, run_id=int(run_id))

    if str(run.status) == "completed":
        raise HTTPException(status_code=400, detail="Run is completed (read-only)")

    run.location_text = (str(getattr(payload, "location_text", "") or "").strip() or None)

    if hasattr(run, "updated_at"):
        run.updated_at = _now_utc()  # type: ignore

    await db.commit()
    await db.refresh(run)

    return {
        "id": int(run.id),
        "template_id": int(run.template_id),
        "organization_id": int(run.organization_id),
        "location_id": int(run.location_id) if getattr(run, "location_id", None) else None,
        "location_text": (str(getattr(run, "location_text", "") or "").strip() or None),
        "auditor_user_id": int(run.auditor_user_id),
        "status": str(run.status),
        "started_at": _dt_iso(getattr(run, "started_at", None)),
        "updated_at": _dt_iso(getattr(run, "updated_at", None)),
        "completed_at": _dt_iso(getattr(run, "completed_at", None)),
    }


@router.post("/runs/{run_id}/complete")
async def complete_run(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.auditor, Role.auditor_global, Role.admin, Role.super_admin)),
):
    run = await _ensure_run_access(db=db, user=user, run_id=int(run_id))

    if str(run.status) == "completed":
        return {"ok": True, "status": "completed"}

    answered, total = await _calc_progress(db=db, run=run)
    missing = max(0, int(total) - int(answered))
    if missing > 0:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Not all answers filled",
                "missing": missing,
                "answered": answered,
                "total": total,
            },
        )

    run.status = "completed"
    run.completed_at = _now_utc()

    if hasattr(run, "updated_at"):
        run.updated_at = _now_utc()  # type: ignore

    await db.commit()

    return {"ok": True, "status": "completed", "completed_at": run.completed_at.isoformat()}


@router.get("/runs/{run_id}/pdf")
async def run_pdf(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(
        require_roles(
            Role.auditor,
            Role.auditor_global,
            Role.ops_director,
            Role.director,
            Role.admin,
            Role.super_admin,
        )
    ),
):
    """
    PDF-отчёт completed run:
    # | Раздел | Вопрос | Ответ | Балл | Комментарий | Фото
    """

    logger = logging.getLogger(__name__)

    def _register_pdf_font() -> str:
        candidates = [
            ("PGDejaVuSans", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            ("PGDejaVuSans", "/usr/share/fonts/dejavu/DejaVuSans.ttf"),
            ("PGLiberationSans", "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
            ("PGFreeSans", "/usr/share/fonts/truetype/freefont/FreeSans.ttf"),
            ("PGDejaVuSans", "/app/fonts/DejaVuSans.ttf"),
        ]

        already_registered = set(pdfmetrics.getRegisteredFontNames())

        for font_name, font_path in candidates:
            try:
                path = Path(font_path)
                if not path.exists():
                    continue

                if font_name not in already_registered:
                    pdfmetrics.registerFont(TTFont(font_name, str(path)))

                logger.warning("PDF font selected: %s (%s)", font_name, str(path))
                return font_name
            except Exception as exc:
                logger.warning("PDF font registration failed for %s: %s", font_path, exc)

        logger.warning("PDF font fallback to Helvetica (no unicode TTF found)")
        return "Helvetica"

    def _score_text(v: Any) -> str:
        if v is None or v == "":
            return ""
        try:
            fv = float(v)
            if fv.is_integer():
                return str(int(fv))
            return str(round(fv, 2))
        except Exception:
            return str(v)

    def _try_parse_structured(raw: Any) -> Any:
        if raw is None:
            return None
        if isinstance(raw, (dict, list, bool, int, float)):
            return raw
        if not isinstance(raw, str):
            return raw

        s = raw.strip()
        if not s:
            return ""

        try:
            return json.loads(s)
        except Exception:
            pass

        try:
            parsed = ast.literal_eval(s)
            if isinstance(parsed, (dict, list, bool, int, float, str)):
                return parsed
        except Exception:
            pass

        return s

    def _humanize_answer(a: Any) -> tuple[str, str]:
        if a is None:
            return "", ""

        answer_text = ""
        score_text = ""

        value_text = _try_parse_structured(getattr(a, "value_text", None))
        value_json = _try_parse_structured(getattr(a, "value_json", None))
        value = _try_parse_structured(getattr(a, "value", None))
        score = getattr(a, "score", None)

        candidate = value_json
        if candidate in (None, "", {}, []):
            candidate = value_text
        if candidate in (None, "", {}, []):
            candidate = value

        if isinstance(candidate, dict):
            choice = str(candidate.get("choice") or "").strip().lower()
            free_text = str(candidate.get("text") or "").strip()
            dict_score = candidate.get("score")

            if choice == "yes":
                answer_text = "Да"
            elif choice == "no":
                answer_text = "Нет"
            elif choice:
                answer_text = choice

            if free_text:
                answer_text = f"{answer_text} ({free_text})" if answer_text else free_text

            if dict_score is not None:
                score_text = _score_text(dict_score)

        elif isinstance(candidate, list):
            items = [str(x).strip() for x in candidate if str(x).strip()]
            answer_text = ", ".join(items)

        elif isinstance(candidate, bool):
            answer_text = "Да" if candidate else "Нет"

        elif candidate not in (None, ""):
            answer_text = str(candidate).strip()

        if answer_text in ("yes", "Yes", "YES"):
            answer_text = "Да"
        elif answer_text in ("no", "No", "NO"):
            answer_text = "Нет"

        if not score_text and score is not None:
            score_text = _score_text(score)

        if answer_text.startswith("{") and "choice" in answer_text and "score" in answer_text:
            answer_text = ""

        return answer_text, score_text

    def _pdf_text(value: Any) -> str:
        s = str(value or "").strip()
        s = (
            s.replace("&", "&amp;")
             .replace("<", "&lt;")
             .replace(">", "&gt;")
             .replace("\n", "<br/>")
        )
        return s

    def _p(value: Any, *, header: bool = False) -> Paragraph:
        return Paragraph(_pdf_text(value), header_cell_style if header else cell_style)

    run = await _ensure_run_access(db=db, user=user, run_id=int(run_id))
    if str(run.status) != "completed":
        raise HTTPException(status_code=400, detail="Run is not completed")

    tmpl = (
        await db.execute(
            select(ChecklistTemplate).where(ChecklistTemplate.id == int(run.template_id))
        )
    ).scalar_one()

    org_name = None
    if Organization is not None:
        org_name = (
            await db.execute(
                select(Organization.name).where(Organization.id == int(run.organization_id))
            )
        ).scalar_one_or_none()

    loc_name = None
    if Location is not None and getattr(run, "location_id", None):
        loc_name = (
            await db.execute(
                select(Location.name).where(Location.id == int(run.location_id))
            )
        ).scalar_one_or_none()

    location_label = (
        str(getattr(run, "location_text", "") or "").strip()
        or str(loc_name or "").strip()
        or ""
    )

    qs = (
        await db.execute(
            select(ChecklistQuestion)
            .where(ChecklistQuestion.template_id == int(run.template_id))
            .order_by(ChecklistQuestion.order.asc(), ChecklistQuestion.id.asc())
        )
    ).scalars().all()

    ans_rows = (
        await db.execute(select(ChecklistAnswer).where(ChecklistAnswer.run_id == int(run.id)))
    ).scalars().all()
    ans_by_q = {int(a.question_id): a for a in ans_rows}

    att_counts_rows = (
        await db.execute(
            select(ChecklistAttachment.question_id, func.count(ChecklistAttachment.id))
            .where(ChecklistAttachment.run_id == int(run.id))
            .group_by(ChecklistAttachment.question_id)
        )
    ).all()
    att_count = {int(qid): int(cnt) for qid, cnt in att_counts_rows}

    pdf_font_name = _register_pdf_font()

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
    )
    styles = getSampleStyleSheet()
    for style_name in ("Title", "Normal", "Heading1", "Heading2", "Heading3", "BodyText"):
        if style_name in styles:
            styles[style_name].fontName = pdf_font_name

    cell_style = ParagraphStyle(
        "PGCell",
        parent=styles["Normal"],
        fontName=pdf_font_name,
        fontSize=8,
        leading=10,
        wordWrap="CJK",
        spaceAfter=0,
        spaceBefore=0,
    )

    header_cell_style = ParagraphStyle(
        "PGHeaderCell",
        parent=styles["Normal"],
        fontName=pdf_font_name,
        fontSize=8,
        leading=10,
        alignment=1,
        spaceAfter=0,
        spaceBefore=0,
    )

    title = f"{getattr(tmpl, 'name', 'Checklist')} — отчет"
    logger.warning("PDF generation font in use: %s", pdf_font_name)
    meta_lines = [
        f"Статус: {_run_status_label(run.status)}",
        f"Организация: {org_name or ''}",
        f"Локация: {location_label}",
        f"Дата: {run.completed_at.strftime('%d.%m.%Y %H:%M') if getattr(run, 'completed_at', None) else ''}",
        f"Чек-лист № {run.id}",
    ]

    story = [
        Paragraph(_pdf_text(title), styles["Title"]),
        Spacer(1, 6),
        Paragraph(_pdf_text("<br/>".join(meta_lines)).replace("&lt;br/&gt;", "<br/>"), styles["Normal"]),
        Spacer(1, 10),
    ]

    data: list[list[Any]] = [[
        _p("#", header=True),
        _p("Раздел", header=True),
        _p("Вопрос", header=True),
        _p("Ответ", header=True),
        _p("Балл", header=True),
        _p("Комментарий", header=True),
        _p("Фото", header=True),
    ]]

    i = 1
    for q in qs:
        a = ans_by_q.get(int(q.id))
        answer_text, score_text = _humanize_answer(a)

        comment = ""
        if a is not None and hasattr(a, "comment") and getattr(a, "comment"):
            comment = str(getattr(a, "comment")).strip()

        photos = att_count.get(int(q.id), 0)

        data.append(
            [
                _p(str(i)),
                _p(str(getattr(q, "section", "") or "")),
                _p(str(getattr(q, "text", "") or "")),
                _p(answer_text),
                _p(score_text),
                _p(comment),
                _p("Есть" if photos else "Нет"),
            ]
        )
        i += 1

    tbl = Table(
        data,
        repeatRows=1,
        colWidths=[
            10 * mm,   # #
            34 * mm,   # Раздел
            92 * mm,   # Вопрос
            24 * mm,   # Ответ
            14 * mm,   # Балл
            58 * mm,   # Комментарий
            16 * mm,   # Фото
        ],
    )
    tbl.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), pdf_font_name),
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ("ALIGN", (4, 1), (4, -1), "CENTER"),
                ("ALIGN", (6, 1), (6, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
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
    _=Depends(
        require_roles(
            Role.auditor,
            Role.auditor_global,
            Role.ops_director,
            Role.director,
            Role.admin,
            Role.super_admin,
        )
    ),
):
    run = await _ensure_run_access(db=db, user=user, run_id=int(run_id))

    template = (
        await db.execute(select(ChecklistTemplate).where(ChecklistTemplate.id == run.template_id))
    ).scalar_one()

    location_label = str(getattr(run, "location_text", "") or "").strip()

    questions = (
        await db.execute(
            select(ChecklistQuestion)
            .where(ChecklistQuestion.template_id == run.template_id)
            .order_by(ChecklistQuestion.order.asc(), ChecklistQuestion.id.asc())
        )
    ).scalars().all()

    answers = (
        await db.execute(select(ChecklistAnswer).where(ChecklistAnswer.run_id == run.id))
    ).scalars().all()
    answers_by_q = {a.question_id: a for a in answers}

    attachments = (
        await db.execute(select(ChecklistAttachment).where(ChecklistAttachment.run_id == run.id))
    ).scalars().all()

    answered_count, total_questions = await _calc_progress(db=db, run=run)

    run_score = None
    if str(run.status) == "completed":
        run_score = calculate_run_score(questions=questions, answers=answers)

    att_by_q: dict[int, list[Any]] = {}
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
                    "value": getattr(ans, "value_json", None) if ans is not None else None,
                    "comment": getattr(ans, "comment", None) if ans is not None else None,
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
        "template_id": run.template_id,
        "organization_id": run.organization_id,
        "location_id": run.location_id,
        "location_text": (str(getattr(run, "location_text", "") or "").strip() or None),
        "auditor_user_id": run.auditor_user_id,
        "status": run.status,
        "started_at": _dt_iso(getattr(run, "started_at", None)),
        "updated_at": _dt_iso(getattr(run, "updated_at", None)),
        "completed_at": _dt_iso(getattr(run, "completed_at", None)),
        "answered_count": int(answered_count),
        "total_questions": int(total_questions),
        "template": {
            "id": template.id,
            "organization_id": template.organization_id,
            "name": template.name,
            "description": getattr(template, "description", "") or "",
            "scope": getattr(template, "scope", None),
            "location_type": getattr(template, "location_type", None),
            "version": getattr(template, "version", None),
            "is_active": getattr(template, "is_active", None),
        },
        "questions": out_questions,
        **({"score": run_score} if run_score is not None else {}),
    }
