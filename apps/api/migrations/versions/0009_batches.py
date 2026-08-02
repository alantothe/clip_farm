"""Group Clips into Batches and record how each Clip entered Clip Farm."""

from alembic import op
import sqlalchemy as sa


revision = "0009_batches"
down_revision = "0008_project_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "batches",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # Added nullable so existing rows survive, backfilled, then pinned non-null:
    # every Clip predating Batch Process arrived from an X post.
    op.add_column("projects", sa.Column("origin_kind", sa.String(), nullable=True))
    op.execute("UPDATE projects SET origin_kind = 'x' WHERE origin_kind IS NULL")
    with op.batch_alter_table("projects") as batch:
        batch.alter_column("origin_kind", existing_type=sa.String(), nullable=False)
    op.create_index("ix_projects_origin_kind", "projects", ["origin_kind"])

    # Stays nullable: a Clip belongs to at most one Batch, and Clips imported
    # through the X mode belong to none.
    op.add_column("projects", sa.Column("batch_id", sa.String(), nullable=True))
    op.create_index("ix_projects_batch_id", "projects", ["batch_id"])
    with op.batch_alter_table("projects") as batch:
        batch.create_foreign_key(
            "fk_projects_batch_id_batches",
            "batches",
            ["batch_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_constraint("fk_projects_batch_id_batches", type_="foreignkey")
    op.drop_index("ix_projects_batch_id", table_name="projects")
    op.drop_column("projects", "batch_id")
    op.drop_index("ix_projects_origin_kind", table_name="projects")
    op.drop_column("projects", "origin_kind")
    op.drop_table("batches")
