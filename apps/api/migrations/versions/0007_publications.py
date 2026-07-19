"""Add persisted social publication attempts."""

from alembic import op
import sqlalchemy as sa


revision = "0007_publications"
down_revision = "0006_platform_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "publications",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("render_id", sa.String(), sa.ForeignKey("renders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.String(), sa.ForeignKey("platform_accounts.id", ondelete="SET NULL")),
        sa.Column("job_id", sa.String(), sa.ForeignKey("jobs.id", ondelete="SET NULL")),
        sa.Column("platform", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("caption", sa.Text(), nullable=False),
        sa.Column("share_to_feed", sa.Boolean(), nullable=False),
        sa.Column("remote_container_id", sa.String()),
        sa.Column("remote_media_id", sa.String()),
        sa.Column("permalink", sa.String()),
        sa.Column("error_message", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime()),
        sa.Column("completed_at", sa.DateTime()),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("render_id", "platform"),
    )
    op.create_index("ix_publications_render_id", "publications", ["render_id"])
    op.create_index("ix_publications_platform", "publications", ["platform"])
    op.create_index("ix_publications_status", "publications", ["status"])


def downgrade() -> None:
    op.drop_table("publications")
