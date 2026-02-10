"""unique slugs for organizations and locations

Revision ID: 2578175c2831
Revises: f87bc2cabb8f
Create Date: 2026-02-10 00:21:53.921699

"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '2578175c2831'
down_revision: Union[str, None] = 'f87bc2cabb8f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Organization.slug unique (глобально)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_organizations_slug ON organizations (slug)")

    # Location.slug unique (глобально)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_locations_slug ON locations (slug)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_locations_slug")
    op.execute("DROP INDEX IF EXISTS ux_organizations_slug")
