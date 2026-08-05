"""Record which Layer Profile a Title or Sequence image was applied from."""

from alembic import op
import sqlalchemy as sa


revision = "0022_layer_profile_provenance"
down_revision = "0021_sequence_render_cancel"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Applying a profile used to create ordinary Titles and images that kept no
    # trace of where they came from, so a second profile could only be stacked
    # on top of the first (ADR 0013). This column is what lets an apply replace
    # the layers a previous one left behind.
    #
    # SET NULL rather than CASCADE: deleting the profile must not delete the
    # layers made from it. Their words, bytes and look were copied at apply
    # time and are the operator's edit now — losing the name they came from
    # only means a later apply can no longer claim them.
    with op.batch_alter_table("titles") as batch:
        batch.add_column(sa.Column("applied_profile_id", sa.String(), nullable=True))
        batch.create_foreign_key(
            "fk_titles_applied_profile_id",
            "layer_profiles",
            ["applied_profile_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_titles_applied_profile_id", "titles", ["applied_profile_id"])

    with op.batch_alter_table("batch_media") as batch:
        batch.add_column(sa.Column("applied_profile_id", sa.String(), nullable=True))
        batch.create_foreign_key(
            "fk_batch_media_applied_profile_id",
            "layer_profiles",
            ["applied_profile_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index(
        "ix_batch_media_applied_profile_id", "batch_media", ["applied_profile_id"]
    )

    # Layers that already exist stay untagged, and a Replace therefore leaves
    # them alone. Backfilling by guessing at full-span layers would delete
    # hand-written ones the first time an operator swapped profiles.


def downgrade() -> None:
    op.drop_index("ix_batch_media_applied_profile_id", table_name="batch_media")
    with op.batch_alter_table("batch_media") as batch:
        batch.drop_constraint("fk_batch_media_applied_profile_id", type_="foreignkey")
        batch.drop_column("applied_profile_id")

    op.drop_index("ix_titles_applied_profile_id", table_name="titles")
    with op.batch_alter_table("titles") as batch:
        batch.drop_constraint("fk_titles_applied_profile_id", type_="foreignkey")
        batch.drop_column("applied_profile_id")
