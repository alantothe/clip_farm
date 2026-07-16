"""Add vertical caption placement presets."""

from alembic import op
import sqlalchemy as sa


revision = "0005_caption_position"
down_revision = "0004_social_captions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(
            sa.Column("caption_position", sa.String(), nullable=False, server_default="bottom")
        )
    with op.batch_alter_table("renders") as batch_op:
        batch_op.add_column(
            sa.Column("caption_position", sa.String(), nullable=False, server_default="bottom")
        )


def downgrade() -> None:
    with op.batch_alter_table("renders") as batch_op:
        batch_op.drop_column("caption_position")
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("caption_position")
