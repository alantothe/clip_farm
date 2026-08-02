from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Layout = Literal["smart_crop", "fit_background"]
CaptionStyle = Literal["bold", "classic", "minimal"]
CaptionPosition = Literal["top", "middle", "bottom"]


class ImportRequest(BaseModel):
    url: str = Field(min_length=10, max_length=500)


class DeletionOut(BaseModel):
    deleted: int


class BatchCreate(BaseModel):
    name: str = Field(default="Untitled batch", max_length=120)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return value.strip() or "Untitled batch"


class BatchUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("A batch needs a name")
        return cleaned


class ProjectUpdate(BaseModel):
    trim_start_ms: int | None = Field(default=None, ge=0)
    trim_end_ms: int | None = Field(default=None, ge=1)
    layout: Layout | None = None
    crop_center_x: float | None = Field(default=None, ge=0, le=100)
    captions_enabled: bool | None = None
    caption_style: CaptionStyle | None = None
    caption_position: CaptionPosition | None = None

    @model_validator(mode="after")
    def validate_trim(self):
        if (
            self.trim_start_ms is not None
            and self.trim_end_ms is not None
            and self.trim_end_ms <= self.trim_start_ms
        ):
            raise ValueError("trim_end_ms must be greater than trim_start_ms")
        return self


class ArtifactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    mime_type: str
    size_bytes: int
    url: str | None = None


class CaptionSegmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    sequence: int
    start_ms: int
    end_ms: int
    text: str
    edited: bool


class CaptionSegmentUpdate(BaseModel):
    id: str
    text: str = Field(max_length=500)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)


class CaptionUpdateRequest(BaseModel):
    segments: list[CaptionSegmentUpdate]


class SocialCaptionUpdate(BaseModel):
    text: str = Field(max_length=5000)


class SocialCaptionRewriteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class SocialCaptionOut(BaseModel):
    text: str


class ImageOverlayUpdate(BaseModel):
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, gt=0)
    center_x: float | None = Field(default=None, ge=0, le=100)
    center_y: float | None = Field(default=None, ge=0, le=100)
    width_percent: float | None = Field(default=None, ge=10, le=100)
    rotation_deg: float | None = Field(default=None, ge=-180, le=180)
    opacity: float | None = Field(default=None, ge=0.1, le=1)

    @model_validator(mode="after")
    def validate_times(self):
        if self.start_ms is not None and self.end_ms is not None and self.end_ms <= self.start_ms:
            raise ValueError("end_ms must be greater than start_ms")
        return self


class ImageOverlayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    start_ms: int
    end_ms: int
    center_x: float
    center_y: float
    width_percent: float
    rotation_deg: float
    opacity: float
    mime_type: str
    size_bytes: int
    url: str


class PublicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    job_id: str | None
    platform: str
    status: str
    share_to_feed: bool
    remote_media_id: str | None
    permalink: str | None
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None


class PublishRequest(BaseModel):
    caption: str = Field(default="", max_length=2200)
    share_to_feed: bool = True


class RenderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: str
    size_bytes: int | None
    duration_ms: int | None
    layout: str
    error_message: str | None
    created_at: datetime
    download_url: str | None = None
    publications: list[PublicationOut] = []


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    render_id: str | None
    kind: str
    status: str
    progress: int
    message: str
    attempts: int
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    mode: str
    origin_kind: str
    batch_id: str | None
    # Uploads have no Origin URL. The column stores an empty string; the API
    # reports the absence honestly as null.
    source_url: str | None
    source_post_id: str | None
    title: str
    source_caption: str | None
    social_caption: str | None
    status: str
    transcription_status: str
    error_message: str | None
    duration_ms: int | None
    width: int | None
    height: int | None
    fps: float | None
    trim_start_ms: int
    trim_end_ms: int | None
    layout: str
    crop_center_x: float
    captions_enabled: bool
    caption_style: str
    caption_position: str
    created_at: datetime
    updated_at: datetime
    artifacts: list[ArtifactOut] = []
    captions: list[CaptionSegmentOut] = []
    image_overlays: list[ImageOverlayOut] = []
    renders: list[RenderOut] = []
    latest_job: JobOut | None = None

    @field_validator("source_url", "source_post_id", mode="before")
    @classmethod
    def blank_origin_is_absent(cls, value):
        return value or None


class ShotCreate(BaseModel):
    clip_id: str


class ShotMove(BaseModel):
    position: int = Field(ge=0)


class ShotOut(BaseModel):
    """One Shot. The Clip itself travels in the Batch's `clips`, not here."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    # `project_id` is the stale column name for what the glossary calls a Clip;
    # the API boundary speaks the glossary.
    clip_id: str = Field(validation_alias="project_id")
    position: int


class SequenceRenderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    batch_id: str
    status: str
    progress: int
    message: str
    size_bytes: int | None
    duration_ms: int | None
    shot_count: int
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None
    download_url: str | None = None


class BatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    clips: list[ProjectOut] = []
    # The Sequence, in play order.
    shots: list[ShotOut] = []
    # The most recent export, if this Batch has ever been rendered.
    sequence_render: SequenceRenderOut | None = None


class BatchSummaryOut(BaseModel):
    """A Batch without its Clips, for the list that picks between Batches."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    clip_count: int = 0
    importing_count: int = 0
    failed_count: int = 0
    shot_count: int = 0


class BatchUploadOut(BaseModel):
    """The result of one multi-file upload: the Batch, plus anything refused."""

    batch: BatchOut
    accepted: int
    rejected: list[str] = []


class ConnectedAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    platform: str
    remote_user_id: str
    username: str
    display_name: str | None
    scopes: list[str]
    status: str
    token_expires_at: datetime | None
    connected_at: datetime
    updated_at: datetime

    @field_validator("scopes", mode="before")
    @classmethod
    def split_scopes(cls, value):
        if isinstance(value, str):
            return [scope for scope in value.split(",") if scope]
        return value


class PlatformConnectionOut(BaseModel):
    platform: str
    display_name: str
    configured: bool
    missing_configuration: list[str]
    account: ConnectedAccountOut | None
