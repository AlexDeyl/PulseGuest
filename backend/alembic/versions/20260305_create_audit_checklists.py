"""create audit checklists tables

Revision ID: 20260305
Revises: 20260213
Create Date: 2026-03-05

PATCH 2: minimal schema for auditor checklists (templates, runs, answers, attachments).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260305"
down_revision = "20260226_neg_notify_h1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "checklist_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("scope", sa.String(length=32), nullable=False, server_default=sa.text("'organization'")),
        sa.Column("location_type", sa.String(length=32), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "checklist_questions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "template_id",
            sa.Integer(),
            sa.ForeignKey("checklist_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("section", sa.String(length=255), nullable=False, server_default=sa.text("''")),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("answer_type", sa.String(length=32), nullable=False, server_default=sa.text("'yesno'")),
        sa.Column(
            "options",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("allow_comment", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("allow_photos", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )

    op.create_table(
        "checklist_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "template_id",
            sa.Integer(),
            sa.ForeignKey("checklist_templates.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "location_id",
            sa.Integer(),
            sa.ForeignKey("locations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "auditor_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "checklist_answers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "run_id",
            sa.Integer(),
            sa.ForeignKey("checklist_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "question_id",
            sa.Integer(),
            sa.ForeignKey("checklist_questions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "value",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("comment", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("run_id", "question_id", name="uq_checklist_answer_run_question"),
    )

    op.create_table(
        "checklist_attachments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "run_id",
            sa.Integer(),
            sa.ForeignKey("checklist_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "question_id",
            sa.Integer(),
            sa.ForeignKey("checklist_questions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "uploader_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False, server_default=sa.text("''")),
        sa.Column("file_path", sa.String(length=500), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    # indexes
    op.create_index("ix_checklist_templates_organization_id", "checklist_templates", ["organization_id"])
    op.create_index("ix_checklist_questions_template_id", "checklist_questions", ["template_id"])
    op.create_index("ix_checklist_runs_template_id", "checklist_runs", ["template_id"])
    op.create_index("ix_checklist_runs_organization_id", "checklist_runs", ["organization_id"])
    op.create_index("ix_checklist_runs_location_id", "checklist_runs", ["location_id"])
    op.create_index("ix_checklist_runs_auditor_user_id", "checklist_runs", ["auditor_user_id"])
    op.create_index("ix_checklist_answers_run_id", "checklist_answers", ["run_id"])
    op.create_index("ix_checklist_answers_question_id", "checklist_answers", ["question_id"])
    op.create_index("ix_checklist_attachments_run_id", "checklist_attachments", ["run_id"])
    op.create_index("ix_checklist_attachments_question_id", "checklist_attachments", ["question_id"])
    op.create_index("ix_checklist_attachments_uploader_user_id", "checklist_attachments", ["uploader_user_id"])


def downgrade() -> None:
    op.drop_index("ix_checklist_attachments_uploader_user_id", table_name="checklist_attachments")
    op.drop_index("ix_checklist_attachments_question_id", table_name="checklist_attachments")
    op.drop_index("ix_checklist_attachments_run_id", table_name="checklist_attachments")
    op.drop_index("ix_checklist_answers_question_id", table_name="checklist_answers")
    op.drop_index("ix_checklist_answers_run_id", table_name="checklist_answers")
    op.drop_index("ix_checklist_runs_auditor_user_id", table_name="checklist_runs")
    op.drop_index("ix_checklist_runs_location_id", table_name="checklist_runs")
    op.drop_index("ix_checklist_runs_organization_id", table_name="checklist_runs")
    op.drop_index("ix_checklist_runs_template_id", table_name="checklist_runs")
    op.drop_index("ix_checklist_questions_template_id", table_name="checklist_questions")
    op.drop_index("ix_checklist_templates_organization_id", table_name="checklist_templates")

    op.drop_table("checklist_attachments")
    op.drop_table("checklist_answers")
    op.drop_table("checklist_runs")
    op.drop_table("checklist_questions")
    op.drop_table("checklist_templates")
