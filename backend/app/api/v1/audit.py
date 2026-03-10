from __future__ import annotations

import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import FileResponse

from app.api.v1.deps import (
    GLOBAL_ROLE_VALUES,
    get_allowed_location_ids,
    get_allowed_organization_ids,
    get_current_user,
    get_db,
    user_has_any_role,
)
from app.core.config import settings
from app.models.audit_checklist import (
    ChecklistAnswer,
    ChecklistAttachment,
    ChecklistQuestion,
    ChecklistRun,
    ChecklistTemplate,
)
from app.models.location import Location
from app.models.role import Role
from app.models.user import User
from app.schemas.audit import (
    ChecklistAnswerUpsertIn,
    ChecklistRunCreateIn,
    ChecklistTemplateCreateIn,
)
from app.services.rbac import require_roles
from app.services.audit_scoring import calculate_run_score


router = APIRouter()

_FILENAME_CLEAN_RE = re.compile(r"[^a-zA-Z0-9._\-]+")


def _safe_filename(name: str) -> str:
    name = (name or "file").strip()
    name = name.replace("\\", "_").replace("/", "_")
    name = _FILENAME_CLEAN_RE.sub("_", name)
    return name[:120] if len(name) > 120 else name


async def _assert_run_read_access(db: AsyncSession, user: User, run: ChecklistRun) -> None:
    """
    Read rules:
    - director/auditor_global/super_admin -> can read any run within their allowed orgs
    - auditor -> can read only their own runs within allowed orgs
    """
    allowed_org_ids = set(await get_allowed_organization_ids(db=db, user=user))
    if run.organization_id not in allowed_org_ids:
        raise HTTPException(status_code=403, detail="No access to this organization")

    is_global = await user_has_any_role(db, user, GLOBAL_ROLE_VALUES)
    if is_global:
        return

    is_auditor = await user_has_any_role(db, user, {Role.auditor.value})
    if is_auditor and run.auditor_user_id == user.id:
        return

    raise HTTPException(status_code=403, detail="Forbidden")


async def _assert_run_write_access(db: AsyncSession, user: User, run: ChecklistRun) -> None:
    """
    Write rules (answers/attachments):
    - auditor -> only own runs
    - auditor_global -> any run within allowed orgs
    - director -> read-only
    """
    if run.status != "draft":
        raise HTTPException(status_code=409, detail="Checklist run is not editable")

    allowed_org_ids = set(await get_allowed_organization_ids(db=db, user=user))
    if run.organization_id not in allowed_org_ids:
        raise HTTPException(status_code=403, detail="No access to this organization")

    is_auditor_global = await user_has_any_role(db, user, {Role.auditor_global.value, "super_admin"})
    if is_auditor_global:
        return

    is_auditor = await user_has_any_role(db, user, {Role.auditor.value})
    if is_auditor and run.auditor_user_id == user.id:
        return

    raise HTTPException(status_code=403, detail="Forbidden")


@router.get("/templates")
async def list_templates(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles(Role.auditor, Role.auditor_global, Role.director)),
    user: User = Depends(get_current_user),
):
    allowed_org_ids = await get_allowed_organization_ids(db=db, user=user)

    q = (
        select(ChecklistTemplate)
        .where(
            ChecklistTemplate.is_active == True,  # noqa: E712
            (ChecklistTemplate.organization_id.is_(None))
            | (ChecklistTemplate.organization_id.in_(allowed_org_ids)),
        )
        .order_by(ChecklistTemplate.name.asc(), ChecklistTemplate.version.desc(), ChecklistTemplate.id.desc())
    )

    rows = (await db.execute(q)).scalars().all()
    return [
        {
            "id": t.id,
            "organization_id": t.organization_id,
            "name": t.name,
            "description": t.description,
            "scope": t.scope,
            "location_type": t.location_type,
            "version": t.version,
            "is_active": t.is_active,
        }
        for t in rows
    ]


@router.post("/templates", status_code=201)
async def create_template(
    payload: ChecklistTemplateCreateIn,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles(Role.auditor_global, Role.director)),
    user: User = Depends(get_current_user),
):
    # helper endpoint до PATCH 5 (импорт Excel)
    if payload.organization_id is not None:
        allowed_org_ids = await get_allowed_organization_ids(db=db, user=user)
        if int(payload.organization_id) not in set(int(x) for x in allowed_org_ids):
            raise HTTPException(status_code=403, detail="No access to this organization")

    t = ChecklistTemplate(
        organization_id=payload.organization_id,
        name=payload.name,
        description=payload.description or "",
        scope=payload.scope or "organization",
        location_type=payload.location_type,
        version=int(payload.version or 1),
        is_active=bool(payload.is_active),
    )
    db.add(t)
    await db.flush()

    for idx, q in enumerate(payload.questions or []):
        answer_type = str(q.get("answer_type") or "yesno")
        options = q.get("options") or {}
        if answer_type in {"yesno", "yesno_score"} and not options:
            options = {"labels": {"yes": "Да", "no": "Нет"}, "yes_score": 1, "no_score": 0}

        qq = ChecklistQuestion(
            template_id=t.id,
            order=int(q.get("order") if q.get("order") is not None else idx),
            section=str(q.get("section") or ""),
            text=str(q.get("text") or q.get("question_text") or "").strip(),
            answer_type=answer_type,
            options=options,
            is_required=bool(q.get("is_required") or q.get("required") or False),
            allow_comment=bool(q.get("allow_comment") if q.get("allow_comment") is not None else True),
            allow_photos=bool(q.get("allow_photos") if q.get("allow_photos") is not None else True),
        )
        if not qq.text:
            continue
        db.add(qq)

    await db.commit()
    return {
        "id": t.id,
        "organization_id": t.organization_id,
        "name": t.name,
        "description": t.description,
        "scope": t.scope,
        "location_type": t.location_type,
        "version": t.version,
        "is_active": t.is_active,
    }


@router.post("/runs", status_code=201)
async def create_run(
    payload: ChecklistRunCreateIn,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles(Role.auditor, Role.auditor_global)),
    user: User = Depends(get_current_user),
):
    allowed_org_ids = set(await get_allowed_organization_ids(db=db, user=user))
    if int(payload.organization_id) not in allowed_org_ids:
        raise HTTPException(status_code=403, detail="No access to this organization")

    template = (
        await db.execute(
            select(ChecklistTemplate).where(
                ChecklistTemplate.id == payload.template_id,
                ChecklistTemplate.is_active == True,  # noqa: E712
            )
        )
    ).scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Checklist template not found")

    if template.organization_id is not None and int(template.organization_id) != int(payload.organization_id):
        raise HTTPException(status_code=400, detail="Template does not belong to this organization")

    raw_scope = str(template.scope or "organization").strip().lower()
    scope = "group" if raw_scope == "location" else raw_scope

    location_id = payload.location_id
    location: Location | None = None

    # Новая логика:
    # - organization -> run без location_id
    # - group        -> run без location_id, но template.location_type обязателен
    # Старый scope=location трактуем как group (без миграции БД)
    if scope == "group" and not str(template.location_type or "").strip():
        raise HTTPException(status_code=400, detail="Group checklist must have location_type")

    # location_id теперь необязателен.
    # Если фронт по старой логике всё ещё прислал location_id — валидируем его,
    # но сам run всё равно НЕ привязываем к конкретной локации для organization/group шаблонов.
    if location_id is not None:
        allowed_loc_ids = set(await get_allowed_location_ids(db=db, user=user))
        if int(location_id) not in allowed_loc_ids:
            raise HTTPException(status_code=403, detail="No access to this location")

        location = (await db.execute(select(Location).where(Location.id == int(location_id)))).scalar_one_or_none()
        if not location or not location.is_active:
            raise HTTPException(status_code=404, detail="Location not found")
        if int(location.organization_id) != int(payload.organization_id):
            raise HTTPException(status_code=400, detail="Location does not belong to this organization")

        if scope == "group" and template.location_type and str(location.type) != str(template.location_type):
            raise HTTPException(status_code=400, detail="Template is not applicable for this location type")

    effective_location_id = None if scope in {"organization", "group"} else (int(location_id) if location_id is not None else None)

    run = ChecklistRun(
        template_id=template.id,
        organization_id=int(payload.organization_id),
        location_id=effective_location_id,
        auditor_user_id=user.id,
        status="draft",
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    return {
        "id": run.id,
        "template_id": run.template_id,
        "organization_id": run.organization_id,
        "location_id": run.location_id,
        "auditor_user_id": run.auditor_user_id,
        "status": run.status,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "updated_at": run.updated_at.isoformat() if run.updated_at else None,
    }


@router.get("/runs/{run_id}")
async def get_run(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles(Role.auditor, Role.auditor_global, Role.director)),
    user: User = Depends(get_current_user),
):
    run = (await db.execute(select(ChecklistRun).where(ChecklistRun.id == int(run_id)))).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    # completed run можно читать, но нельзя редактировать
    await _assert_run_read_access(db=db, user=user, run=run)

    template = (await db.execute(select(ChecklistTemplate).where(ChecklistTemplate.id == run.template_id))).scalar_one()
    questions = (
        await db.execute(
            select(ChecklistQuestion)
            .where(ChecklistQuestion.template_id == run.template_id)
            .order_by(ChecklistQuestion.order.asc(), ChecklistQuestion.id.asc())
        )
    ).scalars().all()

    answers = (await db.execute(select(ChecklistAnswer).where(ChecklistAnswer.run_id == run.id))).scalars().all()
    ans_by_q = {int(a.question_id): a for a in answers}

    run_score = None
    if str(run.status) == "completed":
        run_score = calculate_run_score(questions=questions, answers=answers)

    atts = (await db.execute(select(ChecklistAttachment).where(ChecklistAttachment.run_id == run.id))).scalars().all()
    att_by_q: dict[int, list[ChecklistAttachment]] = {}
    for a in atts:
        att_by_q.setdefault(int(a.question_id), []).append(a)

    items = []
    for q in questions:
        a = ans_by_q.get(int(q.id))
        q_atts = att_by_q.get(int(q.id), [])
        items.append(
            {
                "id": q.id,
                "order": q.order,
                "section": q.section,
                "text": q.text,
                "answer_type": q.answer_type,
                "options": q.options or {},
                "is_required": q.is_required,
                "allow_comment": q.allow_comment,
                "allow_photos": q.allow_photos,
                "answer": ({"value": a.value or {}, "comment": a.comment or ""} if a is not None else None),
                "attachments": [
                    {
                        "id": x.id,
                        "file_name": x.file_name,
                        "content_type": x.content_type,
                        "size_bytes": x.size_bytes,
                        "created_at": x.created_at.isoformat() if x.created_at else None,
                    }
                    for x in sorted(q_atts, key=lambda z: int(z.id))
                ],
            }
        )

    return {
        "id": run.id,
        "template_id": run.template_id,
        "organization_id": run.organization_id,
        "location_id": run.location_id,
        "auditor_user_id": run.auditor_user_id,
        "status": run.status,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "updated_at": run.updated_at.isoformat() if run.updated_at else None,
        "template": {
            "id": template.id,
            "organization_id": template.organization_id,
            "name": template.name,
            "description": template.description,
            "scope": template.scope,
            "location_type": template.location_type,
            "version": template.version,
            "is_active": template.is_active,
        },
        "questions": items,
        "answered_count": len(answers),
        "total_questions": len(questions),
        **({"score": run_score} if run_score is not None else {}),
    }


@router.put("/runs/{run_id}/questions/{question_id}/answer")
async def upsert_answer(
    run_id: int,
    question_id: int,
    payload: ChecklistAnswerUpsertIn,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles(Role.auditor, Role.auditor_global)),
    user: User = Depends(get_current_user),
):
    run = (await db.execute(select(ChecklistRun).where(ChecklistRun.id == int(run_id)))).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if str(run.status) != "draft":
        raise HTTPException(status_code=409, detail="Run is completed (read-only)")

    await _assert_run_write_access(db=db, user=user, run=run)

    q = (
        await db.execute(
            select(ChecklistQuestion).where(
                ChecklistQuestion.id == int(question_id),
                ChecklistQuestion.template_id == run.template_id,
            )
        )
    ).scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")

    existing = (
        await db.execute(
            select(ChecklistAnswer).where(
                ChecklistAnswer.run_id == run.id,
                ChecklistAnswer.question_id == int(question_id),
            )
        )
    ).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if existing:
        existing.value = payload.value or {}
        existing.comment = (payload.comment or "").strip()
        existing.updated_at = now
        await db.commit()
        return {"id": existing.id, "question_id": question_id, "updated_at": existing.updated_at.isoformat()}

    a = ChecklistAnswer(
        run_id=run.id,
        question_id=int(question_id),
        value=payload.value or {},
        comment=(payload.comment or "").strip(),
        created_at=now,
        updated_at=now,
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return {"id": a.id, "question_id": question_id, "updated_at": a.updated_at.isoformat()}


@router.post("/runs/{run_id}/questions/{question_id}/attachments", status_code=201)
async def upload_attachment(
    run_id: int,
    question_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles(Role.auditor, Role.auditor_global)),
    user: User = Depends(get_current_user),
):
    run = (await db.execute(select(ChecklistRun).where(ChecklistRun.id == int(run_id)))).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if str(run.status) != "draft":
        raise HTTPException(status_code=409, detail="Run is completed (read-only)")

    await _assert_run_write_access(db=db, user=user, run=run)

    q = (
        await db.execute(
            select(ChecklistQuestion).where(
                ChecklistQuestion.id == int(question_id),
                ChecklistQuestion.template_id == run.template_id,
            )
        )
    ).scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")

    base_dir = Path(settings.AUDIT_UPLOAD_DIR)
    sub_dir = base_dir / f"run_{run.id}" / f"q_{int(question_id)}"
    sub_dir.mkdir(parents=True, exist_ok=True)

    original_name = _safe_filename(file.filename or "photo")
    ext = Path(original_name).suffix or ".jpg"
    stored_name = f"{uuid4().hex}{ext}"
    stored_rel_path = str((sub_dir / stored_name).as_posix())

    abs_path = Path(os.getcwd()) / stored_rel_path
    with abs_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    size = abs_path.stat().st_size

    att = ChecklistAttachment(
        run_id=run.id,
        question_id=int(question_id),
        uploader_user_id=user.id,
        file_name=original_name,
        content_type=file.content_type or "",
        file_path=stored_rel_path,
        size_bytes=int(size),
    )
    db.add(att)
    await db.commit()
    await db.refresh(att)

    return {
        "id": att.id,
        "file_name": att.file_name,
        "content_type": att.content_type,
        "size_bytes": att.size_bytes,
        "created_at": att.created_at.isoformat() if att.created_at else None,
    }


@router.get("/attachments/{attachment_id}")
async def download_attachment(
    attachment_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles(Role.auditor, Role.auditor_global, Role.director)),
    user: User = Depends(get_current_user),
):
    att = (await db.execute(select(ChecklistAttachment).where(ChecklistAttachment.id == int(attachment_id)))).scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    run = (await db.execute(select(ChecklistRun).where(ChecklistRun.id == int(att.run_id)))).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    # completed run можно читать и скачивать
    await _assert_run_read_access(db=db, user=user, run=run)

    abs_path = Path(os.getcwd()) / str(att.file_path)
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="File missing on server")

    return FileResponse(
        path=str(abs_path),
        media_type=att.content_type or "application/octet-stream",
        filename=att.file_name,
    )
