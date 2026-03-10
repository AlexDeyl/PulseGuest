from __future__ import annotations
import re
import logging

from datetime import datetime, timezone, date

from fastapi import APIRouter, Depends, HTTPException, Request, Query, Response, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, or_

from app.api.v1.deps import get_db
from app.core.config import settings
from app.models.location import Location
from app.models.organization import Organization
from app.models.survey import Survey, SurveyVersion
from app.models.submission import Submission
from app.models.group_survey_binding import GroupSurveyBinding
from app.services.public_url import build_public_url
from app.services.review_links import compute_effective_review_links
from app.services.qr import make_qr_png, make_qr_svg
from app.services.mailer import send_email_text, is_smtp_configured
from app.services.negative_feedback import (
    acquire_negative_notify_lock,
    build_admin_submission_link,
    build_negative_email,
    compute_overall_score,
    extract_short_comment,
    get_service_manager_emails_for_location,
    is_negative,
)

# Patch 8.2.x
from app.models.stay import Stay  # type: ignore

router = APIRouter(tags=["public"])
logger = logging.getLogger(__name__)


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


async def _resolve_active_survey_for_location(db: AsyncSession, loc: Location) -> tuple[SurveyVersion, Survey] | None:
    """
    Order:
      1) group binding (org_id + group_key=loc.type)
      2) fallback: location-level active survey (as before)
    """
    binding = (
        await db.execute(
            select(GroupSurveyBinding)
            .where(
                GroupSurveyBinding.organization_id == loc.organization_id,
                GroupSurveyBinding.group_key == loc.type,
            )
            .limit(1)
        )
    ).scalar_one_or_none()

    if binding:
        ver = (await db.execute(select(SurveyVersion).where(SurveyVersion.id == binding.active_version_id))).scalar_one_or_none()
        survey = (await db.execute(select(Survey).where(Survey.id == binding.survey_id))).scalar_one_or_none()
        if ver and survey and (ver.survey_id == survey.id) and (not bool(getattr(survey, "is_archived", False))):
            return ver, survey

    row = (
        await db.execute(
            select(SurveyVersion, Survey)
            .join(Survey, Survey.id == SurveyVersion.survey_id)
            .where(
                Survey.location_id == loc.id,
                SurveyVersion.is_active == True,  # noqa: E712
                Survey.is_archived == False,      # noqa: E712
            )
            .order_by(desc(SurveyVersion.version), desc(SurveyVersion.created_at), desc(SurveyVersion.id))
            .limit(1)
        )
    ).first()

    if not row:
        return None

    ver, survey = row
    return ver, survey


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

        elif stype == "choice":
            name = slide.get("field")
            required = bool(slide.get("required"))
            if not name:
                continue

            mode = str(slide.get("mode") or "single")  # "single" | "multi"
            raw_opts = slide.get("options") or []
            allowed: set[str] = set()

            if isinstance(raw_opts, list):
                for o in raw_opts:
                    if isinstance(o, dict):
                        v = o.get("value")
                        if isinstance(v, str) and v.strip():
                            allowed.add(v.strip())

            v = answers.get(name)

            if required:
                if v is None or v == "" or (isinstance(v, list) and len(v) == 0):
                    errors.append(f"missing:{name}")
                    continue

            if v is None or v == "":
                continue

            if mode == "multi":
                if not isinstance(v, list):
                    errors.append(f"invalid:{name}:list")
                    continue
                for item in v:
                    if not isinstance(item, str):
                        errors.append(f"invalid:{name}:list_str")
                        break
                    if allowed and item not in allowed:
                        errors.append(f"invalid:{name}:option")
                        break
            else:
                if not isinstance(v, str):
                    errors.append(f"invalid:{name}:str")
                    continue
                if allowed and v not in allowed:
                    errors.append(f"invalid:{name}:option")

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


async def _find_current_stay_for_location(
    db: AsyncSession,
    *,
    location_id: int,
    on: date | None = None,
) -> Stay | None:
    """
    Для локации-номера (type == room) ищем актуальный stay без query-параметра room:
      checkin_at <= on <= checkout_at
    Берём самый свежий по checkin_at/id.
    """
    on = on or datetime.now(timezone.utc).date()

    s = (
        await db.execute(
            select(Stay)
            .where(
                Stay.location_id == location_id,
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
    # active survey (group-first -> fallback location)
    resolved = await _resolve_active_survey_for_location(db, loc)

    active = None
    if resolved:
        ver, survey = resolved
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

    # Если это номер и room не передали (гость сканит QR из номера),
    # то попробуем найти актуальный stay по самой локации.
    if not stay and (not room) and (loc.type == "room"):
        stay = await _find_current_stay_for_location(db, location_id=loc.id)

    if stay:
        display_name = stay.guest_name
        # guest включает stay_id
        guest = _stay_to_guest(stay)
    
    # Effective review links for thank-you CTA (PATCH B)
    org = (
        await db.execute(select(Organization).where(Organization.id == loc.organization_id))
    ).scalar_one_or_none()
    review_links = None
    if org:
        review_links = compute_effective_review_links(
            org_settings=getattr(org, "settings", None),
            group_key=loc.type,
            location_settings=getattr(loc, "settings", None),
        )

    return {
        "location": {
            "id": loc.id,
            "organization_id": loc.organization_id,
            "type": loc.type,
            "code": loc.code,
            "name": loc.name,
            "slug": loc.slug,
        },
        "review_links": review_links,
        "active": active,
        "guest": guest,
        "greeting": build_greeting(display_name),
    }


def _qr_cache_headers(etag: str) -> dict[str, str]:
    # 1 day caching; revalidate with ETag.
    return {"ETag": f"\"{etag}\"", "Cache-Control": "public, max-age=86400"}


@router.get("/qr/{slug}.svg")
async def public_qr_svg(
    slug: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Public QR (SVG) by location slug.

    Safe-by-default: returns only the QR image for already-public slug.
    Useful for devices/screens that can't use admin auth.
    """
    slug_norm = slug.strip().lower()
    loc = (
        (
            await db.execute(
                select(Location).where(
                    Location.slug == slug_norm,
                    Location.is_active == True,  # noqa: E712
                )
            )
        )
        .scalars()
        .first()
    )
    if not loc:
        raise HTTPException(status_code=404, detail="Not Found")

    payload = build_public_url(loc.slug)
    svg_bytes, etag = make_qr_svg(payload)

    inm = (request.headers.get("if-none-match") or "").strip().strip('"')
    if inm and inm == etag:
        return Response(status_code=304, headers=_qr_cache_headers(etag))

    return Response(
        content=svg_bytes,
        media_type="image/svg+xml",
        headers=_qr_cache_headers(etag),
    )


@router.get("/qr/{slug}.png")
async def public_qr_png(
    slug: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Public QR (PNG) by location slug."""
    slug_norm = slug.strip().lower()
    loc = (
        (
            await db.execute(
                select(Location).where(
                    Location.slug == slug_norm,
                    Location.is_active == True,  # noqa: E712
                )
            )
        )
        .scalars()
        .first()
    )
    if not loc:
        raise HTTPException(status_code=404, detail="Not Found")

    payload = build_public_url(loc.slug)
    try:
        png_bytes, etag = make_qr_png(payload)
    except Exception:
        raise HTTPException(status_code=501, detail="PNG QR is not available in this build")

    inm = (request.headers.get("if-none-match") or "").strip().strip('"')
    if inm and inm == etag:
        return Response(status_code=304, headers=_qr_cache_headers(etag))

    return Response(
        content=png_bytes,
        media_type="image/png",
        headers=_qr_cache_headers(etag),
    )


@router.get("/locations/{location_id}/active-survey")
async def get_active_survey(location_id: int, db: AsyncSession = Depends(get_db)):
    loc = (await db.execute(select(Location).where(Location.id == location_id))).scalar_one_or_none()
    if not loc or not loc.is_active:
        raise HTTPException(status_code=404, detail="Location not found")

    resolved = await _resolve_active_survey_for_location(db, loc)

    if not resolved:
        raise HTTPException(status_code=404, detail="No active survey")

    ver, survey = resolved

    # Effective review links for thank-you CTA (PATCH B)
    org = (
        await db.execute(select(Organization).where(Organization.id == loc.organization_id))
    ).scalar_one_or_none()
    review_links = None
    if org:
        review_links = compute_effective_review_links(
            org_settings=getattr(org, "settings", None),
            group_key=loc.type,
            location_settings=getattr(loc, "settings", None),
        )

    return {
        "survey_id": survey.id,
        "version_id": ver.id,
        "version": ver.version,
        "schema": ver.schema,
        "widget_config": ver.widget_config,
        "review_links": review_links,
    }


@router.post("/submissions")
async def submit_answers(
    payload: dict,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
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

    # 3) find / validate active version for this location (group-first -> fallback location)
    if version_id_raw is None:
        resolved = await _resolve_active_survey_for_location(db, loc)
        if not resolved:
            raise HTTPException(status_code=404, detail="No active survey")
        ver, _survey = resolved
    else:
        try:
            version_id = int(version_id_raw)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid version_id")

        ver = (
            await db.execute(select(SurveyVersion).where(SurveyVersion.id == version_id))
        ).scalar_one_or_none()
        if not ver:
            raise HTTPException(status_code=404, detail="Survey version not found")

        survey = (await db.execute(select(Survey).where(Survey.id == ver.survey_id))).scalar_one_or_none()
        if not survey:
            raise HTTPException(status_code=404, detail="Survey not found")

        # Allowed:
        #  - location survey (survey.location_id == loc.id)
        #  - group survey bound to (loc.organization_id + loc.type)
        if survey.location_id == loc.id:
            pass
        elif survey.location_id is None:
            binding = (
                await db.execute(
                    select(GroupSurveyBinding).where(
                        GroupSurveyBinding.organization_id == loc.organization_id,
                        GroupSurveyBinding.group_key == loc.type,
                        GroupSurveyBinding.survey_id == survey.id,
                    )
                )
            ).scalar_one_or_none()
            if not binding:
                raise HTTPException(status_code=400, detail="version_id does not belong to location/group")
        else:
            raise HTTPException(status_code=400, detail="version_id does not belong to location/group")

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

    # PATCH E: negative feedback email notification (idempotent + best-effort throttling)
    try:
        overall = compute_overall_score(answers=answers, schema=ver.schema)
        if overall is not None:
            score, scale = overall

            if is_negative(score, scale):
                # 1) Best-effort cooldown to mitigate accidental double-submits
                allowed_now = await acquire_negative_notify_lock(location_id=int(loc.id))
                if not allowed_now:
                    logger.info(
                        "Negative feedback notify throttled (cooldown) for location_id=%s submission_id=%s",
                        loc.id,
                        sub.id,
                    )
                else:
                    # 2) Gather recipients
                    emails = await get_service_manager_emails_for_location(
                        db=db,
                        organization_id=int(loc.organization_id),
                        location_id=int(loc.id),
                        group_key=str(loc.type),
                    )

                    if not emails:
                        logger.info(
                            "Negative feedback detected for submission_id=%s but no service_manager recipients found (org=%s loc=%s group=%s)",
                            sub.id,
                            loc.organization_id,
                            loc.id,
                            loc.type,
                        )
                    else:
                        # 3) Idempotency: send only once per submission
                        if getattr(sub, "negative_notified_at", None):
                            logger.info(
                                "Negative feedback already notified for submission_id=%s; skipping",
                                sub.id,
                            )
                        else:
                            org = (
                                await db.execute(
                                    select(Organization).where(Organization.id == loc.organization_id)
                                )
                            ).scalar_one_or_none()
                            org_name = (org.name if org else f"org#{loc.organization_id}")
                            loc_name = (loc.name or f"loc#{loc.id}")
                            when_iso = (
                                sub.created_at.isoformat()
                                if getattr(sub, "created_at", None)
                                else None
                            )
                            short_comment = extract_short_comment(answers=answers, schema=ver.schema)
                            link = build_admin_submission_link(sub.id)

                            subject, body = build_negative_email(
                                org_name=org_name,
                                loc_name=loc_name,
                                loc_code=getattr(loc, "code", None),
                                group_key=str(loc.type),
                                when_iso=when_iso,
                                score=int(score),
                                scale=int(scale),
                                short_comment=short_comment,
                                admin_link=link,
                            )

                            # Mark as notified BEFORE enqueueing (prevents double-send on any accidental re-entry)
                            try:
                                sub.negative_notified_at = datetime.now(timezone.utc)
                                sub.negative_notified_to = ",".join(emails)
                                await db.commit()
                                await db.refresh(sub)
                            except Exception:
                                # Do not break submit; if mark fails, we still try to send once
                                logger.exception("Failed to persist negative_notified_* (non-fatal)")

                            # enqueue emails
                            for to_email in emails:
                                background_tasks.add_task(send_email_text, to_email, subject, body)

                            if settings.DEBUG and not is_smtp_configured():
                                logger.warning(
                                    "[DEV] Negative feedback notification prepared (SMTP not configured). link=%s recipients=%s",
                                    link,
                                    ",".join(emails),
                                )
    except Exception:
        # must never break public submit
        logger.exception("Negative feedback notification failed (non-fatal)")

    return {"ok": True, "id": sub.id}
