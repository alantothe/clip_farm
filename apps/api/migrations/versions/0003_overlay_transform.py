"""Add image overlay rotation and opacity."""

from alembic import op
import sqlalchemy as sa


revision = "0003_overlay_transform"
down_revision = "0002_image_overlays"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("image_overlays") as batch_op:
        batch_op.add_column(sa.Column("rotation_deg", sa.Float(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("opacity", sa.Float(), nullable=False, server_default="1"))


def downgrade() -> None:
    with op.batch_alter_table("image_overlays") as batch_op:
        batch_op.drop_column("opacity")
        batch_op.drop_column("rotation_deg")
