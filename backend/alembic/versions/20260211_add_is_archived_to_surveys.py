"""add is_archived to surveys

Revision ID: 20260211_add_is_archived_to_surveys
Revises: <PUT_YOUR_DOWN_REVISION_HERE>
Create Date: 2026-02-11
"""

from alembic import op
import sqlalchemy as sa

revision = "20260211"
down_revision = "2578175c2831"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "surveys",
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    # можно оставить server_default, но часто лучше убрать после миграции:
    op.alter_column("surveys", "is_archived", server_default=None)


def downgrade() -> None:
    op.drop_column("surveys", "is_archived")
