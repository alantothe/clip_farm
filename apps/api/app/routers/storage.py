"""Global reusable image Storage."""

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import StoredImage
from app.routers._helpers import stored_image_or_404
from app.schemas import DeletionOut, StoredImageOut
from app.services.media import MediaProcessingError, validate_overlay_image


settings = get_settings()
router = APIRouter()

MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def _serialize(image: StoredImage) -> StoredImageOut:
    output = StoredImageOut.model_validate(image)
    output.url = f"{settings.api_prefix}/storage/images/{image.id}/file"
    return output


@router.get(
    f"{settings.api_prefix}/storage/images",
    response_model=list[StoredImageOut],
)
def list_stored_images(session: Session = Depends(get_db)) -> list[StoredImageOut]:
    images = session.scalars(
        select(StoredImage).order_by(StoredImage.created_at.desc())
    ).all()
    return [_serialize(image) for image in images]


@router.post(
    f"{settings.api_prefix}/storage/images",
    response_model=StoredImageOut,
    status_code=201,
)
async def upload_stored_image(
    image: UploadFile = File(),
    session: Session = Depends(get_db),
) -> StoredImageOut:
    suffix = ALLOWED_IMAGE_TYPES.get(image.content_type or "")
    if not suffix:
        raise HTTPException(status_code=415, detail="Use a JPG, PNG, or WebP image")

    stored = StoredImage(
        name=Path(image.filename or "Image").name[:120],
        path="",
        mime_type=image.content_type or "image/jpeg",
    )
    session.add(stored)
    session.flush()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    image_path = settings.storage_dir / f"{stored.id}{suffix}"
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
        stored.path = str(image_path)
        stored.size_bytes = size
        session.commit()
        return _serialize(stored)
    except Exception:
        image_path.unlink(missing_ok=True)
        session.rollback()
        raise


@router.delete(
    f"{settings.api_prefix}/storage/images/{{image_id}}",
    response_model=DeletionOut,
)
def delete_stored_image(
    image_id: str,
    session: Session = Depends(get_db),
) -> DeletionOut:
    image = stored_image_or_404(session, image_id)
    path = Path(image.path)
    session.delete(image)
    session.commit()
    # Placements own copies, so cleaning Storage never removes an image from
    # an existing Clip or Sequence.
    path.unlink(missing_ok=True)
    return DeletionOut(deleted=1)


@router.get(f"{settings.api_prefix}/storage/images/{{image_id}}/file")
def get_stored_image_file(
    image_id: str,
    session: Session = Depends(get_db),
) -> FileResponse:
    image = stored_image_or_404(session, image_id)
    path = Path(image.path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Stored image file not found")
    return FileResponse(path, media_type=image.mime_type, filename=image.name)
