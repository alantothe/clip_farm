"""A Cutaway covers a Shot: a Shot with a parent and an offset into it."""

from alembic import op
import sqlalchemy as sa


revision = "0013_cutaways"
down_revision = "0012_shot_trim"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shots",
        sa.Column("parent_shot_id", sa.String(), sa.ForeignKey("shots.id", ondelete="CASCADE")),
    )
    op.add_column("shots", sa.Column("offset_ms", sa.Integer(), nullable=True))
    op.create_index("ix_shots_parent_shot_id", "shots", ["parent_shot_id"])


def downgrade() -> None:
    op.drop_index("ix_shots_parent_shot_id", table_name="shots")
    op.drop_column("shots", "offset_ms")
    op.drop_column("shots", "parent_shot_id")
