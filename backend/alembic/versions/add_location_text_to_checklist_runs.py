"""add location_text to checklist_runs

Revision ID: add_location_text_to_checklist_runs
Revises: <PASTE_PREVIOUS_REVISION_ID_HERE>
Create Date: 2026-03-11 02:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "add_location_text"
down_revision = "20260305"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "checklist_runs",
        sa.Column("location_text", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("checklist_runs", "location_text")