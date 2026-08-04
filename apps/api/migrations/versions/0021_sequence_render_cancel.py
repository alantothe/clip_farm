"""When the operator asked a Sequence Render to stop."""

from alembic import op
import sqlalchemy as sa


revision = "0021_sequence_render_cancel"
down_revision = "0020_sequence_publications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable with no default: nothing that predates cancelling was ever
    # cancelled, so NULL is both the honest backfill and what an export that
    # runs to the end keeps. A request rather than a status, because the worker
    # owns `status` and rewrites it at every stage.
    op.add_column(
        "sequence_renders", sa.Column("cancel_requested_at", sa.DateTime(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("sequence_renders", "cancel_requested_at")
