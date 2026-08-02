"""Batch CRUD and the multi-file upload that fills a Batch with Clips."""

from datetime import datetime, timezone
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
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
    Shot,
    new_id,
)
from app.schemas import (
    BatchCreate,
    BatchOut,
    BatchSummaryOut,
    BatchUpdate,
    BatchUploadOut,
    DeletionOut,
    ShotCreate,
    ShotMove,
)
from app.services.upload import UploadRejected, clip_title, source_suffix, store_source_video
from app.tasks import import_upload_task

from app.routers._helpers import (
    batch_clips,
    batch_shots,
    ensure_project_can_be_deleted,
    get_batch_or_404,
    remove_project_files,
    renumber_shots,
    serialize_batch,
    summarize_batch,
)


settings = get_settings()
logger = logging.getLogger(__name__)

router = APIRouter()

# One request cannot start an unbounded number of imports. The cap is per
# request, not per Batch: drop another set of files to keep going.
MAX_UPLOADS_PER_REQUEST = 25


@router.post(f"{settings.api_prefix}/batches", response_model=BatchOut, status_code=201)
def create_batch(payload: BatchCreate, session: Session = Depends(get_db)) -> BatchOut:
    batch = Batch(name=payload.name)
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
    """Put a Clip at the end of the Sequence.

    Being in a Batch and being in its Sequence are different things: uploading
    a video is not the same act as deciding it makes the cut.
    """
    batch = get_batch_or_404(session, batch_id)
    clip = session.get(Project, payload.clip_id)
    if not clip or clip.batch_id != batch.id:
        raise HTTPException(status_code=404, detail="That clip is not in this batch")
    if clip.shot:
        raise HTTPException(
            status_code=409, detail="That clip is already in the sequence"
        )
    shots = batch_shots(session, batch.id)
    session.add(Shot(batch_id=batch.id, project_id=clip.id, position=len(shots)))
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
def move_shot(
    batch_id: str, shot_id: str, payload: ShotMove, session: Session = Depends(get_db)
) -> BatchOut:
    """Move a Shot to a position, sliding everything between it and there."""
    batch = get_batch_or_404(session, batch_id)
    shots = batch_shots(session, batch.id)
    shot = next((item for item in shots if item.id == shot_id), None)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")
    # Past the end means the end, rather than an error the UI would have to
    # pre-empt by knowing the length.
    target = min(payload.position, len(shots) - 1)
    shots.remove(shot)
    shots.insert(target, shot)
    renumber_shots(shots)
    return _touch(session, batch)


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
