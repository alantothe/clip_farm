"""Reusable full-Sequence Title and image arrangements."""

from alembic import op
import sqlalchemy as sa


revision = "0019_layer_profiles"
down_revision = "0018_storage"
branch_labels = None
depends_on = None


def _title_look_columns() -> list[sa.Column]:
    return [
        sa.Column("font_family", sa.String(), nullable=False, server_default="inter"),
        sa.Column("font_weight", sa.Integer(), nullable=False, server_default="900"),
        sa.Column("italic", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("uppercase", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("font_size_percent", sa.Float(), nullable=False, server_default="6.0"),
        sa.Column("letter_spacing", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("color", sa.String(), nullable=False, server_default="#FFFFFF"),
        sa.Column("opacity", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("align", sa.String(), nullable=False, server_default="center"),
        sa.Column("outline_color", sa.String(), nullable=False, server_default="#000000"),
        sa.Column("outline_width", sa.Float(), nullable=False, server_default="0.08"),
        sa.Column("shadow_color", sa.String(), nullable=False, server_default="#000000"),
        sa.Column("shadow_offset", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("background", sa.String(), nullable=False, server_default="none"),
        sa.Column("background_color", sa.String(), nullable=False, server_default="#000000"),
        sa.Column("background_opacity", sa.Float(), nullable=False, server_default="0.7"),
        sa.Column("background_padding", sa.Float(), nullable=False, server_default="0.25"),
        sa.Column("center_x", sa.Float(), nullable=False, server_default="50.0"),
        sa.Column("center_y", sa.Float(), nullable=False, server_default="30.0"),
        sa.Column("width_percent", sa.Float(), nullable=False, server_default="80.0"),
        sa.Column("rotation_deg", sa.Float(), nullable=False, server_default="0.0"),
    ]


def upgrade() -> None:
    op.add_column(
        "titles",
        sa.Column(
            "end_at_sequence_end", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "batch_media",
        sa.Column(
            "end_at_sequence_end", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.create_table(
        "layer_profiles",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "layer_profile_titles",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("profile_id", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        *_title_look_columns(),
        sa.ForeignKeyConstraint(["profile_id"], ["layer_profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_layer_profile_titles_profile_id", "layer_profile_titles", ["profile_id"])
    op.create_table(
        "layer_profile_media",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("profile_id", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("mime_type", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("center_x", sa.Float(), nullable=False, server_default="50.0"),
        sa.Column("center_y", sa.Float(), nullable=False, server_default="50.0"),
        sa.Column("width_percent", sa.Float(), nullable=False, server_default="65.0"),
        sa.Column("rotation_deg", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("opacity", sa.Float(), nullable=False, server_default="1.0"),
        sa.ForeignKeyConstraint(["profile_id"], ["layer_profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_layer_profile_media_profile_id", "layer_profile_media", ["profile_id"])


def downgrade() -> None:
    op.drop_index("ix_layer_profile_media_profile_id", table_name="layer_profile_media")
    op.drop_table("layer_profile_media")
    op.drop_index("ix_layer_profile_titles_profile_id", table_name="layer_profile_titles")
    op.drop_table("layer_profile_titles")
    op.drop_table("layer_profiles")
    op.drop_column("batch_media", "end_at_sequence_end")
    op.drop_column("titles", "end_at_sequence_end")
