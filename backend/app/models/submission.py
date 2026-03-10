from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    survey_version_id: Mapped[int] = mapped_column(
        ForeignKey("survey_versions.id", ondelete="CASCADE")
    )
    location_id: Mapped[int] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE")
    )

    answers: Mapped[dict] = mapped_column(JSONB)
    meta: Mapped[dict] = mapped_column(
        JSONB
    )  # user-agent, utm, etc (IP можно отключить флагом)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    # PATCH C: комментарий сервис-менеджера / принятые меры
    service_action_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    service_action_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    service_action_updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    negative_notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    negative_notified_to: Mapped[str | None] = mapped_column(Text, nullable=True)

    survey_version = relationship("SurveyVersion", back_populates="submissions")
