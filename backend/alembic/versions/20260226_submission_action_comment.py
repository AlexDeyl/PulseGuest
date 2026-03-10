"""Add service action comment fields to submissions

Revision ID: 20260226_submission_action_comment
Revises: 20260226_review_links_settings
Create Date: 2026-02-26
"""

from alembic import op
import sqlalchemy as sa


revision = "20260226_sub_action_comment"
down_revision = "20260226_review_links_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("submissions", sa.Column("service_action_comment", sa.Text(), nullable=True))
    op.add_column(
        "submissions",
        sa.Column("service_action_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "submissions",
        sa.Column("service_action_updated_by", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_submissions_service_action_updated_by_users",
        "submissions",
        "users",
        ["service_action_updated_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_submissions_service_action_updated_by",
        "submissions",
        ["service_action_updated_by"],
    )


def downgrade() -> None:
    op.drop_index("ix_submissions_service_action_updated_by", table_name="submissions")
    op.drop_constraint(
        "fk_submissions_service_action_updated_by_users",
        "submissions",
        type_="foreignkey",
    )
    op.drop_column("submissions", "service_action_updated_by")
    op.drop_column("submissions", "service_action_updated_at")
    op.drop_column("submissions", "service_action_comment")
