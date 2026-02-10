"""add org/location columns

Revision ID: f8aeccf02b77
Revises: 0001_init
Create Date: 2026-01-31 01:44:46.175236

"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f8aeccf02b77'
down_revision: Union[str, None] = '0001_init'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )

    op.add_column(
        "locations",
        sa.Column("type", sa.String(length=32), nullable=False, server_default="room"),
    )
    op.add_column(
        "locations",
        sa.Column("code", sa.String(length=64), nullable=False, server_default=""),
    )
    op.add_column(
        "locations",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )

    op.create_unique_constraint(
        "uq_location_org_slug",
        "locations",
        ["organization_id", "slug"],
    )
    op.create_index(
        "ix_locations_organization_id",
        "locations",
        ["organization_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_locations_organization_id", table_name="locations")
    op.drop_constraint("uq_location_org_slug", "locations", type_="unique")

    op.drop_column("locations", "is_active")
    op.drop_column("locations", "code")
    op.drop_column("locations", "type")

    op.drop_column("organizations", "is_active")
