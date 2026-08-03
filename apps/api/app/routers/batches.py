"""Batch CRUD, the multi-file upload that fills a Batch with Clips, the
Sequence that orders them, and the export that joins them into one video."""

from datetime import datetime, timezone
from pathlib import Path
import logging
import re

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import (
    MODE_BATCH_PROCESS,
    ORIGIN_KIND_UPLOAD,
    Artifact,
    Batch,
    Job,
    Project,
    SequenceRender,
    Shot,
    new_id,
)
from app.schemas import (
    BatchCreate,
    BatchOut,
    BatchSummaryOut,
    BatchUpdate,
    BatchUploadOut,
    CutawayCreate,
    CutawayUpdate,
    DeletionOut,
    SequenceRenderOut,
    ShotCreate,
    ShotUpdate,
)
from app.services.upload import UploadRejected, clip_title, source_suffix, store_source_video
from app.tasks import import_upload_task, render_sequence_task

from app.routers._helpers import (
    batch_clips,
    batch_cutaways,
    batch_shots,
    ensure_project_can_be_deleted,
    get_batch_or_404,
    latest_sequence_render,
    remove_project_files,
    renumber_shots,
    serialize_batch,
    serialize_sequence_render,
    summarize_batch,
)


settings = get_settings()
logger = logging.getLogger(__name__)

router = APIRouter()

# One request cannot start an unbounded number of imports. The cap is per
# request, not per Batch: drop another set of files to keep going.
MAX_UPLOADS_PER_REQUEST = 25

# An export already running holds the Batch; a second would fight it for files.
ACTIVE_SEQUENCE_STATUSES = {"queued", "running"}


def _download_name(batch_name: str) -> str:
    """A batch name turned into something safe to send as a filename."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", batch_name).strip("-.")
    return cleaned[:80] or "clip-farm-sequence"


@router.post(f"{settings.api_prefix}/batches", response_model=BatchOut, status_code=201)
def create_batch(payload: BatchCreate, session: Session = Depends(get_db)) -> BatchOut:
    batch = Batch(name=payload.name, format=payload.format)
    session.add(batch)
    session.commit()
    return serialize_batch(session, batch)


@router.get(f"{settings.api_prefix}/batches", response_model=list[BatchSummaryOut])
def list_batches(session: Session = Depends(get_db)) -> list[BatchSummaryOut]:
    batches = session.scalars(
        select(Batch).order_by(Batch.created_at.desc()).limit(50)
    ).all()
    return [summarize_batch(batch, batch_clips(session, batch.id)) for batch in batches]


@router.get(f"{settings.api_prefix}/batches/{{batch_id}}", response_model=BatchOut)
def get_batch(batch_id: str, session: Session = Depends(get_db)) -> BatchOut:
    return serialize_batch(session, get_batch_or_404(session, batch_id))


@router.patch(f"{settings.api_prefix}/batches/{{batch_id}}", response_model=BatchOut)
def rename_batch(
    batch_id: str, payload: BatchUpdate, session: Session = Depends(get_db)
) -> BatchOut:
    batch = get_batch_or_404(session, batch_id)
    batch.name = payload.name
    session.commit()
    return serialize_batch(session, batch)


@router.delete(f"{settings.api_prefix}/batches/{{batch_id}}", response_model=DeletionOut)
def delete_batch(batch_id: str, session: Session = Depends(get_db)) -> DeletionOut:
    """Delete a Batch and every Clip in it.

    Refuses the whole Batch if any one Clip is mid-import or mid-render, for the
    same reason deleting a single Clip does: the worker still holds its files.
    """
    batch = get_batch_or_404(session, batch_id)
    clips = batch_clips(session, batch.id)
    for clip in clips:
        ensure_project_can_be_deleted(clip)
    clip_ids = [clip.id for clip in clips]
    for clip in clips:
        session.delete(clip)
    session.delete(batch)
    session.commit()
    for clip_id in clip_ids:
        remove_project_files(clip_id)
    return DeletionOut(deleted=len(clip_ids))


def _reject_inverted_trim(start_ms: int | None, end_ms: int | None) -> None:
    """A Shot that ends before it starts renders nothing and fails late.

    Caught here rather than at export, where the operator has already waited
    for every other Shot to render.
    """
    if start_ms is not None and end_ms is not None and end_ms <= start_ms:
        raise HTTPException(status_code=422, detail="A shot has to end after it starts")


def _touch(session: Session, batch: Batch) -> BatchOut:
    """Stamp the Batch as edited and hand back its current state."""
    batch.updated_at = datetime.now(timezone.utc)
    session.commit()
    return serialize_batch(session, batch)


@router.post(
    f"{settings.api_prefix}/batches/{{batch_id}}/shots",
    response_model=BatchOut,
    status_code=201,
)
def add_shot(
    batch_id: str, payload: ShotCreate, session: Session = Depends(get_db)
) -> BatchOut:
    """Put a Clip in the Sequence, at the end unless told where.

    Being in a Batch and being in its Sequence are different things: uploading
    a video is not the same act as deciding it makes the cut. A Clip can be
    placed more than once (ADR 0004), so placing one is never a conflict.
    """
    batch = get_batch_or_404(session, batch_id)
    clip = session.get(Project, payload.clip_id)
    if not clip or clip.batch_id != batch.id:
        raise HTTPException(status_code=404, detail="That clip is not in this batch")
    _reject_inverted_trim(payload.trim_start_ms, payload.trim_end_ms)
    # Close any gap first. Deleting a Clip elsewhere leaves its position behind,
    # and appending at len() would then land on top of a Shot that is still
    # there — positions 0 and 2 make the next Shot a second 2.
    shots = batch_shots(session, batch.id)
    renumber_shots(shots)
    shot = Shot(
        batch_id=batch.id,
        project_id=clip.id,
        trim_start_ms=payload.trim_start_ms,
        trim_end_ms=payload.trim_end_ms,
        frame_zoom=payload.frame_zoom,
        frame_center_x=payload.frame_center_x,
        frame_center_y=payload.frame_center_y,
    )
    # Past the end means the end, as it does when moving a Shot.
    target = len(shots) if payload.position is None else min(payload.position, len(shots))
    shots.insert(target, shot)
    session.add(shot)
    renumber_shots(shots)
    return _touch(session, batch)


@router.delete(
    f"{settings.api_prefix}/batches/{{batch_id}}/shots/{{shot_id}}",
    response_model=BatchOut,
)
def remove_shot(batch_id: str, shot_id: str, session: Session = Depends(get_db)) -> BatchOut:
    """Take a Shot out of the Sequence. The Clip stays in the Batch."""
    batch = get_batch_or_404(session, batch_id)
    shots = batch_shots(session, batch.id)
    shot = next((item for item in shots if item.id == shot_id), None)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")
    shots.remove(shot)
    session.delete(shot)
    renumber_shots(shots)
    return _touch(session, batch)


@router.patch(
    f"{settings.api_prefix}/batches/{{batch_id}}/shots/{{shot_id}}",
    response_model=BatchOut,
)
def update_shot(
    batch_id: str, shot_id: str, payload: ShotUpdate, session: Session = Depends(get_db)
) -> BatchOut:
    """Move, trim, or frame a Shot on the Timeline.

    A trim sent as null resets the Shot to following its Clip's Trim, so absent
    and null mean different things and `model_fields_set` is what tells them
    apart.
    """
    batch = get_batch_or_404(session, batch_id)
    shots = batch_shots(session, batch.id)
    shot = next((item for item in shots if item.id == shot_id), None)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")

    sent = payload.model_fields_set
    start = payload.trim_start_ms if "trim_start_ms" in sent else shot.trim_start_ms
    end = payload.trim_end_ms if "trim_end_ms" in sent else shot.trim_end_ms
    if "trim_start_ms" in sent or "trim_end_ms" in sent:
        # Compare what the Shot will actually play, since half an override
        # falls back to the Clip for the other half.
        clip = shot.clip
        _reject_inverted_trim(
            start if start is not None else clip.trim_start_ms,
            end if end is not None else (clip.trim_end_ms or clip.duration_ms),
        )
        shot.trim_start_ms = start
        shot.trim_end_ms = end

    for field in ("frame_zoom", "frame_center_x", "frame_center_y"):
        if field in sent and getattr(payload, field) is not None:
            setattr(shot, field, getattr(payload, field))

    if payload.position is not None:
        # Past the end means the end, rather than an error the UI would have to
        # pre-empt by knowing the length.
        target = min(payload.position, len(shots) - 1)
        shots.remove(shot)
        shots.insert(target, shot)
        renumber_shots(shots)
    return _touch(session, batch)


def _get_cutaway_or_404(session: Session, batch: Batch, cutaway_id: str) -> Shot:
    cutaway = session.get(Shot, cutaway_id)
    if not cutaway or cutaway.batch_id != batch.id or not cutaway.is_cutaway:
        raise HTTPException(status_code=404, detail="Cutaway not found")
    return cutaway


def _get_base_shot_or_404(session: Session, batch: Batch, base_shot_id: str) -> Shot:
    base = session.get(Shot, base_shot_id)
    if not base or base.batch_id != batch.id:
        raise HTTPException(status_code=404, detail="That shot is not in this batch")
    if base.is_cutaway:
        # Nesting would make "what is on screen here" have two answers.
        raise HTTPException(status_code=422, detail="A cutaway cannot cover another cutaway")
    return base


def _span_ms(clip: Project, trim_start_ms: int | None, trim_end_ms: int | None) -> int:
    """How long a Shot of this Clip would play, before it exists to be asked."""
    start = trim_start_ms if trim_start_ms is not None else clip.trim_start_ms
    end = trim_end_ms if trim_end_ms is not None else (clip.trim_end_ms or clip.duration_ms)
    if end is None or end <= start:
        return 0
    return end - start


def _reject_overlap(
    base: Shot, *, offset_ms: int, length_ms: int, ignore_id: str | None = None
) -> None:
    """Two Cutaways on one Base Shot cannot claim the same stretch.

    Overlapping would leave the flattening in `plan_segments` with no defined
    answer for which picture wins. Touching is fine — one ending exactly where
    the next begins covers no millisecond twice.
    """
    for other in base.cutaways:
        if other.id == ignore_id:
            continue
        other_start, other_end = other.span()
        if other_end is None or other_end <= other_start:
            continue
        other_offset = other.offset_ms or 0
        starts_before_other_ends = offset_ms < other_offset + (other_end - other_start)
        if starts_before_other_ends and other_offset < offset_ms + length_ms:
            raise HTTPException(
                status_code=409,
                detail=f"“{other.clip.title}” already covers that part of this shot",
            )


@router.post(
    f"{settings.api_prefix}/batches/{{batch_id}}/cutaways",
    response_model=BatchOut,
    status_code=201,
)
def add_cutaway(
    batch_id: str, payload: CutawayCreate, session: Session = Depends(get_db)
) -> BatchOut:
    """Cover a Shot with a Clip for a span.

    A Cutaway is anchored to the Shot it covers rather than to a clock time, so
    reordering the Sequence carries it along with the moment it was placed over
    (ADR 0005).
    """
    batch = get_batch_or_404(session, batch_id)
    clip = session.get(Project, payload.clip_id)
    if not clip or clip.batch_id != batch.id:
        raise HTTPException(status_code=404, detail="That clip is not in this batch")
    base = _get_base_shot_or_404(session, batch, payload.base_shot_id)
    _reject_inverted_trim(payload.trim_start_ms, payload.trim_end_ms)

    _reject_overlap(
        base,
        offset_ms=payload.offset_ms,
        length_ms=_span_ms(clip, payload.trim_start_ms, payload.trim_end_ms),
    )
    session.add(
        Shot(
            batch_id=batch.id,
            project_id=clip.id,
            parent_shot_id=base.id,
            offset_ms=payload.offset_ms,
            trim_start_ms=payload.trim_start_ms,
            trim_end_ms=payload.trim_end_ms,
            frame_zoom=payload.frame_zoom,
            frame_center_x=payload.frame_center_x,
            frame_center_y=payload.frame_center_y,
        )
    )
    return _touch(session, batch)


@router.patch(
    f"{settings.api_prefix}/batches/{{batch_id}}/cutaways/{{cutaway_id}}",
    response_model=BatchOut,
)
def update_cutaway(
    batch_id: str, cutaway_id: str, payload: CutawayUpdate, session: Session = Depends(get_db)
) -> BatchOut:
    """Move, re-anchor, trim, or frame a Cutaway."""
    batch = get_batch_or_404(session, batch_id)
    cutaway = _get_cutaway_or_404(session, batch, cutaway_id)

    sent = payload.model_fields_set
    if "trim_start_ms" in sent or "trim_end_ms" in sent:
        start = payload.trim_start_ms if "trim_start_ms" in sent else cutaway.trim_start_ms
        end = payload.trim_end_ms if "trim_end_ms" in sent else cutaway.trim_end_ms
        clip = cutaway.clip
        _reject_inverted_trim(
            start if start is not None else clip.trim_start_ms,
            end if end is not None else (clip.trim_end_ms or clip.duration_ms),
        )
        cutaway.trim_start_ms = start
        cutaway.trim_end_ms = end

    for field in ("frame_zoom", "frame_center_x", "frame_center_y"):
        if field in sent and getattr(payload, field) is not None:
            setattr(cutaway, field, getattr(payload, field))

    base = (
        _get_base_shot_or_404(session, batch, payload.base_shot_id)
        if payload.base_shot_id is not None
        else cutaway.base_shot
    )
    offset = payload.offset_ms if payload.offset_ms is not None else (cutaway.offset_ms or 0)
    if base is not None:
        _reject_overlap(
            base,
            offset_ms=offset,
            length_ms=_span_ms(cutaway.clip, cutaway.trim_start_ms, cutaway.trim_end_ms),
            ignore_id=cutaway.id,
        )
        cutaway.parent_shot_id = base.id
    cutaway.offset_ms = offset
    return _touch(session, batch)


@router.delete(
    f"{settings.api_prefix}/batches/{{batch_id}}/cutaways/{{cutaway_id}}",
    response_model=BatchOut,
)
def remove_cutaway(
    batch_id: str, cutaway_id: str, session: Session = Depends(get_db)
) -> BatchOut:
    """Uncover the Shot. The Clip stays in the Batch."""
    batch = get_batch_or_404(session, batch_id)
    cutaway = _get_cutaway_or_404(session, batch, cutaway_id)
    session.delete(cutaway)
    return _touch(session, batch)


@router.post(
    f"{settings.api_prefix}/batches/{{batch_id}}/render",
    response_model=SequenceRenderOut,
    status_code=202,
)
def render_sequence(batch_id: str, session: Session = Depends(get_db)) -> SequenceRenderOut:
    """Join the Batch's Sequence into one video.

    Every Shot's Clip has to be ready: a Clip still importing has no Source
    Video to render from, and one that failed has nothing usable at all.
    """
    batch = get_batch_or_404(session, batch_id)
    shots = batch_shots(session, batch.id)
    if not shots:
        raise HTTPException(
            status_code=422, detail="Add at least one clip to the timeline first"
        )
    existing = latest_sequence_render(batch)
    if existing and existing.status in ACTIVE_SEQUENCE_STATUSES:
        raise HTTPException(status_code=409, detail="This batch is already exporting")
    # A Cutaway's Clip has to be ready too — it is rendered like any other, just
    # as part of the Shot it covers rather than on its own.
    placed = shots + batch_cutaways(session, batch.id)
    unready = [shot.clip for shot in placed if shot.clip.status != "ready"]
    if unready:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Wait for “{unready[0].title}” to finish importing before exporting"
                if unready[0].status in {"queued", "processing"}
                else f"“{unready[0].title}” failed to import — remove it from the timeline"
            ),
        )

    sequence_render = SequenceRender(
        batch_id=batch.id,
        shot_count=len(shots),
        message="Queued for export",
    )
    session.add(sequence_render)
    batch.updated_at = datetime.now(timezone.utc)
    session.commit()

    # Queued after the commit, so the worker can load what it was handed.
    render_sequence_task(batch.id, sequence_render.id)
    return serialize_sequence_render(sequence_render)


@router.get(
    f"{settings.api_prefix}/batches/{{batch_id}}/render",
    response_model=SequenceRenderOut,
)
def get_sequence_render(batch_id: str, session: Session = Depends(get_db)) -> SequenceRenderOut:
    """Poll the Batch's most recent export."""
    batch = get_batch_or_404(session, batch_id)
    sequence_render = latest_sequence_render(batch)
    if not sequence_render:
        raise HTTPException(status_code=404, detail="This batch has not been exported")
    return serialize_sequence_render(sequence_render)


@router.get(f"{settings.api_prefix}/batches/{{batch_id}}/render/download")
def download_sequence_render(batch_id: str, session: Session = Depends(get_db)) -> FileResponse:
    batch = get_batch_or_404(session, batch_id)
    sequence_render = latest_sequence_render(batch)
    if not sequence_render or sequence_render.status != "complete" or not sequence_render.path:
        raise HTTPException(status_code=404, detail="Completed export not found")
    path = Path(sequence_render.path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Exported file is missing")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=f"{_download_name(batch.name)}.mp4",
    )


@router.post(
    f"{settings.api_prefix}/batches/{{batch_id}}/uploads",
    response_model=BatchUploadOut,
    status_code=202,
)
async def upload_clips(
    batch_id: str,
    videos: list[UploadFile] = File(),
    session: Session = Depends(get_db),
) -> BatchUploadOut:
    """Add one Clip per uploaded video and queue an Import for each.

    Files are handled independently: one unreadable video is reported in
    `rejected` while the rest still import, because re-picking twelve files
    because the thirteenth was a screenshot is not worth anyone's afternoon.
    """
    batch = get_batch_or_404(session, batch_id)
    if not videos:
        raise HTTPException(status_code=422, detail="Choose at least one video")
    if len(videos) > MAX_UPLOADS_PER_REQUEST:
        raise HTTPException(
            status_code=422,
            detail=f"Add up to {MAX_UPLOADS_PER_REQUEST} videos at a time",
        )

    rejected: list[str] = []
    queued: list[tuple[str, str]] = []
    # Clip ids are minted here rather than by a flush, so a file can be written
    # to its final home before any row exists. Rejecting the fifth video then
    # costs nothing: there is no partial row to roll back, and rolling back
    # would take the four Clips already accepted in this request with it.
    stored_clip_ids: list[str] = []

    try:
        for video in videos:
            try:
                suffix = source_suffix(video.filename)
            except UploadRejected as exc:
                rejected.append(str(exc))
                continue

            clip_id = new_id()
            destination = settings.projects_dir / clip_id / f"source{suffix}"
            try:
                size = await store_source_video(
                    video, destination, max_bytes=settings.max_source_bytes
                )
            except UploadRejected as exc:
                remove_project_files(clip_id)
                rejected.append(str(exc))
                continue
            stored_clip_ids.append(clip_id)

            clip = Project(
                id=clip_id,
                mode=MODE_BATCH_PROCESS,
                origin_kind=ORIGIN_KIND_UPLOAD,
                batch_id=batch.id,
                title=clip_title(video.filename),
            )
            # The source Artifact is written now so the worker can find the
            # Source Video without being told where it landed.
            job = Job(project_id=clip_id, kind="import", message="Queued for import")
            session.add(clip)
            session.add(
                Artifact(
                    project_id=clip_id,
                    kind="source",
                    path=str(destination),
                    mime_type=video.content_type or "video/mp4",
                    size_bytes=size,
                )
            )
            session.add(job)
            session.flush()
            queued.append((clip_id, job.id))
    except Exception:
        # Nothing has been committed, so the rows disappear on their own. The
        # files they pointed at will not.
        session.rollback()
        for clip_id in stored_clip_ids:
            remove_project_files(clip_id)
        logger.exception("Uploading videos into batch %s failed", batch.id)
        raise

    if not queued and rejected:
        raise HTTPException(status_code=415, detail=" ".join(rejected))

    batch.updated_at = datetime.now(timezone.utc)
    session.commit()

    # Queued only after the commit: a task that starts before its Clip is
    # visible to other connections would fail to load it.
    for clip_id, job_id in queued:
        import_upload_task(clip_id, job_id)

    return BatchUploadOut(
        batch=serialize_batch(session, batch),
        accepted=len(queued),
        rejected=rejected,
    )
