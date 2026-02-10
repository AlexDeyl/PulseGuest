"""create user_organizations

Revision ID: f87bc2cabb8f
Revises: fe1df37186d3
Create Date: 2026-01-31 20:09:38.954907

"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f87bc2cabb8f'
down_revision: Union[str, None] = 'fe1df37186d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_organizations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("user_id", "organization_id", name="uq_user_org"),
    )

    op.create_index("ix_user_org_user_id", "user_organizations", ["user_id"])
    op.create_index("ix_user_org_org_id", "user_organizations", ["organization_id"])


def downgrade() -> None:
    op.drop_index("ix_user_org_org_id", table_name="user_organizations")
    op.drop_index("ix_user_org_user_id", table_name="user_organizations")
    op.drop_table("user_organizations")
