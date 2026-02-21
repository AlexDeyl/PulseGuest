from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base


class Stay(Base):
    """Guest stay (imported from PMS export like Fidelio CSV).

    В рамках Patch 8.2.1 используем эту таблицу как "буфер" проживающих,
    чтобы позже (Patch 8.2.3) подхватывать данные гостя по room+датам.
    """

    __tablename__ = "stays"
    __table_args__ = (
        # reservation_code уникален в рамках локации (если заполнен).
        # В Postgres UNIQUE допускает несколько NULL, это ок.
        UniqueConstraint("location_id", "reservation_code", name="uq_stays_loc_reservation_code"),
        Index("ix_stays_location_room", "location_id", "room"),
        Index("ix_stays_location_checkin", "location_id", "checkin_at"),
        Index("ix_stays_location_checkout", "location_id", "checkout_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    location_id: Mapped[int] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    room: Mapped[str] = mapped_column(String(32), nullable=False)  # может быть 201A
    guest_name: Mapped[str] = mapped_column(String(255), nullable=False)

    checkin_at: Mapped[date] = mapped_column(Date, nullable=False)
    checkout_at: Mapped[date] = mapped_column(Date, nullable=False)

    reservation_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="csv")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    location = relationship("Location")
