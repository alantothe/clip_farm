from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def new_id() -> str:
    return str(uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# Workflow a project belongs to. Every project predating the mode library was an
# X-to-vertical clip, so that is both the default and the backfill value.
MODE_X_TO_VERTICAL = "x-to-vertical"


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    mode: Mapped[str] = mapped_column(String, default=MODE_X_TO_VERTICAL, index=True)
    source_url: Mapped[str] = mapped_column(String, index=True)
    source_post_id: Mapped[str] = mapped_column(String, index=True)
    title: Mapped[str] = mapped_column(String, default="Untitled clip")
    source_caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    social_caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="queued", index=True)
    transcription_status: Mapped[str] = mapped_column(String, default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fps: Mapped[float | None] = mapped_column(Float, nullable=True)
    trim_start_ms: Mapped[int] = mapped_column(Integer, default=0)
    trim_end_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    layout: Mapped[str] = mapped_column(String, default="fit_background")
    crop_center_x: Mapped[float] = mapped_column(Float, default=50.0)
    captions_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    caption_style: Mapped[str] = mapped_column(String, default="bold")
    caption_position: Mapped[str] = mapped_column(String, default="bottom")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    artifacts: Mapped[list["Artifact"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    captions: Mapped[list["CaptionSegment"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="CaptionSegment.sequence",
    )
    image_overlays: Mapped[list["ImageOverlay"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="ImageOverlay.start_ms",
    )
    renders: Mapped[list["Render"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    jobs: Mapped[list["Job"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String, index=True)
    path: Mapped[str] = mapped_column(String)
    mime_type: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    project: Mapped[Project] = relationship(back_populates="artifacts")


class CaptionSegment(Base):
    __tablename__ = "caption_segments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    sequence: Mapped[int] = mapped_column(Integer)
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    edited: Mapped[bool] = mapped_column(Boolean, default=False)

    project: Mapped[Project] = relationship(back_populates="captions")


class ImageOverlay(Base):
    __tablename__ = "image_overlays"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    artifact_id: Mapped[str] = mapped_column(
        ForeignKey("artifacts.id", ondelete="CASCADE"), unique=True
    )
    name: Mapped[str] = mapped_column(String)
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    center_x: Mapped[float] = mapped_column(Float, default=50.0)
    center_y: Mapped[float] = mapped_column(Float, default=50.0)
    width_percent: Mapped[float] = mapped_column(Float, default=65.0)
    rotation_deg: Mapped[float] = mapped_column(Float, default=0.0)
    opacity: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    project: Mapped[Project] = relationship(back_populates="image_overlays")
    artifact: Mapped[Artifact] = relationship()

    @property
    def mime_type(self) -> str:
        return self.artifact.mime_type

    @property
    def size_bytes(self) -> int:
        return self.artifact.size_bytes

    @property
    def url(self) -> str:
        return ""


class Render(Base):
    __tablename__ = "renders"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String, default="queued", index=True)
    path: Mapped[str | None] = mapped_column(String, nullable=True)
    checksum: Mapped[str | None] = mapped_column(String, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    layout: Mapped[str] = mapped_column(String)
    trim_start_ms: Mapped[int] = mapped_column(Integer)
    trim_end_ms: Mapped[int] = mapped_column(Integer)
    captions_enabled: Mapped[bool] = mapped_column(Boolean)
    caption_style: Mapped[str] = mapped_column(String)
    caption_position: Mapped[str] = mapped_column(String, default="bottom")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    project: Mapped[Project] = relationship(back_populates="renders")
    jobs: Mapped[list["Job"]] = relationship(back_populates="render")
    publications: Mapped[list["Publication"]] = relationship(
        back_populates="render", cascade="all, delete-orphan"
    )


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    render_id: Mapped[str | None] = mapped_column(
        ForeignKey("renders.id", ondelete="CASCADE"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="queued", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(String, default="Queued")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    project: Mapped[Project] = relationship(back_populates="jobs")
    render: Mapped[Render | None] = relationship(back_populates="jobs")


class PlatformAccount(Base):
    __tablename__ = "platform_accounts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    platform: Mapped[str] = mapped_column(String, unique=True, index=True)
    remote_user_id: Mapped[str] = mapped_column(String)
    username: Mapped[str] = mapped_column(String)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    access_token_encrypted: Mapped[str] = mapped_column(Text)
    scopes: Mapped[str] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String, default="connected", index=True)
    connected_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class Publication(Base):
    __tablename__ = "publications"
    __table_args__ = (UniqueConstraint("render_id", "platform"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    render_id: Mapped[str] = mapped_column(
        ForeignKey("renders.id", ondelete="CASCADE"), index=True
    )
    account_id: Mapped[str | None] = mapped_column(
        ForeignKey("platform_accounts.id", ondelete="SET NULL"), nullable=True
    )
    job_id: Mapped[str | None] = mapped_column(
        ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True
    )
    platform: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String, default="queued", index=True)
    caption: Mapped[str] = mapped_column(Text, default="")
    share_to_feed: Mapped[bool] = mapped_column(Boolean, default=True)
    remote_container_id: Mapped[str | None] = mapped_column(String, nullable=True)
    remote_media_id: Mapped[str | None] = mapped_column(String, nullable=True)
    permalink: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    render: Mapped[Render] = relationship(back_populates="publications")
