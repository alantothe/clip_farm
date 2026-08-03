"""Phrases — words saved whole, with their look and their place.

One new table, so `create_all` builds it for a local or volume database with no
ALTER path needed (ADR 0002, ADR 0008). It repeats `0015_titles`' look columns
rather than importing them: a migration is a record of what was run, and one
that changed under a later edit to a shared helper would stop being one.
"""

from alembic import op
import sqlalchemy as sa


revision = "0016_phrases"
down_revision = "0015_titles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "phrases",
        sa.Column("id", sa.String(), nullable=False),
        # The words are the label: a Phrase has no name column, because a name
        # that was not the text would be a second thing to keep in step.
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
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
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("phrases")
