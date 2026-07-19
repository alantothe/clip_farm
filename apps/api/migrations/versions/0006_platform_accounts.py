"""Add connected platform accounts."""

from alembic import op
import sqlalchemy as sa


revision = "0006_platform_accounts"
down_revision = "0005_caption_position"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_accounts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("platform", sa.String(), nullable=False),
        sa.Column("remote_user_id", sa.String(), nullable=False),
        sa.Column("username", sa.String(), nullable=False),
        sa.Column("display_name", sa.String()),
        sa.Column("access_token_encrypted", sa.Text(), nullable=False),
        sa.Column("scopes", sa.Text(), nullable=False),
        sa.Column("token_expires_at", sa.DateTime()),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("connected_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_platform_accounts_platform", "platform_accounts", ["platform"], unique=True)
    op.create_index("ix_platform_accounts_status", "platform_accounts", ["status"])


def downgrade() -> None:
    op.drop_table("platform_accounts")
