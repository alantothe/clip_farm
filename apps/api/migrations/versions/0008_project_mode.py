"""Tag each project with the mode that produced it."""

from alembic import op
import sqlalchemy as sa


revision = "0008_project_mode"
down_revision = "0007_publications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Added nullable so existing rows survive, backfilled, then pinned non-null:
    # every project predating the mode library was an X-to-vertical clip.
    op.add_column("projects", sa.Column("mode", sa.String(), nullable=True))
    op.execute("UPDATE projects SET mode = 'x-to-vertical' WHERE mode IS NULL")
    with op.batch_alter_table("projects") as batch:
        batch.alter_column("mode", existing_type=sa.String(), nullable=False)
    op.create_index("ix_projects_mode", "projects", ["mode"])


def downgrade() -> None:
    op.drop_index("ix_projects_mode", table_name="projects")
    op.drop_column("projects", "mode")
