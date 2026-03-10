"""User group access (org + group_key)

Revision ID: 20260223
Revises: 20260221
Create Date: 2026-02-23
"""

from alembic import op
import sqlalchemy as sa


revision = "20260223"
down_revision = "20260221"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_group_access",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("group_key", sa.String(length=32), nullable=False),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.UniqueConstraint(
            "user_id",
            "organization_id",
            "group_key",
            name="uq_user_org_group",
        ),
    )

    op.create_index(
        "ix_user_group_access_user_id",
        "user_group_access",
        ["user_id"],
    )
    op.create_index(
        "ix_user_group_access_org_id",
        "user_group_access",
        ["organization_id"],
    )
    op.create_index(
        "ix_user_group_access_group_key",
        "user_group_access",
        ["group_key"],
    )

    # Backward-compat data migration:
    # - service_manager + location_id: derive group_key from locations.type
    # - service_manager org-wide (location_id NULL): grant all existing groups in that org
    bind = op.get_bind()

    bind.execute(sa.text("""
        INSERT INTO user_group_access (user_id, organization_id, group_key, is_active)
        SELECT DISTINCT
            ur.user_id,
            COALESCE(ur.organization_id, l.organization_id) AS organization_id,
            l.type AS group_key,
            true
        FROM user_roles ur
        JOIN locations l ON l.id = ur.location_id
        WHERE ur.role = 'service_manager'
        ON CONFLICT (user_id, organization_id, group_key) DO NOTHING;
    """))

    bind.execute(sa.text("""
        INSERT INTO user_group_access (user_id, organization_id, group_key, is_active)
        SELECT DISTINCT
            ur.user_id,
            ur.organization_id,
            l.type AS group_key,
            true
        FROM user_roles ur
        JOIN locations l ON l.organization_id = ur.organization_id
        WHERE ur.role = 'service_manager'
          AND ur.organization_id IS NOT NULL
          AND ur.location_id IS NULL
          AND l.is_active = true
        ON CONFLICT (user_id, organization_id, group_key) DO NOTHING;
    """))


def downgrade() -> None:
    op.drop_index("ix_user_group_access_group_key", table_name="user_group_access")
    op.drop_index("ix_user_group_access_org_id", table_name="user_group_access")
    op.drop_index("ix_user_group_access_user_id", table_name="user_group_access")
    op.drop_table("user_group_access")
