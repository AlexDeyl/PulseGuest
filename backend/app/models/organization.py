from datetime import datetime

from sqlalchemy import String, DateTime, Boolean, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base


class Organization(Base):
    """
    Organization = верхний уровень (в MVP это 'отель').
    Можно деактивировать, чтобы исключить из системы без потери истории.
    """

    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(primary_key=True)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True,
                                      index=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False,
                                            default=True)

    # JSON settings bucket for organization-level configuration.
    # (PATCH B) stores default review links by group_key.
    settings: Mapped[dict] = mapped_column(
        MutableDict.as_mutable(JSONB),
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    locations = relationship(
        "Location",
        back_populates="organization",
        cascade="all,delete-orphan",
    )

    def __str__(self) -> str:
        return self.name
