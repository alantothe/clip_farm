from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


Layout = Literal["smart_crop", "fit_background"]
CaptionStyle = Literal["bold", "classic", "minimal"]
CaptionPosition = Literal["top", "middle", "bottom"]


class ImportRequest(BaseModel):
    url: str = Field(min_length=10, max_length=500)


class DeletionOut(BaseModel):
    deleted: int


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
    source_url: str
    source_post_id: str
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
