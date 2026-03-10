"""Group survey bindings + nullable surveys.location_id

Revision ID: 20260221
Revises: 20260213
Create Date: 2026-02-21
"""

from alembic import op
import sqlalchemy as sa


revision = "20260221"
down_revision = "20260213"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) allow surveys without a location (group-level surveys)
    op.alter_column(
        "surveys",
        "location_id",
        existing_type=sa.Integer(),
        nullable=True,
    )

    # 2) bindings: (org_id + group_key) -> survey_id + active_version_id
    op.create_table(
        "group_survey_bindings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("group_key", sa.String(length=32), nullable=False),
        sa.Column(
            "survey_id",
            sa.Integer(),
            sa.ForeignKey("surveys.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "active_version_id",
            sa.Integer(),
            sa.ForeignKey("survey_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "organization_id",
            "group_key",
            name="uq_group_survey_binding_org_group",
        ),
    )

    op.create_index(
        "ix_group_survey_bindings_org",
        "group_survey_bindings",
        ["organization_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_group_survey_bindings_org", table_name="group_survey_bindings")
    op.drop_table("group_survey_bindings")

    # NOTE: downgrade will fail if you created group-level surveys (location_id=NULL).
    op.alter_column(
        "surveys",
        "location_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
