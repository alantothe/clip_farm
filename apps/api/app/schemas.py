from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Layout = Literal["smart_crop", "fit_background"]
CaptionStyle = Literal["bold", "classic", "minimal"]
CaptionPosition = Literal["top", "middle", "bottom"]
# The shape of a Batch's finished video. The stored value is the shape alone,
# never a platform-and-shape pair — Instagram is a Platform (ADR 0006).
Format = Literal["vertical"]


class ImportRequest(BaseModel):
    url: str = Field(min_length=10, max_length=500)


class DeletionOut(BaseModel):
    deleted: int


class StoredImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    mime_type: str
    size_bytes: int
    created_at: datetime
    updated_at: datetime
    url: str = ""


class OverlayFromStorageCreate(BaseModel):
    storage_image_id: str
    start_ms: int = Field(default=0, ge=0)


class BatchMediaFromStorageCreate(BaseModel):
    storage_image_id: str
    end_ms: int | None = Field(default=None, gt=0)


class BatchCreate(BaseModel):
    name: str = Field(default="Untitled batch", max_length=120)
    # The Format is fixed at creation and never edited, so it is accepted here
    # and nowhere else. BatchUpdate deliberately has no format (ADR 0006).
    format: Format = "vertical"

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


TitleAlign = Literal["left", "center", "right"]
TitleBackground = Literal["none", "box"]

#: `#RRGGBB`, the one colour spelling that crosses the API. The renderer and the
#: browser both parse it, and neither has to guess about alpha — opacity is its
#: own field, because libass keeps colour and alpha in separate places anyway.
HEX_COLOR = r"^#(?:[0-9A-Fa-f]{6})$"


def _upper_hex(value: str) -> str:
    return value.upper()


class TitleLookOut(BaseModel):
    """A Title's look and placement, as it is stored.

    The ranges are the renderer's, not the UI's: a `font_size_percent` of 40 is
    a Title four-tenths of the frame tall, which is absurd but draws. Anything
    outside these produces an ASS file libass would read as something else.
    """

    model_config = ConfigDict(from_attributes=True)

    font_family: str = "inter"
    font_weight: int = Field(default=900, ge=100, le=900)
    italic: bool = False
    uppercase: bool = False
    font_size_percent: float = Field(default=6.0, ge=1, le=40)
    letter_spacing: float = Field(default=0.0, ge=-0.1, le=0.5)
    color: str = Field(default="#FFFFFF", pattern=HEX_COLOR)
    opacity: float = Field(default=1.0, ge=0.05, le=1)
    align: TitleAlign = "center"
    outline_color: str = Field(default="#000000", pattern=HEX_COLOR)
    outline_width: float = Field(default=0.08, ge=0, le=0.4)
    shadow_color: str = Field(default="#000000", pattern=HEX_COLOR)
    shadow_offset: float = Field(default=0.0, ge=0, le=0.4)
    background: TitleBackground = "none"
    background_color: str = Field(default="#000000", pattern=HEX_COLOR)
    background_opacity: float = Field(default=0.7, ge=0, le=1)
    background_padding: float = Field(default=0.25, ge=0, le=1.5)
    center_x: float = Field(default=50.0, ge=0, le=100)
    center_y: float = Field(default=30.0, ge=0, le=100)
    width_percent: float = Field(default=80.0, ge=5, le=100)
    rotation_deg: float = Field(default=0.0, ge=-180, le=180)


class TitleLookPatch(BaseModel):
    """The same set, all optional: an omitted field is one left alone.

    None is not meaningful for any of these — a Title always has a colour — so
    unlike `ShotUpdate` there is no absent-versus-null distinction to keep, and
    `exclude_unset` is enough.
    """

    font_family: str | None = None
    font_weight: int | None = Field(default=None, ge=100, le=900)
    italic: bool | None = None
    uppercase: bool | None = None
    font_size_percent: float | None = Field(default=None, ge=1, le=40)
    letter_spacing: float | None = Field(default=None, ge=-0.1, le=0.5)
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    opacity: float | None = Field(default=None, ge=0.05, le=1)
    align: TitleAlign | None = None
    outline_color: str | None = Field(default=None, pattern=HEX_COLOR)
    outline_width: float | None = Field(default=None, ge=0, le=0.4)
    shadow_color: str | None = Field(default=None, pattern=HEX_COLOR)
    shadow_offset: float | None = Field(default=None, ge=0, le=0.4)
    background: TitleBackground | None = None
    background_color: str | None = Field(default=None, pattern=HEX_COLOR)
    background_opacity: float | None = Field(default=None, ge=0, le=1)
    background_padding: float | None = Field(default=None, ge=0, le=1.5)
    center_x: float | None = Field(default=None, ge=0, le=100)
    center_y: float | None = Field(default=None, ge=0, le=100)
    width_percent: float | None = Field(default=None, ge=5, le=100)
    rotation_deg: float | None = Field(default=None, ge=-180, le=180)

    _normalize_colors = field_validator(
        "color", "outline_color", "shadow_color", "background_color"
    )(lambda value: value if value is None else value.upper())

    def look(self) -> dict:
        """Only the look fields, and only the ones actually sent.

        Restricted to this model's own fields because the subclasses add
        `text`, `start_ms` and `name`, which are not part of a look and must
        not be copied onto one.
        """
        sent = self.model_dump(exclude_unset=True, exclude_none=True)
        return {name: sent[name] for name in TitleLookPatch.model_fields if name in sent}


class TitleCreate(TitleLookPatch):
    """Write a Title onto a Batch's Sequence.

    `style_id` is applied first and the look fields sent alongside it win, so
    one request can both start from a Style and depart from it — which is what
    duplicating an existing Title is.
    """

    text: str = Field(default="", max_length=500)
    start_ms: int = Field(default=0, ge=0)
    end_ms: int = Field(default=3000, gt=0)
    end_at_sequence_end: bool = False
    style_id: str | None = None

    @model_validator(mode="after")
    def validate_span(self):
        if self.end_ms <= self.start_ms:
            raise ValueError("A title has to end after it starts")
        return self


class TitleUpdate(TitleLookPatch):
    """Retime, rewrite or restyle a Title. Everything is optional."""

    text: str | None = Field(default=None, max_length=500)
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, gt=0)
    style_id: str | None = None

    @model_validator(mode="after")
    def validate_span(self):
        if self.start_ms is not None and self.end_ms is not None and self.end_ms <= self.start_ms:
            raise ValueError("A title has to end after it starts")
        return self


class TitleOut(TitleLookOut):
    id: str
    batch_id: str
    text: str
    #: Sequence milliseconds, not an offset into a Shot (ADR 0008).
    start_ms: int
    end_ms: int
    #: Where this Title's look came from, for its label. Not a live link.
    style_id: str | None = None


class BatchMediaUpdate(BaseModel):
    """Retime or place a still image over the finished Sequence."""

    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, gt=0)
    center_x: float | None = Field(default=None, ge=0, le=100)
    center_y: float | None = Field(default=None, ge=0, le=100)
    width_percent: float | None = Field(default=None, ge=10, le=100)
    rotation_deg: float | None = Field(default=None, ge=-180, le=180)
    opacity: float | None = Field(default=None, ge=0.1, le=1)

    @model_validator(mode="after")
    def validate_span(self):
        if self.start_ms is not None and self.end_ms is not None and self.end_ms <= self.start_ms:
            raise ValueError("An image has to end after it starts")
        return self


class BatchMediaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    batch_id: str
    name: str
    mime_type: str
    size_bytes: int
    start_ms: int
    end_ms: int
    center_x: float
    center_y: float
    width_percent: float
    rotation_deg: float
    opacity: float
    url: str = ""


class TitleStyleWrite(TitleLookPatch):
    """Save a look under a name. Anything unsent takes the stored default."""

    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("A style needs a name")
        return cleaned


class TitleStyleOut(TitleLookOut):
    id: str
    name: str
    #: Clip Farm's own Styles, which cannot be edited or deleted.
    builtin: bool = False


class PhraseWrite(TitleLookPatch):
    """Save words whole, with the look and the placement they were written in.

    The same look fields a Style takes, plus the text — which is what makes it
    a Phrase rather than a Style. No name: the words are the label.
    """

    text: str = Field(min_length=1, max_length=500)

    @field_validator("text")
    @classmethod
    def text_is_not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("A phrase needs its words")
        return cleaned


class PhraseOut(TitleLookOut):
    id: str
    text: str


class LayerProfileCreate(BaseModel):
    """Save the chosen layers from one Batch as a reusable arrangement."""

    name: str = Field(min_length=1, max_length=80)
    title_ids: list[str] = Field(default_factory=list, max_length=3)
    media_ids: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("A layer profile needs a name")
        return cleaned

    @model_validator(mode="after")
    def contains_a_layer(self):
        if not self.title_ids and not self.media_ids:
            raise ValueError("Choose at least one text or image layer")
        if len(set(self.title_ids)) != len(self.title_ids) or len(set(self.media_ids)) != len(
            self.media_ids
        ):
            raise ValueError("A layer can only be saved once")
        return self


class LayerProfileTitleOut(TitleLookOut):
    id: str
    text: str


class LayerProfileMediaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    mime_type: str
    size_bytes: int
    center_x: float
    center_y: float
    width_percent: float
    rotation_deg: float
    opacity: float
    url: str = ""


class LayerProfileOut(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    titles: list[LayerProfileTitleOut] = Field(default_factory=list)
    media: list[LayerProfileMediaOut] = Field(default_factory=list)


class FontFamilyOut(BaseModel):
    """One family an operator can pick, and the weights actually vendored.

    `weights` is the truth about the files on disk, not an aspiration: asking
    for a weight a family does not have resolves to its nearest, so the picker
    shows only what will be drawn exactly.
    """

    id: str
    name: str
    category: str
    weights: list[int]


class FontFaceOut(BaseModel):
    """One vendored file, and the two names needed to use it.

    `file` is what the browser loads and what the renderer opens — the same
    bytes on both sides, which is the whole reason the faces are committed
    (ADR 0008).
    """

    id: str
    family: str
    weight: int
    weight_label: str
    file: str
    url: str


class FontCatalogOut(BaseModel):
    families: list[FontFamilyOut]
    faces: list[FontFaceOut]


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
    """Place a Clip in the Sequence.

    `position` and the trim override are here so undoing a removal can put a
    Shot back exactly as it was, rather than appending a fresh one.
    """

    clip_id: str
    position: int | None = Field(default=None, ge=0)
    trim_start_ms: int | None = Field(default=None, ge=0)
    trim_end_ms: int | None = Field(default=None, ge=0)
    frame_zoom: float = Field(default=1.0, ge=1, le=3)
    frame_center_x: float = Field(default=50.0, ge=0, le=100)
    frame_center_y: float = Field(default=50.0, ge=0, le=100)


class ShotUpdate(BaseModel):
    """Move, trim, or frame a Shot.

    Every field is optional, and a null trim is meaningful — it resets the Shot
    to following its Clip. Absent and null are told apart by `model_fields_set`,
    so callers must omit what they do not mean to change.
    """

    position: int | None = Field(default=None, ge=0)
    trim_start_ms: int | None = Field(default=None, ge=0)
    trim_end_ms: int | None = Field(default=None, ge=0)
    frame_zoom: float | None = Field(default=None, ge=1, le=3)
    frame_center_x: float | None = Field(default=None, ge=0, le=100)
    frame_center_y: float | None = Field(default=None, ge=0, le=100)


class CutawayCreate(BaseModel):
    """Place a Clip over a Shot for a span."""

    clip_id: str
    base_shot_id: str
    offset_ms: int = Field(ge=0)
    trim_start_ms: int | None = Field(default=None, ge=0)
    trim_end_ms: int | None = Field(default=None, ge=0)
    frame_zoom: float = Field(default=1.0, ge=1, le=3)
    frame_center_x: float = Field(default=50.0, ge=0, le=100)
    frame_center_y: float = Field(default=50.0, ge=0, le=100)


class CutawayUpdate(BaseModel):
    """Move, re-anchor, trim, or frame a Cutaway.

    Same absent-versus-null rule as `ShotUpdate`: a null trim resets that edge
    to following the Clip, and an omitted one leaves it alone.
    """

    base_shot_id: str | None = None
    offset_ms: int | None = Field(default=None, ge=0)
    trim_start_ms: int | None = Field(default=None, ge=0)
    trim_end_ms: int | None = Field(default=None, ge=0)
    frame_zoom: float | None = Field(default=None, ge=1, le=3)
    frame_center_x: float | None = Field(default=None, ge=0, le=100)
    frame_center_y: float | None = Field(default=None, ge=0, le=100)


class CutawayOut(BaseModel):
    """One Cutaway: which Clip covers which Base Shot, and where."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    clip_id: str = Field(validation_alias="project_id")
    base_shot_id: str = Field(validation_alias="parent_shot_id")
    offset_ms: int
    trim_start_ms: int | None = None
    trim_end_ms: int | None = None
    frame_zoom: float
    frame_center_x: float
    frame_center_y: float


class ShotOut(BaseModel):
    """One Shot. The Clip itself travels in the Batch's `clips`, not here."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    # `project_id` is the stale column name for what the glossary calls a Clip;
    # the API boundary speaks the glossary.
    clip_id: str = Field(validation_alias="project_id")
    position: int
    # Null means this Shot follows its Clip's Trim; the web draws the
    # difference, so it needs the override rather than only the result.
    trim_start_ms: int | None = None
    trim_end_ms: int | None = None
    frame_zoom: float
    frame_center_x: float
    frame_center_y: float


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
    format: Format
    created_at: datetime
    updated_at: datetime
    clips: list[ProjectOut] = []
    # The Sequence, in play order. Cutaways are not in it — each one sits on a
    # Base Shot at an offset rather than in the running order (ADR 0005).
    shots: list[ShotOut] = []
    cutaways: list[CutawayOut] = []
    # Timed in Sequence milliseconds and owned by the Batch, so they travel
    # here rather than on any Clip (ADR 0008).
    titles: list[TitleOut] = []
    # Still images timed against the finished Sequence, across Shot boundaries.
    media: list[BatchMediaOut] = []
    # The most recent export, if this Batch has ever been rendered.
    sequence_render: SequenceRenderOut | None = None


class BatchSummaryOut(BaseModel):
    """A Batch without its Clips, for the list that picks between Batches."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    format: Format
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
