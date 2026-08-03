"""Per-Shot zoom and position inside the finished Format."""

from alembic import op
import sqlalchemy as sa


revision = "0017_shot_framing"
down_revision = "0016_phrases"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shots", sa.Column("frame_zoom", sa.Float(), nullable=False, server_default="1.0")
    )
    op.add_column(
        "shots", sa.Column("frame_center_x", sa.Float(), nullable=False, server_default="50.0")
    )
    op.add_column(
        "shots", sa.Column("frame_center_y", sa.Float(), nullable=False, server_default="50.0")
    )


def downgrade() -> None:
    op.drop_column("shots", "frame_center_y")
    op.drop_column("shots", "frame_center_x")
    op.drop_column("shots", "frame_zoom")
