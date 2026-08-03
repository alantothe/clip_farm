"""Give a Shot its own Trim, and let one Clip have several Shots."""

from alembic import op
import sqlalchemy as sa


revision = "0012_shot_trim"
down_revision = "0011_sequence_renders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shots", sa.Column("trim_start_ms", sa.Integer(), nullable=True))
    op.add_column("shots", sa.Column("trim_end_ms", sa.Integer(), nullable=True))
    # A Shot carries its own Trim now, so the same Clip at two different in/out
    # points is an ordinary edit rather than a duplicate (ADR 0004). SQLite
    # cannot drop a table constraint in place, hence the batch rewrite.
    with op.batch_alter_table("shots") as batch:
        batch.drop_constraint("uq_shots_project", type_="unique")


def downgrade() -> None:
    with op.batch_alter_table("shots") as batch:
        batch.create_unique_constraint("uq_shots_project", ["project_id"])
    op.drop_column("shots", "trim_end_ms")
    op.drop_column("shots", "trim_start_ms")
