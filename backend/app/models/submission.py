from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, String
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

    survey_version = relationship("SurveyVersion", back_populates="submissions")
