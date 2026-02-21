from __future__ import annotations

from datetime import datetime, timezone, date
import re
import csv
import io
import itertools

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.api.v1.deps import get_db, get_current_user, get_allowed_location_ids
from app.services.rbac import require_roles
from app.models.role import Role
from app.models.user import User
from app.models.stay import Stay
from app.models.location import Location

router = APIRouter(tags=["admin"])


def _decode_csv_bytes(data: bytes) -> tuple[str, str]:
    for enc in ("utf-8-sig", "utf-8"):
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            pass
    try:
        return data.decode("cp1251"), "cp1251"
    except Exception:
        return data.decode("latin-1", errors="replace"), "latin-1"


def _detect_delimiter(sample: str) -> str:
    sample = sample or ""
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";\t,|")
        return dialect.delimiter
    except Exception:
        first = sample.splitlines()[0] if sample.splitlines() else sample
        cands = [";", ",", "\t", "|"]
        return max(cands, key=lambda d: first.count(d))


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

    Returns keys: room, guest_name, checkin, checkout, reservation_code, guest_last/first/middle
    """
    norm_to_raw = {_norm_header(h): h for h in headers}
    keys = set(norm_to_raw.keys())

    def pick(cands: set[str]) -> str | None:
        for c in cands:
            if c in keys:
                return norm_to_raw[c]
        return None

    room = pick(
        {
            "room",
            "room_no",
            "roomno",
            "rm",
            "rm_no",
            "roomnumber",
            "номер",
            "номеркомнаты",
            "комната",
            "номер_комнаты",
        }
    )

    checkin = pick(
        {
            "checkin",
            "arrival",
            "arrival_date",
            "arrive",
            "datein",
            "дата_заезда",
            "заезд",
        }
    )

    checkout = pick(
        {
            "checkout",
            "departure",
            "departure_date",
            "depart",
            "dateout",
            "дата_выезда",
            "выезд",
        }
    )

    reservation_code = pick(
        {
            "reservation_code",
            "reservation",
            "res",
            "resno",
            "booking",
            "booking_id",
            "confirmation",
            "confirmation_no",
            "conf_no",
            "confno",
            "folio",
            "folio_no",
            "код_брони",
            "номер_брони",
            "бронь",
        }
    )

    guest_name = pick(
        {
            "guest_name",
            "guest",
            "name",
            "fullname",
            "fio",
            "фио",
            "гость",
            "клиент",
            "guestfullname",
            "guestname",
            "profile_name",
            "profile",
        }
    )

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


def _norm_room_value(v: str) -> str:
    s = (v or "").strip().upper()
    s = re.sub(r"\s+", "", s)
    if not s:
        return ""
    # "0203" -> "203"
    if s.isdigit():
        try:
            return str(int(s))
        except Exception:
            return s.lstrip("0") or s
    # "203.0" -> "203.0" (дальше вытащим число)
    s = s.replace(",", ".")
    return s


def _extract_room_token(v: str) -> str:
    s = _norm_room_value(v)
    if not s:
        return ""
    # берем самое "похожее на номер": 203, 203A, 12B и т.п.
    m = re.search(r"\d{1,5}[A-Z]?", s)
    if m:
        tok = m.group(0)
        # "000203" уже обработали, но на всякий случай:
        if tok.isdigit():
            try:
                tok = str(int(tok))
            except Exception:
                tok = tok.lstrip("0") or tok
        return tok
    return s


def _room_keys_for_location(loc: Location) -> set[str]:
    keys: set[str] = set()

    for v in (loc.code, loc.name, loc.slug):
        if not v:
            continue
        s = _norm_room_value(str(v))
        if s:
            keys.add(s)
        tok = _extract_room_token(str(v))
        if tok:
            keys.add(tok)

        # ещё: если slug типа demo-hotel-203, добавим "203"
        for m in re.findall(r"\d{1,5}[A-Z]?", str(v).upper()):
            mm = m
            if mm.isdigit():
                try:
                    mm = str(int(mm))
                except Exception:
                    mm = mm.lstrip("0") or mm
            keys.add(mm)

    # уберём пустое
    keys.discard("")
    return keys


async def _get_accessible_locations_in_org(
    db: AsyncSession, user: User, org_id: int
) -> list[Location]:
    allowed_loc_ids = await get_allowed_location_ids(db=db, user=user)
    locs = (
        await db.execute(
            select(Location)
            .where(Location.organization_id == org_id, Location.is_active == True)  # noqa: E712
            .order_by(Location.id.asc())
        )
    ).scalars().all()

    # ограничим доступ
    accessible = [l for l in locs if l.id in set(allowed_loc_ids)]
    return accessible


# -----------------------------
# ORG-LEVEL: list stays (one list for whole org)
# -----------------------------
@router.get("/organizations/{org_id}/stays")
async def list_org_stays(
    org_id: int,
    room: str | None = None,
    q: str | None = None,
    on: date | None = None,
    location_id: int | None = Query(None, description="Optional filter by location"),
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.director, Role.auditor_global, Role.auditor, Role.manager, Role.service_manager)),
):
    accessible_locs = await _get_accessible_locations_in_org(db=db, user=user, org_id=org_id)
    if not accessible_locs:
        raise HTTPException(status_code=403, detail="No access to this organization")

    accessible_ids = [l.id for l in accessible_locs]

    if location_id is not None and location_id not in set(accessible_ids):
        raise HTTPException(status_code=403, detail="No access to this location")

    where = [
        Stay.location_id.in_(accessible_ids),
    ]
    if location_id is not None:
        where.append(Stay.location_id == location_id)
    if room:
        where.append(Stay.room == room.strip())
    if q:
        where.append(func.lower(Stay.guest_name).like(f"%{q.strip().lower()}%"))
    if on:
        where.append(Stay.checkin_at <= on)
        where.append(Stay.checkout_at >= on)

    total = (
        await db.execute(
            select(func.count(Stay.id))
            .select_from(Stay)
            .where(*where)
        )
    ).scalar_one()

    rows = (
        await db.execute(
            select(Stay, Location)
            .join(Location, Location.id == Stay.location_id)
            .where(*where)
            .order_by(Stay.checkin_at.desc(), Stay.room.asc(), Stay.id.desc())
            .offset(max(int(offset), 0))
            .limit(min(max(int(limit), 1), 200))
        )
    ).all()

    items = []
    for s, loc in rows:
        items.append(
            {
                "id": s.id,
                "organization_id": org_id,
                "location_id": s.location_id,
                "location_name": loc.name,
                "location_slug": loc.slug,
                "location_code": loc.code,
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


# -----------------------------
# ORG-LEVEL: import stays (auto-route room -> location)
# -----------------------------
@router.post("/organizations/{org_id}/stays/import")
async def import_org_stays_csv(
    org_id: int,
    file: UploadFile = File(...),
    source: str = Query("csv", max_length=40),
    max_rows: int = Query(20000, ge=1, le=50000),
    skip_unknown_rooms: bool = Query(True, description="Skip rows if room can't be mapped to a location"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _=Depends(require_roles(Role.director, Role.manager, Role.service_manager)),
):
    accessible_locs = await _get_accessible_locations_in_org(db=db, user=user, org_id=org_id)
    if not accessible_locs:
        raise HTTPException(status_code=403, detail="No access to this organization")

    # room -> location_id map (по code/name/slug и цифрам)
    room_map: dict[str, int] = {}
    for loc in accessible_locs:
        for k in _room_keys_for_location(loc):
            # если конфликт — оставим первое (обычно корректно), конфликт можно будет ловить позже
            room_map.setdefault(k, loc.id)

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
    unknown_rooms = 0
    errors: list[dict] = []

    if looks_like_header:
        headers = [c.strip() for c in first_row]
        field_map = _build_stay_field_map(headers)
        reader_iter = csv.DictReader(buf, fieldnames=headers, delimiter=delimiter)
    else:
        reader_iter = itertools.chain([first_row], reader)
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

    async def upsert_one(target_location_id: int, room_v: str, guest_v: str, ci: date, co: date, res_code: str | None):
        nonlocal inserted, updated
        code = (res_code or "").strip() or None

        existing = None
        if code:
            existing = (
                await db.execute(
                    select(Stay).where(Stay.location_id == target_location_id, Stay.reservation_code == code)
                )
            ).scalar_one_or_none()
        else:
            existing = (
                await db.execute(
                    select(Stay).where(
                        Stay.location_id == target_location_id,
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
                    location_id=target_location_id,
                    room=room_v,
                    guest_name=guest_v,
                    checkin_at=ci,
                    checkout_at=co,
                    reservation_code=code,
                    source=source,
                )
            )
            inserted += 1

    row_idx = 1

    def resolve_location_id_by_room(room_raw: str) -> int | None:
        rr = _extract_room_token(room_raw)
        if not rr:
            return None
        # попробуем по токену (203) и по нормализованной строке
        cand1 = rr
        cand2 = _norm_room_value(room_raw)
        return room_map.get(cand1) or room_map.get(cand2)

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

                target_loc_id = resolve_location_id_by_room(room_v)
                if target_loc_id is None:
                    unknown_rooms += 1
                    if skip_unknown_rooms:
                        skipped += 1
                        continue
                    raise ValueError(f"Unknown room '{room_v}' (no matching location in org)")

                ci = _parse_date_any(ci_s)
                co = _parse_date_any(co_s)
                if ci is None or co is None:
                    raise ValueError(f"Bad dates: checkin='{ci_s}', checkout='{co_s}'")
                if co < ci:
                    raise ValueError("checkout < checkin")

                await upsert_one(target_loc_id, _extract_room_token(room_v) or room_v.strip(), guest_v, ci, co, res_code)
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

                target_loc_id = resolve_location_id_by_room(room_v)
                if target_loc_id is None:
                    unknown_rooms += 1
                    if skip_unknown_rooms:
                        skipped += 1
                        continue
                    raise ValueError(f"Unknown room '{room_v}' (no matching location in org)")

                ci = _parse_date_any(ci_s)
                co = _parse_date_any(co_s)
                if ci is None or co is None:
                    raise ValueError(f"Bad dates: checkin='{ci_s}', checkout='{co_s}'")
                if co < ci:
                    raise ValueError("checkout < checkin")

                await upsert_one(target_loc_id, _extract_room_token(room_v) or room_v.strip(), guest_v, ci, co, res_code)
            except Exception as e:
                errors.append({"row": row_idx, "error": str(e)})

    await db.commit()

    return {
        "ok": True,
        "organization_id": org_id,
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
        "unknown_rooms": unknown_rooms,
        "errors": errors[:200],
        "encoding": encoding,
        "delimiter": delimiter,
        "has_header": bool(looks_like_header),
        "max_rows": max_rows,
        "skip_unknown_rooms": bool(skip_unknown_rooms),
    }


# -----------------------------
# LOCATION-LEVEL endpoints (оставляем как есть)
# -----------------------------
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
        where.append(Stay.checkout_at >= on)

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
        reader_iter = csv.DictReader(buf, fieldnames=headers, delimiter=delimiter)
    else:
        reader_iter = itertools.chain([first_row], reader)
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

    row_idx = 1

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

                await upsert_one(_extract_room_token(room_v) or room_v.strip(), guest_v, ci, co, res_code)
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

                await upsert_one(_extract_room_token(room_v) or room_v.strip(), guest_v, ci, co, res_code)
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
            where.append(Stay.checkout_at >= on)

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

    data = ("\ufeff" + output.getvalue()).encode("utf-8")
    filename = f"stays_location_{location_id}.csv" if not template else "stays_template.csv"

    return Response(
        content=data,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\""},
    )
