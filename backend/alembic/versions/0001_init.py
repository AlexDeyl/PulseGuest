from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_organizations_slug", "organizations",
                    ["slug"], unique=True)

    op.create_table(
        "locations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_locations_slug", "locations", ["slug"])

    op.create_table(
        "surveys",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "location_id",
            sa.Integer(),
            sa.ForeignKey("locations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "survey_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "survey_id",
            sa.Integer(),
            sa.ForeignKey("surveys.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False,
            server_default=sa.text("false")
        ),
        sa.Column("schema", postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False),
        sa.Column(
            "widget_config", postgresql.JSONB(astext_type=sa.Text()),
            nullable=False
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("survey_id", "version", name="uq_survey_version"),
    )

    op.create_table(
        "submissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "survey_version_id",
            sa.Integer(),
            sa.ForeignKey("survey_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "location_id",
            sa.Integer(),
            sa.ForeignKey("locations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("answers", postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False,
            server_default=sa.text("true")
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "user_roles",
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
            nullable=True,
        ),
        sa.Column(
            "location_id",
            sa.Integer(),
            sa.ForeignKey("locations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("role", sa.String(length=40), nullable=False),
        sa.UniqueConstraint(
            "user_id",
            "organization_id",
            "location_id",
            "role",
            name="uq_user_scope_role",
        ),
    )

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("jti", sa.String(length=64), nullable=False),
        sa.Column("token_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "is_revoked", sa.Boolean(), nullable=False,
            server_default=sa.text("false")
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("jti", name="uq_refresh_jti"),
    )


def downgrade() -> None:
    op.drop_table("refresh_tokens")
    op.drop_table("user_roles")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
    op.drop_table("submissions")
    op.drop_table("survey_versions")
    op.drop_table("surveys")
    op.drop_index("ix_locations_slug", table_name="locations")
    op.drop_table("locations")
    op.drop_index("ix_organizations_slug", table_name="organizations")
    op.drop_table("organizations")
