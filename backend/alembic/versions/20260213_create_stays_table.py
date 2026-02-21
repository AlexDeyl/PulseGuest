"""create stays table

Revision ID: 20260213
Revises: 20260211
Create Date: 2026-02-13

Patch 8.2.1: buffer table for guest stays imported from PMS exports.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260213"
down_revision = "20260211"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stays",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "location_id",
            sa.Integer(),
            sa.ForeignKey("locations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("room", sa.String(length=32), nullable=False),
        sa.Column("guest_name", sa.String(length=255), nullable=False),
        sa.Column("checkin_at", sa.Date(), nullable=False),
        sa.Column("checkout_at", sa.Date(), nullable=False),
        sa.Column("reservation_code", sa.String(length=80), nullable=True),
        sa.Column("source", sa.String(length=40), nullable=False, server_default=sa.text("'csv'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("location_id", "reservation_code", name="uq_stays_loc_reservation_code"),
    )

    op.create_index("ix_stays_location_id", "stays", ["location_id"], unique=False)
    op.create_index("ix_stays_location_room", "stays", ["location_id", "room"], unique=False)
    op.create_index("ix_stays_location_checkin", "stays", ["location_id", "checkin_at"], unique=False)
    op.create_index("ix_stays_location_checkout", "stays", ["location_id", "checkout_at"], unique=False)

    # убираем server_default, чтобы дальше работали model defaults
    op.alter_column("stays", "source", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_stays_location_checkout", table_name="stays")
    op.drop_index("ix_stays_location_checkin", table_name="stays")
    op.drop_index("ix_stays_location_room", table_name="stays")
    op.drop_index("ix_stays_location_id", table_name="stays")
    op.drop_table("stays")
