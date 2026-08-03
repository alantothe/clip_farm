"""A Batch's Titles, and the saved Styles they are made from.

Two new tables, so `create_all` builds them for a local or volume database with
no ALTER path needed (ADR 0002, ADR 0008). The built-in Styles are not seeded
here: they live in `app.services.titles` so improving one is a release rather
than a data migration.
"""

from alembic import op
import sqlalchemy as sa


revision = "0015_titles"
down_revision = "0014_batch_format"
branch_labels = None
depends_on = None


def _look_columns() -> list[sa.Column]:
    """The look and placement a Title and a Title Style both carry.

    The same set on both tables, for the same reason `TitleLook` is a mixin: a
    Style that cannot describe some part of a Title is a Style that loses it.
    """
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
    op.create_table(
        "title_styles",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        *_look_columns(),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "titles",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("batch_id", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        # Sequence milliseconds, not an offset into a Shot: a Title stays where
        # it was written when the Shots under it are reordered (ADR 0008).
        sa.Column("start_ms", sa.Integer(), nullable=False),
        sa.Column("end_ms", sa.Integer(), nullable=False),
        sa.Column("style_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        *_look_columns(),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"], ondelete="CASCADE"),
        # The look is already copied onto the Title, so losing the Style it came
        # from costs it nothing but the name.
        sa.ForeignKeyConstraint(["style_id"], ["title_styles.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_titles_batch_id", "titles", ["batch_id"])


def downgrade() -> None:
    op.drop_index("ix_titles_batch_id", table_name="titles")
    op.drop_table("titles")
    op.drop_table("title_styles")
