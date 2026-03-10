"""Submission negative notify hardening (negative_notified_at/to)

Revision ID: 20260226_neg_notify_h1
Revises: 20260226_sub_action_cmt
Create Date: 2026-02-26
"""

from alembic import op
import sqlalchemy as sa


revision = "20260226_neg_notify_h1"
down_revision = "20260226_sub_action_comment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "submissions",
        sa.Column("negative_notified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "submissions",
        sa.Column("negative_notified_to", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_submissions_negative_notified_at",
        "submissions",
        ["negative_notified_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_submissions_negative_notified_at", table_name="submissions")
    op.drop_column("submissions", "negative_notified_to")
    op.drop_column("submissions", "negative_notified_at")