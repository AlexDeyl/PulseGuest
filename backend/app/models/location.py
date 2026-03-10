from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Boolean, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base


class Location(Base):
    """
    Location = конкретная точка в рамках Organization (отеля):
      - номер (room)
      - ресторан (restaurant)
      - конференц-зал (conference_hall)
      - банкетный зал (banquet_hall)
      - другое (other)

    slug = стабильный идентификатор для QR (НЕ меняется).
    """

    __tablename__ = "locations"
    __table_args__ = (
        UniqueConstraint("organization_id", "slug",
                         name="uq_location_org_slug"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="room",
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False,
                                            default=True)

    # JSON settings bucket for location-level configuration.
    # (PATCH B) stores review link override + inherit toggle.
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

    organization = relationship("Organization", back_populates="locations")
    surveys = relationship(
        "Survey",
        back_populates="location",
        cascade="all,delete-orphan",
    )

    def __str__(self) -> str:
        # Удобно для dropdown-ов в админке
        return f"{self.name} [{self.code}]"
