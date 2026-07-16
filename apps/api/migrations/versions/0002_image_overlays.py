"""Add timed image overlays."""

from alembic import op
import sqlalchemy as sa


revision = "0002_image_overlays"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "image_overlays",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("artifact_id", sa.String(), sa.ForeignKey("artifacts.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("start_ms", sa.Integer(), nullable=False),
        sa.Column("end_ms", sa.Integer(), nullable=False),
        sa.Column("center_x", sa.Float(), nullable=False),
        sa.Column("center_y", sa.Float(), nullable=False),
        sa.Column("width_percent", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("image_overlays")
