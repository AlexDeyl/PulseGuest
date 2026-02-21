from __future__ import annotations
import re

from datetime import datetime, timezone, date

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, or_

from app.api.v1.deps import get_db
from app.core.config import settings
from app.models.location import Location
from app.models.survey import Survey, SurveyVersion
from app.models.submission import Submission

# Patch 8.2.x
from app.models.stay import Stay  # type: ignore

router = APIRouter(tags=["public"])


def build_greeting(display_name: str | None = None) -> str:
    """
    MVP greeting. Позже сюда добавим персонализацию через PMS/API.
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
            name = slide.get("field")
            required = bool(slide.get("required"))
            if not name:
                continue
            if required and (name not in answers or answers.get(name) in (None, "")):
                errors.append(f"missing:{name}")
                continue

            if name in answers and answers.get(name) not in (None, ""):
                try:
                    val = int(answers.get(name))  # type: ignore
                except Exception:
                    errors.append(f"invalid:{name}:int")
                    continue
                # optional scale check
                scale = slide.get("scale")
                if scale is not None:
                    try:
                        scale_int = int(scale)
                        if val < 0 or val > scale_int:
                            errors.append(f"invalid:{name}:range")
                    except Exception:
                        pass

        elif stype == "text":
            name = slide.get("field")
            required = bool(slide.get("required"))
            if not name:
                continue
            if required and (name not in answers or answers.get(name) in (None, "")):
                errors.append(f"missing:{name}")
                continue

            if name in answers and answers.get(name) not in (None, ""):
                if not isinstance(answers.get(name), str):
                    errors.append(f"invalid:{name}:str")
                    continue
                max_len = slide.get("maxLength") or slide.get("max_length")
                if max_len is not None:
                    try:
                        ml = int(max_len)
                        if len(str(answers.get(name))) > ml:
                            errors.append(f"invalid:{name}:maxlen")
                    except Exception:
                        pass

        elif stype == "contact":
            fields = slide.get("fields") or []
            if not isinstance(fields, list):
                continue

            for f in fields:
                if not isinstance(f, dict):
                    continue
                name = f.get("field")
                ftype = f.get("type") or "text"
                required = bool(f.get("required"))

                if not name:
                    continue

                if required and (name not in answers or answers.get(name) in (None, "")):
                    errors.append(f"missing:{name}")
                    continue

                if name in answers and answers.get(name) not in (None, ""):
                    val = answers.get(name)

                    if ftype == "email":
                        if not isinstance(val, str) or not _EMAIL_RE.match(val.strip()):
                            errors.append(f"invalid:{name}:email")
                    else:
                        if not isinstance(val, str):
                            errors.append(f"invalid:{name}:str")

    return errors


def _norm_room(room: str | None) -> str | None:
    if room is None:
        return None
    r = str(room).strip()
    if not r:
        return None
    return r


async def _find_current_stay_for_room(
    db: AsyncSession,
    *,
    location_id: int,
    room: str,
    on: date | None = None,
) -> Stay | None:
    """
    Ищем актуальный stay для комнаты на дату on:
      checkin_at <= on < checkout_at
    """
    on = on or datetime.now(timezone.utc).date()

    s = (
        await db.execute(
            select(Stay)
            .where(
                Stay.location_id == location_id,
                Stay.room == room,
                Stay.checkin_at <= on,
                Stay.checkout_at >= on,
            )
            .order_by(desc(Stay.checkin_at), desc(Stay.id))
            .limit(1)
        )
    ).scalar_one_or_none()

    return s


async def _find_room_location_in_org(
    db: AsyncSession,
    *,
    organization_id: int,
    room: str,
) -> Location | None:
    """
    Best-effort mapping room -> Location внутри одной организации.

    MVP (как в resolve):
      - code == room
      - name == room
      - slug ILIKE %room%
    """
    room_q = _norm_room(room)
    if not room_q:
        return None

    room_loc = (
        await db.execute(
            select(Location)
            .where(
                Location.organization_id == organization_id,
                Location.is_active == True,  # noqa: E712
                or_(
                    Location.code == room_q,
                    Location.name == room_q,
                    Location.slug.ilike(f"%{room_q}%"),
                ),
            )
            .order_by(desc(Location.id))
            .limit(1)
        )
    ).scalar_one_or_none()

    return room_loc


def _stay_to_guest(stay: Stay) -> dict:
    return {
        "stay_id": stay.id,
        "room": stay.room,
        "guest_name": stay.guest_name,
        "checkin_at": stay.checkin_at.isoformat(),
        "checkout_at": stay.checkout_at.isoformat(),
        "reservation_code": stay.reservation_code,
        "source": stay.source,
    }


@router.get("/resolve/{slug}")
async def resolve_by_slug(
    slug: str,
    room: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """
    Public resolve by slug:
      - найти Location по slug (активную)
      - найти active survey version для location
      - (Patch 8.2.2/8.2.3) greeting + PMS-like guest name by ?room=
    """
    slug_norm = slug.strip().lower()

    locs = (
        (
            await db.execute(
                select(Location).where(
                    Location.slug == slug_norm,
                    Location.is_active == True,  # noqa: E712
                )
            )
        )
        .scalars()
        .all()
    )
    if not locs:
        raise HTTPException(status_code=404, detail="Not Found")

    loc = locs[0]

    # active survey (как было, без is_archived на SurveyVersion!)
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

    # guest lookup by room
    guest = None
    display_name = None

    async def find_stay(location_id: int) -> Stay | None:
        room_q = _norm_room(room)
        if not room_q:
            return None
        return await _find_current_stay_for_room(db, location_id=location_id, room=room_q)

    stay = await find_stay(loc.id)
    if not stay and room:
        room_q = _norm_room(room)
        room_loc = (
            await db.execute(
                select(Location)
                .where(
                    Location.organization_id == loc.organization_id,
                    Location.is_active == True,  # noqa: E712
                    or_(
                        Location.code == room_q,
                        Location.name == room_q,
                        Location.slug.ilike(f"%{room_q}%"),
                    ),
                )
                .order_by(desc(Location.id))
                .limit(1)
            )
        ).scalar_one_or_none()

        if room_loc:
            stay = await find_stay(room_loc.id)

    if stay:
        display_name = stay.guest_name
        # guest включает stay_id
        guest = _stay_to_guest(stay)

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
        "guest": guest,
        "greeting": build_greeting(display_name),
    }


@router.get("/locations/{location_id}/active-survey")
async def get_active_survey(location_id: int, db: AsyncSession = Depends(get_db)):
    loc = (await db.execute(select(Location).where(Location.id == location_id))).scalar_one_or_none()
    if not loc or not loc.is_active:
        raise HTTPException(status_code=404, detail="Location not found")

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

    if not row:
        raise HTTPException(status_code=404, detail="No active survey")

    ver, survey = row
    return {
        "survey_id": survey.id,
        "version_id": ver.id,
        "version": ver.version,
        "schema": ver.schema,
        "widget_config": ver.widget_config,
    }


@router.post("/submissions")
async def submit_answers(payload: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """
    payload ожидается:
      { "version_id": int (optional), "location_id": int, "answers": {...}, "meta": {...optional...} }

    Patch 8.2.3:
      meta может содержать stay_id и/или room — сервер сам подтвердит stay и положит данные гостя в meta.

    Patch 8.4:
      stay может лежать на "room"-локации в той же организации, даже если submission отправляем на "hotel"-локацию.
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
    loc = (await db.execute(select(Location).where(Location.id == location_id))).scalar_one_or_none()
    if not loc or not loc.is_active:
        raise HTTPException(status_code=404, detail="Location not found")

    # 3) find / validate active version for this location
    if version_id_raw is None:
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

        if not row:
            raise HTTPException(status_code=404, detail="No active survey")

        ver, _survey = row
    else:
        try:
            version_id = int(version_id_raw)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid version_id")

        ver = (await db.execute(select(SurveyVersion).where(SurveyVersion.id == version_id))).scalar_one_or_none()
        if not ver:
            raise HTTPException(status_code=404, detail="Survey version not found")

        survey = (await db.execute(select(Survey).where(Survey.id == ver.survey_id))).scalar_one_or_none()
        if not survey or survey.location_id != loc.id:
            raise HTTPException(status_code=400, detail="version_id does not belong to location")

    # 4) validate against schema
    errors = _validate_answers_against_schema(ver.schema, answers)
    if errors:
        raise HTTPException(
            status_code=422,
            detail={"message": "Schema validation failed", "errors": errors},
        )

    # 5) meta enrich (base)
    meta = payload.get("meta") or {}
    if not isinstance(meta, dict):
        meta = {}

    meta.setdefault("user_agent", request.headers.get("user-agent"))
    if settings.STORE_IP:
        meta.setdefault("ip", request.client.host if request.client else None)

    # 5.1) attach stay (do NOT trust frontend blindly)
    on = datetime.now(timezone.utc).date()

    stay_obj: Stay | None = None

    stay_id_raw = payload.get("stay_id") or meta.get("stay_id")
    room_raw = payload.get("room") or meta.get("room")
    room_norm = _norm_room(room_raw)

    # a) prefer stay_id if provided (but verify it belongs to the same organization)
    # IMPORTANT: submission может быть отправлен на "hotel" локацию,
    # а stay лежит на "room" локации внутри этой же организации.
    if stay_id_raw is not None:
        try:
            stay_id = int(stay_id_raw)
        except Exception:
            stay_id = 0

        if stay_id > 0:
            s = (
                await db.execute(
                    select(Stay)
                    .join(Location, Location.id == Stay.location_id)
                    .where(
                        Stay.id == stay_id,
                        Location.organization_id == loc.organization_id,
                        Stay.checkin_at <= on,
                        Stay.checkout_at >= on,
                    )
                )
            ).scalar_one_or_none()
            if s:
                stay_obj = s

    # b) fallback by room in current location
    if stay_obj is None and room_norm:
        stay_obj = await _find_current_stay_for_room(
            db, location_id=location_id, room=room_norm, on=on
        )

    # c) fallback: room may map to another location inside org (room-location)
    if stay_obj is None and room_norm:
        room_loc = await _find_room_location_in_org(
            db, organization_id=loc.organization_id, room=room_norm
        )
        if room_loc and room_loc.id != location_id:
            stay_obj = await _find_current_stay_for_room(
                db, location_id=room_loc.id, room=room_norm, on=on
            )

    # c) enrich meta
    if stay_obj is not None:
        meta["stay_id"] = stay_obj.id
        meta["room"] = stay_obj.room
        meta["guest_name"] = stay_obj.guest_name
        meta["checkin_at"] = stay_obj.checkin_at.isoformat()
        meta["checkout_at"] = stay_obj.checkout_at.isoformat()
        meta["reservation_code"] = stay_obj.reservation_code
        meta["stay_source"] = stay_obj.source
        meta["stay_location_id"] = stay_obj.location_id

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
