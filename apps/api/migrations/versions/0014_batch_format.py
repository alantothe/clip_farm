"""A Batch carries the Format of the video its Sequence renders.

Every Batch that predates this rendered 1080x1920, so vertical is both the
default and the backfill (ADR 0006).
"""

from alembic import op
import sqlalchemy as sa


revision = "0014_batch_format"
down_revision = "0013_cutaways"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "batches",
        sa.Column("format", sa.String(), nullable=False, server_default="vertical"),
    )


def downgrade() -> None:
    op.drop_column("batches", "format")
