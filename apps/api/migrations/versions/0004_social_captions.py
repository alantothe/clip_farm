"""Store extracted and rewritten social captions."""

from alembic import op
import sqlalchemy as sa


revision = "0004_social_captions"
down_revision = "0003_overlay_transform"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(sa.Column("source_caption", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("social_caption", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("social_caption")
        batch_op.drop_column("source_caption")
