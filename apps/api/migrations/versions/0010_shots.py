"""Give a Batch a Sequence: the ordered Shots that render as one video."""

from alembic import op
import sqlalchemy as sa


revision = "0010_shots"
down_revision = "0009_batches"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shots",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("batch_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        # A Shot plays the span its Clip's Trim defines, so a second placement
        # of the same Clip would play identically twice.
        sa.UniqueConstraint("project_id", name="uq_shots_project"),
    )
    op.create_index("ix_shots_batch_id", "shots", ["batch_id"])
    op.create_index("ix_shots_project_id", "shots", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_shots_project_id", table_name="shots")
    op.drop_index("ix_shots_batch_id", table_name="shots")
    op.drop_table("shots")
