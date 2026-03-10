"""Add full_name to users

Revision ID: 20260223_full_name
Revises: 20260223
Create Date: 2026-02-23
"""

from alembic import op
import sqlalchemy as sa


revision = "20260223_full_name"
down_revision = "20260223"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("full_name", sa.String(length=200), nullable=True))
    op.create_index("ix_users_full_name", "users", ["full_name"])


def downgrade() -> None:
    op.drop_index("ix_users_full_name", table_name="users")
    op.drop_column("users", "full_name")
