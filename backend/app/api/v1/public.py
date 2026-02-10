from __future__ import annotations
import re


from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.api.v1.deps import get_db
from app.core.config import settings
from app.models.location import Location
from app.models.survey import Survey, SurveyVersion
from app.models.submission import Submission

router = APIRouter(prefix="/public", tags=["public"])


def build_greeting(display_name: str | None = None) -> str:
    """
    MVP greeting. Позже сюда добавим персонализацию через GuestProfile из PMS.
    """
    if display_name:
        return (
            f"Здравствуйте, {display_name}! "
            "Спасибо, что выбрали нас. Оцените, пожалуйста, ваш опыт — "
            "это займёт 1–2 минуты и помогает улучшать сервис."
        )
    return (
        "Здравствуйте! Спасибо, что выбрали нас. "
        "Оцените, пожалуйста, ваш опыт — это займёт 1–2 минуты и помогает улучшать сервис."
    )


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_answers_against_schema(schema: dict | None, answers: dict) -> list[str]:
    """
    Возвращает список ошибок. Пустой список = ок.
    Мы валидируем только то, что явно описано в schema (slides).
    """
    errors: list[str] = []

    if not schema or not isinstance(schema, dict):
        return errors

    slides = schema.get("slides")
    if not isinstance(slides, list):
        return errors

    for slide in slides:
        if not isinstance(slide, dict):
            continue

        stype = slide.get("type")
        if stype in ("rating", "nps"):
            field = slide.get("field")
            if not field:
                continue

            required = bool(slide.get("required"))
            val = answers.get(field)

            if required and (val is None or val == ""):
                errors.append(f"missing:{field}")
                continue

            if val is None or val == "":
                continue

            try:
                ival = int(val)
            except Exception:
                errors.append(f"invalid:{field}:not_int")
                continue

            scale = slide.get("scale") or 10
            try:
                scale = int(scale)
            except Exception:
                scale = 10

            # допускаем 0..scale (безопаснее, чем ломать клиент на '0')
            if ival < 0 or ival > scale:
                errors.append(f"invalid:{field}:out_of_range_0..{scale}")

        elif stype == "text":
            field = slide.get("field")
            if not field:
                continue

            required = bool(slide.get("required"))
            val = answers.get(field)

            if required and (val is None or val == ""):
                errors.append(f"missing:{field}")
                continue

            if val is None or val == "":
                continue

            if not isinstance(val, str):
                errors.append(f"invalid:{field}:not_string")
                continue

            max_len = slide.get("maxLength")
            if isinstance(max_len, int) and len(val) > max_len:
                errors.append(f"invalid:{field}:too_long>{max_len}")

        elif stype == "contact":
            fields = slide.get("fields") or []
            if not isinstance(fields, list):
                continue

            for f in fields:
                if not isinstance(f, dict):
                    continue
                name = f.get("field")
                if not name:
                    continue

                required = bool(f.get("required"))
                val = answers.get(name)

                if required and (val is None or val == ""):
                    errors.append(f"missing:{name}")
                    continue

                if val is None or val == "":
                    continue

                ftype = f.get("type")
                if ftype == "email":
                    if not isinstance(val, str) or not _EMAIL_RE.match(val.strip()):
                        errors.append(f"invalid:{name}:email")

    return errors


async def _get_location_by_slug_or_error(db: AsyncSession, slug: str) -> Location:
    rows = (
        await db.execute(
            select(Location)
            .where(Location.slug == slug, Location.is_active == True)  # noqa: E712
            .order_by(desc(Location.created_at), desc(Location.id))
        )
    ).scalars().all()

    if not rows:
        raise HTTPException(status_code=404, detail="Location not found")

    # Важно: по модели slug уникален ТОЛЬКО внутри organization.
    # Поэтому если есть несколько org с одинаковым slug — это конфиг-ошибка.
    if len(rows) > 1:
        raise HTTPException(
            status_code=409,
            detail="Slug is not unique. Use unique slugs across organizations (or extend resolve endpoint later).",
        )

    return rows[0]


async def _get_active_for_location(db: AsyncSession,
                                   location_id: int) -> dict | None:
    """
    Возвращает active-объект вида:
      {"survey_id", "version_id", "version", "schema", "widget_config"}
    или None
    """
    row = (
        await db.execute(
            select(SurveyVersion, Survey)
            .join(Survey, Survey.id == SurveyVersion.survey_id)
            .where(
                Survey.location_id == location_id,
                SurveyVersion.is_active == True,  # noqa: E712
            )
            .order_by(
                desc(SurveyVersion.version),
                desc(SurveyVersion.created_at),
                desc(SurveyVersion.id),
            )
            .limit(1)
        )
    ).first()

    if not row:
        return None

    ver, survey = row
    return {
        "survey_id": survey.id,
        "version_id": ver.id,
        "version": ver.version,
        "schema": ver.schema,
        "widget_config": ver.widget_config,
    }


async def _validate_version_belongs_to_location(
    db: AsyncSession, *, version_id: int, location_id: int
) -> bool:
    """
    True если версия существует, активна и принадлежит survey этой локации.
    """
    row = (
        await db.execute(
            select(SurveyVersion.id)
            .join(Survey, Survey.id == SurveyVersion.survey_id)
            .where(
                Survey.location_id == location_id,
                SurveyVersion.id == version_id,
                SurveyVersion.is_active == True,  # noqa: E712
            )
            .limit(1)
        )
    ).scalar_one_or_none()

    return row is not None


@router.get("/resolve/{slug}")
async def resolve_by_slug(slug: str, db: AsyncSession = Depends(get_db)):
    """
    Статичный QR ведёт на /public/resolve/{slug}
    Мы по slug находим Location и возвращаем активную анкету (если есть) + greeting.

    Важно: slug по бизнес-правилу должен быть уникальным глобально (иначе resolve неоднозначен).
    Если найдём несколько локаций с одним slug — вернём 409, чтобы не было скрытых ошибок.
    """
    locs = (
        await db.execute(
            select(Location)
            .where(Location.slug == slug, Location.is_active == True)  # noqa: E712
            .order_by(desc(Location.created_at), desc(Location.id))
        )
    ).scalars().all()

    if not locs:
        raise HTTPException(status_code=404, detail="Location not found")

    if len(locs) > 1:
        raise HTTPException(
            status_code=409,
            detail="Slug is not unique. Make slugs unique across organizations.",
        )

    loc = locs[0]

    # Ищем активную версию опроса для этой локации (через join SurveyVersion -> Survey)
    row = (
        await db.execute(
            select(SurveyVersion, Survey)
            .join(Survey, Survey.id == SurveyVersion.survey_id)
            .where(
                Survey.location_id == loc.id,
                SurveyVersion.is_active == True,  # noqa: E712
            )
            .order_by(
                desc(SurveyVersion.version),
                desc(SurveyVersion.created_at),
                desc(SurveyVersion.id),
            )
            .limit(1)
        )
    ).first()

    active = None
    if row:
        ver, survey = row
        active = {
            "survey_id": survey.id,
            "version_id": ver.id,
            "version": ver.version,
            "schema": ver.schema,
            "widget_config": ver.widget_config,
        }

    return {
        "location": {
            "id": loc.id,
            "organization_id": loc.organization_id,
            "type": loc.type,
            "code": loc.code,
            "name": loc.name,
            "slug": loc.slug,
        },
        "active": active,
        "guest": None,  # следующий спринт: PMS/CSV
        "greeting": build_greeting(None),
    }


@router.get("/locations/{location_id}/active-survey")
async def get_active_survey(location_id: int, db: AsyncSession = Depends(get_db)):
    """
    Legacy endpoint (оставляем чтобы фронт не упал).
    Теперь делает выбор активной версии через join и возвращает
    как старый "плоский" формат, так и новый "active".
    """
    loc = (
        await db.execute(select(Location).where(Location.id == location_id))
    ).scalar_one_or_none()

    if not loc or not loc.is_active:
        return {"active": None}

    row = (
        await db.execute(
            select(SurveyVersion, Survey)
            .join(Survey, Survey.id == SurveyVersion.survey_id)
            .where(
                Survey.location_id == location_id,
                SurveyVersion.is_active == True,  # noqa: E712
            )
            .order_by(
                desc(SurveyVersion.version),
                desc(SurveyVersion.created_at),
                desc(SurveyVersion.id),
            )
            .limit(1)
        )
    ).first()

    if not row:
        return {"active": None}

    ver, survey = row
    active = {
        "survey_id": survey.id,
        "version_id": ver.id,
        "version": ver.version,
        "schema": ver.schema,
        "widget_config": ver.widget_config,
    }

    # Старое поведение (плоские поля) + новый ключ active
    return {
        **active,
        "active": active,
    }


@router.post("/submissions")
async def submit_answers(payload: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """
    payload ожидается:
      { "version_id": int (optional), "location_id": int, "answers": {...}, "meta": {...optional...} }

    Если version_id не передали — берём активную версию для location_id.
    Если передали — проверяем что она активна и принадлежит этой локации.
    """
    # 1) parse
    try:
        location_id = int(payload["location_id"])
        answers = payload["answers"]
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid payload")

    if not isinstance(answers, dict):
        raise HTTPException(status_code=400, detail="answers must be an object")

    version_id_raw = payload.get("version_id")

    # 2) check location
    loc = (
        await db.execute(select(Location).where(Location.id == location_id))
    ).scalar_one_or_none()
    if not loc or not loc.is_active:
        raise HTTPException(status_code=404, detail="Location not found")

    # 3) find / validate active version for this location
    if version_id_raw is None:
        row = (
            await db.execute(
                select(SurveyVersion, Survey)
                .join(Survey, Survey.id == SurveyVersion.survey_id)
                .where(
                    Survey.location_id == location_id,
                    SurveyVersion.is_active == True,  # noqa: E712
                )
                .order_by(
                    desc(SurveyVersion.version),
                    desc(SurveyVersion.created_at),
                    desc(SurveyVersion.id),
                )
                .limit(1)
            )
        ).first()

        if not row:
            raise HTTPException(status_code=404, detail="Active survey not found for this location")

        ver, survey = row

    else:
        try:
            version_id = int(version_id_raw)
        except Exception:
            raise HTTPException(status_code=400, detail="version_id must be int")

        row = (
            await db.execute(
                select(SurveyVersion, Survey)
                .join(Survey, Survey.id == SurveyVersion.survey_id)
                .where(
                    Survey.location_id == location_id,
                    SurveyVersion.id == version_id,
                    SurveyVersion.is_active == True,  # noqa: E712
                )
                .limit(1)
            )
        ).first()

        if not row:
            raise HTTPException(status_code=404, detail="Active survey version not found for this location")

        ver, survey = row

    # 4) schema validation (required + basic)
    errors = _validate_answers_against_schema(getattr(ver, "schema", None), answers)
    if errors:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Schema validation failed",
                "errors": errors,
            },
        )

    # 5) meta enrich
    meta = payload.get("meta") or {}
    if not isinstance(meta, dict):
        meta = {}

    meta.setdefault("user_agent", request.headers.get("user-agent"))
    if settings.STORE_IP:
        meta.setdefault("ip", request.client.host if request.client else None)

    # 6) create
    sub = Submission(
        survey_version_id=ver.id,
        location_id=location_id,
        answers=answers,
        meta=meta,
        created_at=datetime.now(timezone.utc),
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)

    return {"ok": True, "id": sub.id}
