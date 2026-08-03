from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def new_id() -> str:
    return str(uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# The Mode a Clip came in through. Every Clip predating the Mode Library was an
# X-to-vertical clip, so that is both the default and the backfill value.
MODE_X_TO_VERTICAL = "x-to-vertical"
MODE_BATCH_PROCESS = "batch-process"

# Origin Kind: which way a Clip entered Clip Farm. An `x` Clip has an Origin URL
# and post id; an `upload` Clip has neither, and stores empty strings for both.
ORIGIN_KIND_X = "x"
ORIGIN_KIND_UPLOAD = "upload"

# Format: the shape of the finished video. Vertical is 1080x1920, the only shape
# Clip Farm renders today. It is stored as the shape alone and not as a
# platform-and-shape pair: Instagram is a Platform, and lives in
# `platform_accounts` and `publications` where a Platform belongs. Naming a
# Format `instagram_vertical` would need a second name for an identical
# 1080x1920 render the day a second Platform wants one, which is the compound
# `mode` string ADR 0001 removed (ADR 0006).
FORMAT_VERTICAL = "vertical"
FORMATS = (FORMAT_VERTICAL,)

# How a Title's text is set off from the picture behind it. `none` leaves the
# glyphs outlined; `box` puts them in a filled panel. They are exclusive because
# libass's BorderStyle is: 1 draws an outline, 3 draws a box and spends the same
# outline width on the box's padding (ADR 0008).
TITLE_BACKGROUND_NONE = "none"
TITLE_BACKGROUND_BOX = "box"
TITLE_BACKGROUNDS = (TITLE_BACKGROUND_NONE, TITLE_BACKGROUND_BOX)

TITLE_ALIGNMENTS = ("left", "center", "right")


class StoredImage(Base):
    """One reusable image in the operator's global Storage."""

    __tablename__ = "stored_images"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    path: Mapped[str] = mapped_column(String)
    mime_type: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class Batch(Base):
    """A named set of Clips imported and worked on together.

    Batches exist so several imports can run in parallel without their Clips
    crowding each other in one flat list. A Batch owns no *edit* settings —
    each Clip inside it is trimmed, cropped, and subtitled on its own — but it
    does own a Sequence, and renders through it into one video.

    It also owns that video's Format, which is an output target rather than an
    edit: a Sequence joins its Shots into one file, so the shape has to be
    settled for the Batch as a whole. It is chosen when the Batch is created and
    does not change afterwards (ADR 0006).
    """

    __tablename__ = "batches"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String, default="Untitled batch")
    format: Mapped[str] = mapped_column(String, default=FORMAT_VERTICAL)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    clips: Mapped[list["Project"]] = relationship(
        back_populates="batch", order_by="Project.created_at"
    )
    # The Sequence: the Batch's Shots in the order they play.
    shots: Mapped[list["Shot"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        # created_at breaks ties: two Shots can momentarily share a position if
        # concurrent adds interleave, and play order must still be defined.
        order_by="Shot.position, Shot.created_at",
    )
    sequence_renders: Mapped[list["SequenceRender"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="SequenceRender.created_at",
    )
    # Titles are timed in Sequence milliseconds and belong to the Batch rather
    # than to any Clip in it (ADR 0008). They may overlap, so this is the order
    # they are drawn in: later ones sit on top.
    titles: Mapped[list["Title"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="Title.start_ms, Title.created_at",
    )
    # Still images timed against the assembled Sequence. Unlike a Clip's image
    # overlays, these keep playing across Shot boundaries and Cutaways.
    media: Mapped[list["BatchMedia"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="BatchMedia.start_ms, BatchMedia.created_at",
    )


class Shot(Base):
    """One Clip's placement in a Batch's Sequence.

    A Shot carries its own Trim, nullable, which overrides its Clip's. That is
    what lets one Clip earn several Shots: the same source at two different
    in/out points is an ordinary edit (ADR 0004).

    A Shot with a `parent_shot_id` is a Cutaway: it covers that Shot for a span
    starting `offset_ms` into it, showing its picture while the covered Shot's
    audio keeps playing (ADR 0005). A Shot without one is in the Sequence, and
    `position` is where.

    Positions are renumbered to 0..n-1 whenever the Sequence is edited. A gap
    left by deleting a Clip elsewhere is harmless — order is what is read, not
    contiguity.
    """

    __tablename__ = "shots"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    batch_id: Mapped[str] = mapped_column(
        ForeignKey("batches.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    # Null is the Shot following its Clip's Trim, not an absent value.
    trim_start_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    trim_end_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Framing belongs to the placement rather than the Clip: the same Clip can
    # be a wide establishing Shot once and a tight detail later in a Sequence.
    frame_zoom: Mapped[float] = mapped_column(Float, default=1.0)
    frame_center_x: Mapped[float] = mapped_column(Float, default=50.0)
    frame_center_y: Mapped[float] = mapped_column(Float, default=50.0)
    # Set on a Cutaway: the Shot it covers, and how far into that Shot it lands.
    parent_shot_id: Mapped[str | None] = mapped_column(
        ForeignKey("shots.id", ondelete="CASCADE"), nullable=True, index=True
    )
    offset_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    batch: Mapped[Batch] = relationship(back_populates="shots")
    clip: Mapped["Project"] = relationship(back_populates="shots")
    # Removing a Base Shot takes the Cutaways covering it with it.
    cutaways: Mapped[list["Shot"]] = relationship(
        back_populates="base_shot",
        cascade="all, delete-orphan",
        order_by="Shot.offset_ms",
        remote_side=None,
    )
    base_shot: Mapped["Shot | None"] = relationship(
        back_populates="cutaways", remote_side="Shot.id"
    )

    @property
    def is_cutaway(self) -> bool:
        return self.parent_shot_id is not None

    def span(self) -> tuple[int, int | None]:
        """The span this Shot plays: its own Trim, falling back to its Clip's.

        The one place that rule lives, so the API and the worker cannot drift.
        A null override means the Shot follows its Clip, so editing the Clip's
        Trim moves it; a set one means it was trimmed on the Timeline, and the
        Clip no longer affects it.

        The end can still be None when a Clip never finished importing and has
        neither a Trim end nor a known duration. Callers decide what to do.
        """
        clip = self.clip
        start = self.trim_start_ms if self.trim_start_ms is not None else clip.trim_start_ms
        if self.trim_end_ms is not None:
            return start, self.trim_end_ms
        return start, clip.trim_end_ms or clip.duration_ms


class SequenceRender(Base):
    """The finished video a Sequence produces: every Shot in order, joined.

    Its own table rather than a Render, because `renders.project_id` is NOT
    NULL and this belongs to a Batch, not one Clip. Relaxing that would mean
    rebuilding `renders` under live foreign keys on startup, which ADR 0002
    declined to do. It carries its own status and progress for the same reason:
    a Job needs a Clip too.
    """

    __tablename__ = "sequence_renders"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    batch_id: Mapped[str] = mapped_column(
        ForeignKey("batches.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String, default="queued", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(String, default="Queued")
    path: Mapped[str | None] = mapped_column(String, nullable=True)
    checksum: Mapped[str | None] = mapped_column(String, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # How many Shots this Sequence held when it was rendered. The Sequence can
    # change afterwards; what produced this file cannot.
    shot_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    batch: Mapped[Batch] = relationship(back_populates="sequence_renders")


class TitleLook:
    """Everything about a Title except its words and its timing.

    A mixin because a Title and a Title Style carry exactly the same set: a
    Style *is* a Title's look and placement, saved under a name and without the
    text (ADR 0008). Keeping one definition is what stops the two drifting and
    leaving a Style that cannot describe a Title.

    Sizes are fractions rather than pixels wherever a font size scales them —
    `outline_width` at 0.08 is 8% of the font size, so making the text bigger
    thickens its outline the way a designer would expect. Everything measured
    against the frame is a percentage of it, so the same numbers survive if a
    second Format ever lands.
    """

    #: A family id from `fonts/catalog.json`, not a face name. Which file that
    #: resolves to is `app.services.fonts`' business, and depends on the weight.
    font_family: Mapped[str] = mapped_column(String, default="inter")
    font_weight: Mapped[int] = mapped_column(Integer, default=900)
    #: Synthesised on both sides rather than vendored as its own face (ADR 0008).
    italic: Mapped[bool] = mapped_column(Boolean, default=False)
    uppercase: Mapped[bool] = mapped_column(Boolean, default=False)
    #: Cap height and the rest scale from this: a percent of the frame's height.
    font_size_percent: Mapped[float] = mapped_column(Float, default=6.0)
    #: Tracking, as a fraction of the font size.
    letter_spacing: Mapped[float] = mapped_column(Float, default=0.0)
    color: Mapped[str] = mapped_column(String, default="#FFFFFF")
    opacity: Mapped[float] = mapped_column(Float, default=1.0)
    align: Mapped[str] = mapped_column(String, default="center")

    outline_color: Mapped[str] = mapped_column(String, default="#000000")
    #: A fraction of the font size. Zero is no outline at all.
    outline_width: Mapped[float] = mapped_column(Float, default=0.08)
    shadow_color: Mapped[str] = mapped_column(String, default="#000000")
    shadow_offset: Mapped[float] = mapped_column(Float, default=0.0)

    background: Mapped[str] = mapped_column(String, default=TITLE_BACKGROUND_NONE)
    background_color: Mapped[str] = mapped_column(String, default="#000000")
    background_opacity: Mapped[float] = mapped_column(Float, default=0.7)
    #: The box's padding, as a fraction of the font size.
    background_padding: Mapped[float] = mapped_column(Float, default=0.25)

    #: Where the text's centre sits, as a percent of the frame.
    center_x: Mapped[float] = mapped_column(Float, default=50.0)
    center_y: Mapped[float] = mapped_column(Float, default=30.0)
    #: How wide the text may run before it wraps, as a percent of the frame.
    width_percent: Mapped[float] = mapped_column(Float, default=80.0)
    rotation_deg: Mapped[float] = mapped_column(Float, default=0.0)


#: The columns `TitleLook` defines, in one place, so copying a Style onto a
#: Title and back again never has to name all twenty by hand. Read from the
#: annotations rather than a hand-kept list: a field added to the mixin and
#: forgotten here would apply a Style that silently left it behind.
TITLE_LOOK_FIELDS = tuple(TitleLook.__annotations__)


class TitleStyle(TitleLook, Base):
    """A saved look a Title can be made from, reusable across every Batch.

    Applying one copies its values; it does not bind them, so editing a Style
    leaves Titles already made from it alone (ADR 0008). Clip Farm's own
    built-in Styles are not rows here — they live in `app.services.titles`, so
    improving one is a release rather than a data migration.
    """

    __tablename__ = "title_styles"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class Phrase(TitleLook, Base):
    """Words saved whole — the text with its look and its place — to write again.

    A Title Style saves the look without the words, which is the right thing
    when the next Title says something else. A Phrase is for when it says the
    same thing: a sign-off, a location card, a call to action typed once and
    wanted verbatim on every Batch after (ADR 0008).

    It carries no name of its own. The words are the label — a Phrase named
    anything but what it says would be a second thing to keep in step with the
    first. And no timing: where a Phrase lands in a Sequence is a fact about
    that Sequence, not about the words.
    """

    __tablename__ = "phrases"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class Title(TitleLook, Base):
    """Text drawn over the picture for a span of a Batch's Sequence.

    It belongs to the Batch rather than to a Clip, and its times are Sequence
    milliseconds rather than offsets into anything: a hook written for the first
    three seconds stays at the first three seconds when the Shots underneath are
    reordered (ADR 0008).

    A Title crossing a cut is not composited over the joined video. It is sliced
    at the segment boundaries it crosses and burned into each piece, which is
    what leaves ADR 0003's join untouched.
    """

    __tablename__ = "titles"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    batch_id: Mapped[str] = mapped_column(
        ForeignKey("batches.id", ondelete="CASCADE"), index=True
    )
    text: Mapped[str] = mapped_column(Text, default="")
    start_ms: Mapped[int] = mapped_column(Integer, default=0)
    end_ms: Mapped[int] = mapped_column(Integer, default=3000)
    # Full-Sequence layers created by the editor and Layer Profiles follow a
    # moving Sequence end until the operator explicitly retimes their end.
    end_at_sequence_end: Mapped[bool] = mapped_column(Boolean, default=False)
    #: Which Style this was made from, for the label alone. Nulled rather than
    #: cascaded when that Style is deleted: the look is already copied here, so
    #: the Title is unaffected by losing the name it came from.
    style_id: Mapped[str | None] = mapped_column(
        ForeignKey("title_styles.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    batch: Mapped["Batch"] = relationship(back_populates="titles")

    @property
    def duration_ms(self) -> int:
        return max(0, self.end_ms - self.start_ms)


class BatchMedia(Base):
    """A still image drawn over a span of a Batch's finished Sequence."""

    __tablename__ = "batch_media"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    batch_id: Mapped[str] = mapped_column(
        ForeignKey("batches.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String)
    path: Mapped[str] = mapped_column(String)
    mime_type: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    start_ms: Mapped[int] = mapped_column(Integer, default=0)
    end_ms: Mapped[int] = mapped_column(Integer)
    end_at_sequence_end: Mapped[bool] = mapped_column(Boolean, default=False)
    center_x: Mapped[float] = mapped_column(Float, default=50.0)
    center_y: Mapped[float] = mapped_column(Float, default=50.0)
    width_percent: Mapped[float] = mapped_column(Float, default=65.0)
    rotation_deg: Mapped[float] = mapped_column(Float, default=0.0)
    opacity: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    batch: Mapped["Batch"] = relationship(back_populates="media")


class LayerProfile(Base):
    """A named arrangement of Titles and Sequence images, reusable by any Batch.

    Timing deliberately does not live here. Applying a profile gives every
    saved layer the target Sequence's whole span, so an eight-second source and
    an eighty-second source use the same arrangement without stale end times.
    """

    __tablename__ = "layer_profiles"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String, unique=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    titles: Mapped[list["LayerProfileTitle"]] = relationship(
        back_populates="profile",
        cascade="all, delete-orphan",
        order_by="LayerProfileTitle.position",
    )
    media: Mapped[list["LayerProfileMedia"]] = relationship(
        back_populates="profile",
        cascade="all, delete-orphan",
        order_by="LayerProfileMedia.position",
    )


class LayerProfileTitle(TitleLook, Base):
    """One Title saved in a Layer Profile, without Sequence timing."""

    __tablename__ = "layer_profile_titles"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    profile_id: Mapped[str] = mapped_column(
        ForeignKey("layer_profiles.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text, default="")

    profile: Mapped["LayerProfile"] = relationship(back_populates="titles")


class LayerProfileMedia(Base):
    """One independently stored Sequence image in a Layer Profile."""

    __tablename__ = "layer_profile_media"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    profile_id: Mapped[str] = mapped_column(
        ForeignKey("layer_profiles.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(String)
    path: Mapped[str] = mapped_column(String)
    mime_type: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    center_x: Mapped[float] = mapped_column(Float, default=50.0)
    center_y: Mapped[float] = mapped_column(Float, default=50.0)
    width_percent: Mapped[float] = mapped_column(Float, default=65.0)
    rotation_deg: Mapped[float] = mapped_column(Float, default=0.0)
    opacity: Mapped[float] = mapped_column(Float, default=1.0)

    profile: Mapped["LayerProfile"] = relationship(back_populates="media")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    mode: Mapped[str] = mapped_column(String, default=MODE_X_TO_VERTICAL, index=True)
    origin_kind: Mapped[str] = mapped_column(String, default=ORIGIN_KIND_X, index=True)
    batch_id: Mapped[str | None] = mapped_column(
        ForeignKey("batches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Empty for uploads, which have no Origin URL. Serialization turns the empty
    # string back into null at the API boundary.
    source_url: Mapped[str] = mapped_column(String, default="", index=True)
    source_post_id: Mapped[str] = mapped_column(String, default="", index=True)
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
    batch: Mapped["Batch | None"] = relationship(back_populates="clips")
    # Deleting a Clip takes its Shots out of the Sequence with it.
    shots: Mapped[list["Shot"]] = relationship(
        back_populates="clip", cascade="all, delete-orphan"
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
