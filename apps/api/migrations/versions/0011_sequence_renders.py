"""Record the finished video a Sequence produces."""

from alembic import op
import sqlalchemy as sa


revision = "0011_sequence_renders"
down_revision = "0010_shots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Its own table rather than a row in `renders`: that table's project_id is
    # NOT NULL, and a Sequence Render belongs to a Batch, not one Clip.
    op.create_table(
        "sequence_renders",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("batch_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("message", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=True),
        sa.Column("checksum", sa.String(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("shot_count", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_sequence_renders_batch_id", "sequence_renders", ["batch_id"])
    op.create_index("ix_sequence_renders_status", "sequence_renders", ["status"])


def downgrade() -> None:
    op.drop_index("ix_sequence_renders_status", table_name="sequence_renders")
    op.drop_index("ix_sequence_renders_batch_id", table_name="sequence_renders")
    op.drop_table("sequence_renders")
