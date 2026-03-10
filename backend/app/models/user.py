from datetime import datetime
from sqlalchemy import String, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str | None] = mapped_column(String(200), index=True, nullable=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    roles = relationship("UserRole", back_populates="user", cascade="all,delete-orphan")

    # NEW: доступ к организациям (отелям)
    organizations_access = relationship(
        "UserOrganization",
        back_populates="user",
        cascade="all,delete-orphan",
    )

    # NEW: доступ к группам локаций (Location.type) внутри организации
    groups_access = relationship(
        "UserGroupAccess",
        back_populates="user",
        cascade="all,delete-orphan",
    )
