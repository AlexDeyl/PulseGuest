from datetime import datetime

from sqlalchemy import String, DateTime, Boolean
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
