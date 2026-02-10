import asyncio
import app.models # noqa: F401
from datetime import datetime, timezone

from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.location import Location
from app.models.survey import Survey, SurveyVersion
from app.models.user import User
from app.models.token import UserRole
from app.models.role import Role
from app.models.user_organization import UserOrganization
from app.models.submission import Submission
from app.models.user_organization import UserOrganization


NOW = lambda: datetime.now(timezone.utc)


DEFAULTS = {
    "org": {"name": "Demo Hotel Group", "slug": "demo-hotel"},
    "location": {
        "name": "Main Hotel",
        "slug": "main",
        "type": "other",
        "code": "MAIN",
    },
    "survey": {"name": "Guest Feedback"},
    "users": {
        "director": {"email": "director@pulseguest.local", "password": "Admin123!"},
        "service_manager": {"email": "service@pulseguest.local", "password": "Admin123!"},
    },
}


SURVEY_SCHEMA_V1 = {
    "title": "Оцените ваш опыт",
    "slides": [
        {
            "id": "s1",
            "title": "Как вам у нас?",
            "type": "rating",
            "field": "rating_overall",
            "scale": 10,
            "required": True,
        },
        {
            "id": "s2",
            "title": "Что понравилось/что улучшить?",
            "type": "text",
            "field": "comment",
            "required": False,
            "maxLength": 800,
        },
        {
            "id": "s3",
            "title": "Контакт (если хотите)",
            "type": "contact",
            "fields": [
                {"field": "name", "type": "text", "required": False},
                {"field": "email", "type": "email", "required": False},
            ],
        },
    ],
    "meta": {
        "mvp": True,
        "version": 1,
    },
}

WIDGET_CONFIG_V1 = {
    "theme": "auto",  # auto/dark/light
    "brand": {
        "primary": "#6d28d9",
        "radius": 14,
    },
    "layout": {
        "card": True,
        "maxWidth": 520,
    },
    "texts": {
        "submit": "Отправить",
        "thanks": "Спасибо за ваш отзыв!",
    },
}


async def get_or_create_org(session: AsyncSession) -> Organization:
    q = select(Organization).where(Organization.slug == DEFAULTS["org"]["slug"])
    org = (await session.execute(q)).scalar_one_or_none()
    if org:
        return org

    org = Organization(
        name=DEFAULTS["org"]["name"],
        slug=DEFAULTS["org"]["slug"],
        created_at=NOW(),
    )
    session.add(org)
    await session.flush()
    return org


async def get_or_create_location(session: AsyncSession, org: Organization) -> Location:
    q = select(Location).where(
        Location.organization_id == org.id,
        Location.slug == DEFAULTS["location"]["slug"],
    )
    loc = (await session.execute(q)).scalar_one_or_none()
    if loc:
        return loc

    loc = Location(
        organization_id=org.id,
        name=DEFAULTS["location"]["name"],
        slug=DEFAULTS["location"]["slug"],
        type=DEFAULTS["location"]["type"],
        code=DEFAULTS["location"]["code"],
        is_active=True,
        created_at=NOW(),
    )
    session.add(loc)
    await session.flush()
    return loc


async def get_or_create_survey(session: AsyncSession, loc: Location) -> Survey:
    q = select(Survey).where(Survey.location_id == loc.id, Survey.name == DEFAULTS["survey"]["name"])
    survey = (await session.execute(q)).scalar_one_or_none()
    if survey:
        return survey

    survey = Survey(
        location_id=loc.id,
        name=DEFAULTS["survey"]["name"],
        created_at=NOW(),
    )
    session.add(survey)
    await session.flush()
    return survey


async def get_or_create_active_version(session: AsyncSession, survey: Survey) -> SurveyVersion:
    # Если уже есть active — вернем его
    q_active = select(SurveyVersion).where(SurveyVersion.survey_id == survey.id, SurveyVersion.is_active == True)  # noqa: E712
    active = (await session.execute(q_active)).scalar_one_or_none()
    if active:
        return active

    # Иначе — создаём v1, делаем active, и на всякий случай снимаем active с остальных
    await session.execute(
        update(SurveyVersion)
        .where(SurveyVersion.survey_id == survey.id)
        .values(is_active=False)
    )

    ver = SurveyVersion(
        survey_id=survey.id,
        version=1,
        is_active=True,
        schema=SURVEY_SCHEMA_V1,
        widget_config=WIDGET_CONFIG_V1,
        created_at=NOW(),
    )
    session.add(ver)
    await session.flush()
    return ver


async def get_or_create_user(session: AsyncSession, email: str, password: str) -> User:
    q = select(User).where(User.email == email)
    user = (await session.execute(q)).scalar_one_or_none()
    if user:
        return user

    user = User(
        email=email,
        password_hash=hash_password(password),
        is_active=True,
        created_at=NOW(),
    )
    session.add(user)
    await session.flush()
    return user


async def ensure_user_org_access(session: AsyncSession, user: User, org: Organization) -> None:
    q = select(UserOrganization).where(
        UserOrganization.user_id == user.id,
        UserOrganization.organization_id == org.id,
    )
    link = (await session.execute(q)).scalar_one_or_none()
    if link:
        if not link.is_active:
            link.is_active = True
            session.add(link)
        return

    session.add(
        UserOrganization(
            user_id=user.id,
            organization_id=org.id,
            is_active=True,
        )
    )


async def ensure_role(
    session: AsyncSession,
    user: User,
    role: Role,
    organization_id: int | None,
    location_id: int | None,
) -> None:
    q = select(UserRole).where(
        UserRole.user_id == user.id,
        UserRole.organization_id == organization_id,
        UserRole.location_id == location_id,
        UserRole.role == role.value,
    )
    exists = (await session.execute(q)).scalar_one_or_none()
    if exists:
        return

    session.add(
        UserRole(
            user_id=user.id,
            organization_id=organization_id,
            location_id=location_id,
            role=role.value,
        )
    )


async def ensure_user_org_access(session: AsyncSession, user: User, org: Organization) -> None:
    q = select(UserOrganization).where(
        UserOrganization.user_id == user.id,
        UserOrganization.organization_id == org.id,
    )
    link = (await session.execute(q)).scalar_one_or_none()
    if link:
        if not link.is_active:
            link.is_active = True
            session.add(link)
        return

    session.add(
        UserOrganization(
            user_id=user.id,
            organization_id=org.id,
            is_active=True,
        )
    )


async def ensure_demo_submissions(session: AsyncSession, loc: Location, ver: SurveyVersion) -> None:
    """
    Создаёт 3 демо submissions, если ещё не созданы.
    Идемпотентность через meta.contains({"seed": "demo-b2"}).
    """
    existing = (
        await session.execute(
            select(func.count(Submission.id)).where(
                Submission.location_id == loc.id,
                Submission.meta.contains({"seed": "demo-b2"}),
            )
        )
    ).scalar_one()

    if int(existing) >= 3:
        return

    samples = [
        {"rating_overall": 9, "comment": "Всё понравилось, спасибо!", "name": "Иван", "email": "ivan@example.com"},
        {"rating_overall": 6, "comment": "Норм, но можно быстрее на ресепшене", "name": "", "email": ""},
        {"rating_overall": 10, "comment": "Супер сервис!", "name": "Anna", "email": "anna@example.com"},
    ]

    # создаём недостающее количество до 3
    to_create = 3 - int(existing)
    for i in range(to_create):
        a = samples[i]
        session.add(
            Submission(
                survey_version_id=ver.id,
                location_id=loc.id,
                answers=a,
                meta={"seed": "demo-b2", "n": i + 1},
                created_at=NOW(),
            )
        )


async def main() -> None:
    async with AsyncSessionLocal() as session:
        async with session.begin():
            org = await get_or_create_org(session)
            loc = await get_or_create_location(session, org)
            survey = await get_or_create_survey(session, loc)
            ver = await get_or_create_active_version(session, survey)

            director_user = await get_or_create_user(
                session,
                DEFAULTS["users"]["director"]["email"],
                DEFAULTS["users"]["director"]["password"],
            )
            service_user = await get_or_create_user(
                session,
                DEFAULTS["users"]["service_manager"]["email"],
                DEFAULTS["users"]["service_manager"]["password"],
            )

            # director — глобальная роль (для доступа к админским операциям)
            await ensure_role(session, director_user, Role.director, organization_id=None, location_id=None)

            # service_manager — строго в рамках конкретной локации (как ты и требуешь)
            await ensure_role(session, service_user, Role.service_manager, organization_id=org.id, location_id=loc.id)

            # доступ service_manager к организации через user_organizations (иначе /admin/organizations будет пустой)
            await ensure_user_org_access(session, service_user, org)
            await ensure_demo_submissions(session, loc, ver)

        # После commit уже можно печатать
        print("✅ Seed complete:")
        print(f"   Organization: id={org.id} slug={org.slug}")
        print(f"   Location:     id={loc.id} slug={loc.slug}")
        print(f"   Survey:       id={survey.id} name={survey.name}")
        print(f"   Version:      id={ver.id} v={ver.version} active={ver.is_active}")
        print("   Users:")
        print(f"     director:        {DEFAULTS['users']['director']['email']} / {DEFAULTS['users']['director']['password']}")
        print(f"     service_manager: {DEFAULTS['users']['service_manager']['email']} / {DEFAULTS['users']['service_manager']['password']}")
        print("")
        print("➡️  Try in Swagger:")
        print(f"   GET /api/public/public/resolve/{loc.slug}")
        print(f"   GET /api/public/public/locations/{loc.id}/active-survey")


if __name__ == "__main__":
    asyncio.run(main())
