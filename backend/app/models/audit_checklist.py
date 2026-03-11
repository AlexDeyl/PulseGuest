from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base


class ChecklistTemplate(Base):
    """Template (definition) of an audit checklist.

    Scope rules:
      - scope = "organization": can be used without location_id
      - scope = "location": requires location_id in a run
      - location_type: optional filter for location-based templates (matches Location.type)

    organization_id:
      - NULL -> global template
      - NOT NULL -> organization-scoped template
    """

    __tablename__ = "checklist_templates"

    id: Mapped[int] = mapped_column(primary_key=True)

    organization_id: Mapped[int | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    scope: Mapped[str] = mapped_column(String(32), nullable=False, default="organization")
    location_type: Mapped[str | None] = mapped_column(String(32), nullable=True)

    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

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

    organization = relationship("Organization")
    questions = relationship(
        "ChecklistQuestion",
        back_populates="template",
        cascade="all,delete-orphan",
        order_by="ChecklistQuestion.order",
    )

    def __str__(self) -> str:
        return f"{self.name} (v{self.version})"


class ChecklistQuestion(Base):
    """Question row for a checklist template."""

    __tablename__ = "checklist_questions"

    id: Mapped[int] = mapped_column(primary_key=True)

    template_id: Mapped[int] = mapped_column(
        ForeignKey("checklist_templates.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    section: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    text: Mapped[str] = mapped_column(Text, nullable=False)

    answer_type: Mapped[str] = mapped_column(String(32), nullable=False, default="yesno")
    options: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    allow_comment: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allow_photos: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    template = relationship("ChecklistTemplate", back_populates="questions")

    def __str__(self) -> str:
        return self.text


class ChecklistRun(Base):
    """A single checklist fill session (draft -> completed)."""
    __tablename__ = "checklist_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(
        ForeignKey("checklist_templates.id", ondelete="RESTRICT"), index=True, nullable=False,
    )
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False,
    )
    location_id: Mapped[int | None] = mapped_column(
        ForeignKey("locations.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    location_text: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    auditor_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False,
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    template = relationship("ChecklistTemplate")
    organization = relationship("Organization")
    location = relationship("Location")
    auditor = relationship("User")
    answers = relationship(
        "ChecklistAnswer",
        back_populates="run",
        cascade="all,delete-orphan",
    )
    attachments = relationship(
        "ChecklistAttachment",
        back_populates="run",
        cascade="all,delete-orphan",
    )

    def __str__(self) -> str:
        return f"Run #{self.id} [{self.status}]"


class ChecklistAnswer(Base):
    """Answer (autosaved). One row per (run, question)."""

    __tablename__ = "checklist_answers"
    __table_args__ = (
        UniqueConstraint("run_id", "question_id", name="uq_checklist_answer_run_question"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    run_id: Mapped[int] = mapped_column(
        ForeignKey("checklist_runs.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    question_id: Mapped[int] = mapped_column(
        ForeignKey("checklist_questions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    value: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    comment: Mapped[str] = mapped_column(Text, nullable=False, default="")

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

    run = relationship("ChecklistRun", back_populates="answers")
    question = relationship("ChecklistQuestion")


class ChecklistAttachment(Base):
    """File attachment (photo) linked to a specific question in a run."""

    __tablename__ = "checklist_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)

    run_id: Mapped[int] = mapped_column(
        ForeignKey("checklist_runs.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    question_id: Mapped[int] = mapped_column(
        ForeignKey("checklist_questions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    uploader_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )

    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    run = relationship("ChecklistRun", back_populates="attachments")
    question = relationship("ChecklistQuestion")
    uploader = relationship("User")
