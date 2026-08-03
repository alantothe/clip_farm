"""Still images timed against a Batch's assembled Sequence."""

from datetime import datetime, timezone
from pathlib import Path
import shutil

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import BatchMedia
from app.schemas import BatchMediaFromStorageCreate, BatchMediaUpdate, BatchOut
from app.services.media import MediaProcessingError, validate_overlay_image
from app.routers._helpers import (
    batch_shots,
    get_batch_or_404,
    serialize_batch,
    stored_image_or_404,
)


settings = get_settings()
router = APIRouter()

MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def _sequence_duration_ms(session: Session, batch_id: str) -> int:
    total = 0
    for shot in batch_shots(session, batch_id):
        start, end = shot.span()
        if end is not None:
            total += max(0, end - start)
    return total


def _media_or_404(session: Session, batch_id: str, media_id: str) -> BatchMedia:
    item = session.get(BatchMedia, media_id)
    if not item or item.batch_id != batch_id:
        raise HTTPException(status_code=404, detail="Image not found")
    return item


def _touch(session: Session, batch_id: str) -> BatchOut:
    batch = get_batch_or_404(session, batch_id)
    batch.updated_at = datetime.now(timezone.utc)
    session.commit()
    return serialize_batch(session, batch)


@router.post(
    f"{settings.api_prefix}/batches/{{batch_id}}/media",
    response_model=BatchOut,
    status_code=201,
)
async def upload_batch_media(
    batch_id: str,
    image: UploadFile = File(),
    end_ms: int | None = Form(default=None),
    session: Session = Depends(get_db),
) -> BatchOut:
    """Upload a still image and initially fill the whole Sequence with it."""
    batch = get_batch_or_404(session, batch_id)
    duration = _sequence_duration_ms(session, batch.id)
    if duration < 400:
        raise HTTPException(status_code=409, detail="Add a video before adding media")

    suffix = ALLOWED_IMAGE_TYPES.get(image.content_type or "")
    if not suffix:
        raise HTTPException(status_code=415, detail="Use a JPG, PNG, or WebP image")

    requested_end = duration if end_ms is None else end_ms
    if requested_end < 400:
        raise HTTPException(status_code=422, detail="An image must stay on screen for a moment")
    # The server's Sequence is authoritative; a stale browser cannot create an
    # image past the current end after a concurrent timeline edit.
    end = min(duration, requested_end)

    item = BatchMedia(
        batch_id=batch.id,
        name=Path(image.filename or "Image").name[:120],
        path="",
        mime_type=image.content_type or "image/jpeg",
        end_ms=end,
        end_at_sequence_end=True,
    )
    session.add(item)
    session.flush()
    media_dir = settings.batches_dir / batch.id / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    image_path = media_dir / f"{item.id}{suffix}"

    size = 0
    try:
        with image_path.open("wb") as output:
            while chunk := await image.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_IMAGE_BYTES:
                    raise HTTPException(status_code=413, detail="Images must be 10 MB or smaller")
                output.write(chunk)
        if size == 0:
            raise HTTPException(status_code=422, detail="The uploaded image is empty")
        try:
            validate_overlay_image(image_path)
        except MediaProcessingError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        item.path = str(image_path)
        item.size_bytes = size
        return _touch(session, batch.id)
    except Exception:
        image_path.unlink(missing_ok=True)
        session.rollback()
        raise


@router.post(
    f"{settings.api_prefix}/batches/{{batch_id}}/media/from-storage",
    response_model=BatchOut,
    status_code=201,
)
def add_batch_media_from_storage(
    batch_id: str,
    payload: BatchMediaFromStorageCreate,
    session: Session = Depends(get_db),
) -> BatchOut:
    """Copy one reusable image into a Sequence-level placement."""
    batch = get_batch_or_404(session, batch_id)
    duration = _sequence_duration_ms(session, batch.id)
    if duration < 400:
        raise HTTPException(status_code=409, detail="Add a video before adding media")
    requested_end = duration if payload.end_ms is None else payload.end_ms
    if requested_end < 400:
        raise HTTPException(status_code=422, detail="An image must stay on screen for a moment")
    end = min(duration, requested_end)

    stored = stored_image_or_404(session, payload.storage_image_id)
    source_path = Path(stored.path)
    if not source_path.is_file():
        raise HTTPException(status_code=404, detail="Stored image file not found")

    item = BatchMedia(
        batch_id=batch.id,
        name=stored.name,
        path="",
        mime_type=stored.mime_type,
        size_bytes=stored.size_bytes,
        end_ms=end,
        end_at_sequence_end=True,
    )
    session.add(item)
    session.flush()
    media_dir = settings.batches_dir / batch.id / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    suffix = ALLOWED_IMAGE_TYPES.get(stored.mime_type) or source_path.suffix
    image_path = media_dir / f"{item.id}{suffix}"
    try:
        shutil.copy2(source_path, image_path)
        item.path = str(image_path)
        return _touch(session, batch.id)
    except Exception:
        image_path.unlink(missing_ok=True)
        session.rollback()
        raise


@router.patch(
    f"{settings.api_prefix}/batches/{{batch_id}}/media/{{media_id}}",
    response_model=BatchOut,
)
def update_batch_media(
    batch_id: str,
    media_id: str,
    payload: BatchMediaUpdate,
    session: Session = Depends(get_db),
) -> BatchOut:
    item = _media_or_404(session, batch_id, media_id)
    sent = payload.model_fields_set
    start = payload.start_ms if payload.start_ms is not None else item.start_ms
    end = payload.end_ms if payload.end_ms is not None else item.end_ms
    if ("start_ms" in sent or "end_ms" in sent) and end <= start:
        raise HTTPException(status_code=422, detail="An image has to end after it starts")
    duration = _sequence_duration_ms(session, batch_id)
    if start >= duration or end > duration:
        raise HTTPException(status_code=422, detail="Keep the image inside the timeline")

    for field in (
        "start_ms",
        "end_ms",
        "center_x",
        "center_y",
        "width_percent",
        "rotation_deg",
        "opacity",
    ):
        value = getattr(payload, field)
        if field in sent and value is not None:
            setattr(item, field, value)
    if "end_ms" in sent:
        item.end_at_sequence_end = False
    return _touch(session, batch_id)


@router.delete(
    f"{settings.api_prefix}/batches/{{batch_id}}/media/{{media_id}}",
    response_model=BatchOut,
)
def remove_batch_media(
    batch_id: str, media_id: str, session: Session = Depends(get_db)
) -> BatchOut:
    item = _media_or_404(session, batch_id, media_id)
    path = Path(item.path)
    session.delete(item)
    output = _touch(session, batch_id)
    path.unlink(missing_ok=True)
    return output


@router.get(f"{settings.api_prefix}/batches/{{batch_id}}/media/{{media_id}}/file")
def get_batch_media_file(
    batch_id: str, media_id: str, session: Session = Depends(get_db)
) -> FileResponse:
    item = _media_or_404(session, batch_id, media_id)
    path = Path(item.path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Image file not found")
    return FileResponse(path, media_type=item.mime_type, filename=item.name)
