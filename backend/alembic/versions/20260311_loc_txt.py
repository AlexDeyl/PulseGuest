"""add location_text to checklist_runs

Revision ID: 20260311_loc_txt
Revises: 20260305
Create Date: 2026-03-11 10:30:00

"""
from alembic import op
import sqlalchemy as sa

revision = "20260311_loc_txt"
down_revision = "add_location_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # column already exists in databases where previous local migration added it
    # keep this revision as a no-op to align alembic history
    pass


def downgrade() -> None:
    # no-op on purpose
    pass
