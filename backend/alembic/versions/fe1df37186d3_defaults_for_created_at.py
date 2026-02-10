"""defaults for created_at

Revision ID: fe1df37186d3
Revises: f8aeccf02b77
Create Date: 2026-01-31 02:10:09.740313

"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'fe1df37186d3'
down_revision: Union[str, None] = 'f8aeccf02b77'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE organizations ALTER COLUMN created_at SET DEFAULT now();")
    op.execute("ALTER TABLE locations ALTER COLUMN created_at SET DEFAULT now();")
    op.execute("ALTER TABLE users ALTER COLUMN created_at SET DEFAULT now();")

    op.execute("ALTER TABLE surveys ALTER COLUMN created_at SET DEFAULT now();")
    op.execute("ALTER TABLE survey_versions ALTER COLUMN created_at SET DEFAULT now();")
    op.execute("ALTER TABLE submissions ALTER COLUMN created_at SET DEFAULT now();")
    op.execute("ALTER TABLE refresh_tokens ALTER COLUMN created_at SET DEFAULT now();")


def downgrade() -> None:
    op.execute("ALTER TABLE refresh_tokens ALTER COLUMN created_at DROP DEFAULT;")
    op.execute("ALTER TABLE submissions ALTER COLUMN created_at DROP DEFAULT;")
    op.execute("ALTER TABLE survey_versions ALTER COLUMN created_at DROP DEFAULT;")
    op.execute("ALTER TABLE surveys ALTER COLUMN created_at DROP DEFAULT;")

    op.execute("ALTER TABLE users ALTER COLUMN created_at DROP DEFAULT;")
    op.execute("ALTER TABLE locations ALTER COLUMN created_at DROP DEFAULT;")
    op.execute("ALTER TABLE organizations ALTER COLUMN created_at DROP DEFAULT;")