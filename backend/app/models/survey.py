from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Integer, Boolean, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class Survey(Base):
    __tablename__ = "surveys"

    id: Mapped[int] = mapped_column(primary_key=True)
    location_id: Mapped[int | None] = mapped_column(
        ForeignKey("locations.id", ondelete="CASCADE"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(200))
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False,
                                              server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    location = relationship("Location", back_populates="surveys")
    versions = relationship(
        "SurveyVersion", back_populates="survey", cascade="all,delete-orphan"
    )


class SurveyVersion(Base):
    __tablename__ = "survey_versions"
    __table_args__ = (
        UniqueConstraint("survey_id", "version", name="uq_survey_version"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    survey_id: Mapped[int] = mapped_column(ForeignKey("surveys.id",
                                                      ondelete="CASCADE"))

    version: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)

    schema: Mapped[dict] = mapped_column(JSONB)  # анкета (вопросы/валидации)
    widget_config: Mapped[dict] = mapped_column(
        JSONB
    )  # цвета/шрифты/режимы/лейаут и т.п.

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    survey = relationship("Survey", back_populates="versions")
    submissions = relationship(
        "Submission", back_populates="survey_version",
        cascade="all,delete-orphan"
    )
