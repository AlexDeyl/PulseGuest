from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class GroupSurveyBinding(Base):
    """Binding: (organization_id + group_key) -> active Survey/SurveyVersion.

    group_key is Location.type (room/restaurant/conference_hall/...)

    Submissions stay tied to a concrete location_id.
    This table only affects how we resolve the active survey version for a location.
    """

    __tablename__ = "group_survey_bindings"
    __table_args__ = (
        UniqueConstraint("organization_id", "group_key", name="uq_group_survey_binding_org_group"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    group_key: Mapped[str] = mapped_column(String(32), nullable=False)

    survey_id: Mapped[int] = mapped_column(
        ForeignKey("surveys.id", ondelete="CASCADE"),
        nullable=False,
    )

    active_version_id: Mapped[int] = mapped_column(
        ForeignKey("survey_versions.id", ondelete="CASCADE"),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
