"""Sequence images and global reusable image Storage.

Both tables own files on disk. A placement copies a Stored Image rather than
pointing at it, so deleting from Storage cannot alter an existing edit.
"""

from alembic import op
import sqlalchemy as sa


revision = "0018_storage"
down_revision = "0017_shot_framing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "batch_media",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("batch_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("mime_type", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("start_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("end_ms", sa.Integer(), nullable=False),
        sa.Column("center_x", sa.Float(), nullable=False, server_default="50.0"),
        sa.Column("center_y", sa.Float(), nullable=False, server_default="50.0"),
        sa.Column("width_percent", sa.Float(), nullable=False, server_default="65.0"),
        sa.Column("rotation_deg", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("opacity", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_batch_media_batch_id", "batch_media", ["batch_id"])
    op.create_table(
        "stored_images",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("mime_type", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("stored_images")
    op.drop_index("ix_batch_media_batch_id", table_name="batch_media")
    op.drop_table("batch_media")
