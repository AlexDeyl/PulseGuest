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

# IMPORTANT: поправь импорт модели, если у тебя файл/путь другой
from app.models.audit_checklist import (  # type: ignore
    ChecklistRun,
    ChecklistTemplate,
    ChecklistQuestion,
    ChecklistAnswer,
    ChecklistAttachment,
)

# IMPORTANT: поправь импорты, если у тебя модели лежат в других файлах
# Нужны только для "красивой истории" (location_name/org_name) и PDF meta.
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
            }
        )

    return out


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
