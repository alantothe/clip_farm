"""Initial Clip Farm schema."""

from alembic import op
import sqlalchemy as sa


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("source_url", sa.String(), nullable=False),
        sa.Column("source_post_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("transcription_status", sa.String(), nullable=False),
        sa.Column("error_message", sa.Text()),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("width", sa.Integer()),
        sa.Column("height", sa.Integer()),
        sa.Column("fps", sa.Float()),
        sa.Column("trim_start_ms", sa.Integer(), nullable=False),
        sa.Column("trim_end_ms", sa.Integer()),
        sa.Column("layout", sa.String(), nullable=False),
        sa.Column("crop_center_x", sa.Float(), nullable=False),
        sa.Column("captions_enabled", sa.Boolean(), nullable=False),
        sa.Column("caption_style", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_projects_source_post_id", "projects", ["source_post_id"])
    op.create_index("ix_projects_source_url", "projects", ["source_url"])
    op.create_index("ix_projects_status", "projects", ["status"])

    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("mime_type", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_artifacts_kind", "artifacts", ["kind"])

    op.create_table(
        "caption_segments",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("start_ms", sa.Integer(), nullable=False),
        sa.Column("end_ms", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("edited", sa.Boolean(), nullable=False),
    )

    op.create_table(
        "renders",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("path", sa.String()),
        sa.Column("checksum", sa.String()),
        sa.Column("size_bytes", sa.Integer()),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("layout", sa.String(), nullable=False),
        sa.Column("trim_start_ms", sa.Integer(), nullable=False),
        sa.Column("trim_end_ms", sa.Integer(), nullable=False),
        sa.Column("captions_enabled", sa.Boolean(), nullable=False),
        sa.Column("caption_style", sa.String(), nullable=False),
        sa.Column("error_message", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime()),
    )
    op.create_index("ix_renders_status", "renders", ["status"])

    op.create_table(
        "jobs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("render_id", sa.String(), sa.ForeignKey("renders.id", ondelete="CASCADE")),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("message", sa.String(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime()),
        sa.Column("completed_at", sa.DateTime()),
    )
    op.create_index("ix_jobs_status", "jobs", ["status"])


def downgrade() -> None:
    op.drop_table("jobs")
    op.drop_table("renders")
    op.drop_table("caption_segments")
    op.drop_table("artifacts")
    op.drop_table("projects")

