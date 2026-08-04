"""Record publishing a Batch's Sequence Render to a Platform."""

from alembic import op
import sqlalchemy as sa


revision = "0020_sequence_publications"
down_revision = "0019_layer_profiles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Its own table rather than a row in `publications`: that table's render_id
    # is NOT NULL and points at a Clip's Render, and a Sequence Render belongs
    # to a Batch (ADR 0012). `options` holds whatever one Platform wants and the
    # others have no word for, so a second destination needs no new column.
    op.create_table(
        "sequence_publications",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("batch_id", sa.String(), nullable=False),
        sa.Column("sequence_render_id", sa.String(), nullable=False),
        sa.Column("account_id", sa.String(), nullable=True),
        sa.Column("platform", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("message", sa.String(), nullable=False),
        sa.Column("caption", sa.Text(), nullable=False),
        sa.Column("options", sa.JSON(), nullable=False),
        sa.Column("remote_container_id", sa.String(), nullable=True),
        sa.Column("remote_media_id", sa.String(), nullable=True),
        sa.Column("permalink", sa.String(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["sequence_render_id"], ["sequence_renders.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["account_id"], ["platform_accounts.id"], ondelete="SET NULL"
        ),
        # A given Render reaches a given Platform once.
        sa.UniqueConstraint("sequence_render_id", "platform"),
    )
    op.create_index(
        "ix_sequence_publications_batch_id", "sequence_publications", ["batch_id"]
    )
    op.create_index(
        "ix_sequence_publications_sequence_render_id",
        "sequence_publications",
        ["sequence_render_id"],
    )
    op.create_index(
        "ix_sequence_publications_platform", "sequence_publications", ["platform"]
    )
    op.create_index(
        "ix_sequence_publications_status", "sequence_publications", ["status"]
    )


def downgrade() -> None:
    op.drop_index("ix_sequence_publications_status", table_name="sequence_publications")
    op.drop_index("ix_sequence_publications_platform", table_name="sequence_publications")
    op.drop_index(
        "ix_sequence_publications_sequence_render_id",
        table_name="sequence_publications",
    )
    op.drop_index("ix_sequence_publications_batch_id", table_name="sequence_publications")
    op.drop_table("sequence_publications")
