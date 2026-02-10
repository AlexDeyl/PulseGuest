from __future__ import annotations

import json

from fastapi import Request
from sqladmin import Admin, ModelView
from starlette.responses import RedirectResponse
from wtforms import PasswordField, SelectField, TextAreaField

from app.core.security import hash_password
from app.db.session import engine
from app.models.organization import Organization
from app.models.location import Location
from app.models.user import User
from app.models.token import UserRole
from app.models.user_organization import UserOrganization
from app.models.survey import Survey, SurveyVersion
from app.models.submission import Submission


# --- Русские подписи/варианты ------

LOCATION_TYPE_CHOICES = [
    ("room", "Номер"),
    ("restaurant", "Ресторан"),
    ("conference_hall", "Конференц-зал"),
    ("banquet_hall", "Банкетный зал"),
    ("other", "Другое"),
]

ROLE_LABELS = {
    "employee": "Сотрудник",
    "manager": "Менеджер",
    "service_manager": "Сервис-менеджер (локации)",
    "director": "Директор",
    "auditor_global": "Аудитор (глобальный)",
    "auditor": "Аудитор",
}


class ProtectedAdmin(Admin):
    async def authenticate(self, request: Request) -> bool:
        return request.cookies.get("pg_admin") == "1"


class OrganizationAdmin(ModelView, model=Organization):
    # Метаданные/меню
    name = "Организация"
    name_plural = "Организации"
    icon = "ti ti-building"
    category = "Справочники"
    category_icon = "ti ti-book"

    # Таблица списка
    column_list = [
        Organization.id,
        Organization.name,
        Organization.slug,
        Organization.is_active,
        Organization.created_at,
    ]
    column_searchable_list = [Organization.name, Organization.slug]
    column_sortable_list = [Organization.id, Organization.name, Organization.created_at]

    # Русские заголовки колонок/полей
    column_labels = {
        "id": "ID",
        "name": "Название",
        "slug": "Slug",
        "is_active": "Активна",
        "created_at": "Создана",
    }
    form_args = {
        "name": {"label": "Название"},
        "slug": {"label": "Slug"},
        "is_active": {"label": "Активна"},
    }


class LocationAdmin(ModelView, model=Location):
    name = "Локация"
    name_plural = "Локации"
    icon = "ti ti-map-pin"
    category = "Справочники"
    category_icon = "ti ti-book"

    column_list = [
        Location.id,
        Location.organization_id,
        Location.name,
        Location.code,
        Location.slug,
        Location.type,
        Location.is_active,
        Location.created_at,
    ]
    column_searchable_list = [Location.name, Location.code, Location.slug]
    column_sortable_list = [Location.id, Location.organization_id, Location.name, Location.created_at]

    column_labels = {
        "id": "ID",
        "organization_id": "Организация",
        "name": "Название",
        "code": "Код",
        "slug": "Slug",
        "type": "Тип",
        "is_active": "Активна",
        "created_at": "Создана",
    }

    # Для type делаем выпадающий список
    form_overrides = {"type": SelectField}
    form_args = {
        "organization_id": {"label": "Организация"},
        "name": {"label": "Название"},
        "code": {"label": "Код"},
        "slug": {"label": "Slug"},
        "type": {"label": "Тип", "choices": LOCATION_TYPE_CHOICES},
        "is_active": {"label": "Активна"},
    }

    # Показываем русский тип в таблице (вместо raw-кода)
    def _fmt_location_type(model: Location, attr: str):
        mapping = dict(LOCATION_TYPE_CHOICES)
        value = getattr(model, attr)
        return mapping.get(value, value)

    column_formatters = {Location.type: _fmt_location_type}


class UserAdmin(ModelView, model=User):
    name = "Пользователь"
    name_plural = "Пользователи"
    icon = "ti ti-user"
    category = "Пользователи"
    category_icon = "ti ti-users"

    column_list = [User.id, User.email, User.is_active, User.created_at]
    column_searchable_list = [User.email]
    column_sortable_list = [User.id, User.email, User.created_at]

    column_labels = {
        "id": "ID",
        "email": "Email",
        "is_active": "Активен",
        "created_at": "Создан",
        "password_hash": "Пароль",
    }

    # Показываем password_hash как пароль (вводится обычный пароль, но в БД хранится хэш)
    form_overrides = {"password_hash": PasswordField}
    form_args = {
        "email": {"label": "Email"},
        "password_hash": {"label": "Пароль"},
        "is_active": {"label": "Активен"},
    }

    # На create показываем пароль, на edit — НЕ показываем
    form_create_rules = ["email", "password_hash", "is_active"]
    form_edit_rules = ["email", "is_active"]

    async def on_model_change(self, data, model, is_created, request):
        """
        На создании: требуем пароль и хэшируем.
        На редактировании: пароля нет (мы его скрыли), поэтому ничего не делаем.
        """
        if is_created:
            raw_pwd = data.get("password_hash")
            if not raw_pwd:
                raise ValueError("Пароль обязателен")
            model.password_hash = hash_password(raw_pwd)


class UserRoleAdmin(ModelView, model=UserRole):
    name = "Роль доступа"
    name_plural = "Роли доступа"
    icon = "ti ti-shield-lock"
    category = "Пользователи"
    category_icon = "ti ti-users"

    column_list = [
        UserRole.id,
        UserRole.user_id,
        UserRole.organization_id,
        UserRole.location_id,
        UserRole.role,
    ]
    column_sortable_list = [UserRole.id, UserRole.user_id, UserRole.organization_id, UserRole.location_id]
    column_searchable_list = [UserRole.role]

    column_labels = {
        "id": "ID",
        "user_id": "Пользователь",
        "organization_id": "Организация",
        "location_id": "Локация",
        "role": "Роль",
    }

    # Роль — выпадающий список с русскими названиями
    form_overrides = {"role": SelectField}
    form_args = {
        "user_id": {"label": "Пользователь"},
        "organization_id": {"label": "Организация"},
        "location_id": {"label": "Локация"},
        "role": {"label": "Роль", "choices": [(k, v) for k, v in ROLE_LABELS.items()]},
    }

    def _fmt_role(model: UserRole, attr: str):
        value = getattr(model, attr)
        return ROLE_LABELS.get(value, value)

    column_formatters = {UserRole.role: _fmt_role}


def init_admin(app) -> Admin:
    admin = ProtectedAdmin(app, engine, base_url="/admin", title="PulseGuest — админка")
    admin.add_view(OrganizationAdmin)
    admin.add_view(LocationAdmin)
    admin.add_view(UserAdmin)
    admin.add_view(UserRoleAdmin)
    admin.add_view(UserOrganizationAdmin)
    admin.add_view(SurveyAdmin)
    admin.add_view(SurveyVersionAdmin)
    admin.add_view(SubmissionAdmin)

    return admin


def init_demo_admin_login(app):
    @app.get("/admin-login")
    async def admin_login():
        resp = RedirectResponse(url="/admin", status_code=302)
        resp.set_cookie("pg_admin", "1", httponly=True)
        return resp

    @app.get("/admin-logout")
    async def admin_logout():
        resp = RedirectResponse(url="/", status_code=302)
        resp.delete_cookie("pg_admin")
        return resp


class UserOrganizationAdmin(ModelView, model=UserOrganization):
    name = "Связь пользователь—организация"
    name_plural = "Связи пользователь—организация"
    icon = "ti ti-link"
    category = "Пользователи"
    category_icon = "ti ti-users"

    column_list = [UserOrganization.id, UserOrganization.user_id,
                   UserOrganization.organization_id]
    column_sortable_list = [UserOrganization.id, UserOrganization.user_id,
                            UserOrganization.organization_id]

    column_labels = {
        "id": "ID",
        "user_id": "Пользователь",
        "organization_id": "Организация",
    }
    form_args = {
        "user_id": {"label": "Пользователь"},
        "organization_id": {"label": "Организация"},
    }


class SurveyAdmin(ModelView, model=Survey):
    name = "Опрос"
    name_plural = "Опросы"
    icon = "ti ti-forms"
    category = "Опросы"
    category_icon = "ti ti-clipboard"

    column_list = [Survey.id, Survey.location_id, Survey.name, Survey.created_at]
    column_searchable_list = [Survey.name]
    column_sortable_list = [Survey.id, Survey.location_id, Survey.created_at]

    column_labels = {
        "id": "ID",
        "location_id": "Локация",
        "name": "Название",
        "created_at": "Создан",
    }
    form_args = {
        "location_id": {"label": "Локация"},
        "name": {"label": "Название"},
    }


class SurveyVersionAdmin(ModelView, model=SurveyVersion):
    name = "Версия опроса"
    name_plural = "Версии опросов"
    icon = "ti ti-versions"
    category = "Опросы"
    category_icon = "ti ti-clipboard"

    column_list = [SurveyVersion.id, SurveyVersion.survey_id, SurveyVersion.version, SurveyVersion.is_active, SurveyVersion.created_at]
    column_sortable_list = [SurveyVersion.id, SurveyVersion.survey_id, SurveyVersion.version, SurveyVersion.created_at]

    column_labels = {
        "id": "ID",
        "survey_id": "Опрос",
        "version": "Версия",
        "is_active": "Активна",
        "schema": "Схема (JSON)",
        "widget_config": "Конфиг (JSON)",
        "created_at": "Создана",
    }

    form_overrides = {
        "schema": TextAreaField,
        "widget_config": TextAreaField,
    }
    form_args = {
        "survey_id": {"label": "Опрос"},
        "version": {"label": "Версия"},
        "is_active": {"label": "Активна"},
        "schema": {"label": "Схема (JSON)"},
        "widget_config": {"label": "Конфиг (JSON)"},
    }

    async def on_model_change(self, data, model, is_created, request):
        for key in ("schema", "widget_config"):
            val = data.get(key)
            if isinstance(val, str):
                raw = val.strip()
                if raw == "":
                    setattr(model, key, None)
                    continue
                try:
                    setattr(model, key, json.loads(raw))
                except json.JSONDecodeError as e:
                    raise ValueError(f"Поле {key}: некорректный JSON ({e})")


class SubmissionAdmin(ModelView, model=Submission):
    name = "Ответ гостя"
    name_plural = "Ответы гостей"
    icon = "ti ti-message"
    category = "Опросы"
    category_icon = "ti ti-clipboard"

    column_list = [Submission.id, Submission.location_id, Submission.survey_version_id, Submission.created_at]
    column_sortable_list = [Submission.id, Submission.location_id, Submission.created_at]

    column_labels = {
        "id": "ID",
        "location_id": "Локация",
        "survey_version_id": "Версия опроса",
        "answers": "Ответы (JSON)",
        "meta": "Мета (JSON)",
        "created_at": "Создан",
    }

    # ответы не редактируем в MVP
    can_create = False
    can_edit = False
    can_delete = False
