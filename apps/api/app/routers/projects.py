"""Project CRUD, captions, social caption, and image overlay routes."""

from datetime import datetime, timezone
import logging
from pathlib import Path
import shutil

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import (
    MODE_X_TO_VERTICAL,
    Artifact,
    ImageOverlay,
    Job,
    Project,
)
from app.schemas import (
    CaptionUpdateRequest,
    DeletionOut,
    ImageOverlayOut,
    ImageOverlayUpdate,
    ImportRequest,
    OverlayFromStorageCreate,
    ProjectOut,
    ProjectUpdate,
    SocialCaptionOut,
    SocialCaptionRewriteRequest,
    SocialCaptionUpdate,
)
from app.services.caption_rewrite import CaptionRewriteError, rewrite_social_caption
from app.services.media import MediaProcessingError, validate_overlay_image
from app.services.x_download import normalize_x_post_url
from app.tasks import import_project_task

from app.routers._helpers import (
    ensure_project_can_be_deleted,
    get_project_or_404,
    image_overlay_or_404,
    project_query,
    remove_project_files,
    serialize_project,
    stored_image_or_404,
)


settings = get_settings()
logger = logging.getLogger(__name__)

router = APIRouter()


def unbatched_clips():
    return project_query().where(Project.batch_id.is_(None))


@router.post(f"{settings.api_prefix}/projects/import", response_model=ProjectOut, status_code=202)
def import_project(payload: ImportRequest, session: Session = Depends(get_db)) -> ProjectOut:
    try:
        normalized_url, post_id = normalize_x_post_url(payload.url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    existing = session.scalar(
        project_query().where(Project.source_post_id == post_id).order_by(Project.created_at.desc())
    )
    if existing and existing.status != "failed":
        return serialize_project(existing)

    if existing:
        project = existing
        project.status = "queued"
        project.error_message = None
    else:
        project = Project(
            mode=MODE_X_TO_VERTICAL,
            source_url=normalized_url,
            source_post_id=post_id,
        )
        session.add(project)
        session.flush()
    job = Job(project_id=project.id, kind="import", message="Queued for import")
    session.add(job)
    session.commit()
    import_project_task(project.id, job.id)
    refreshed = get_project_or_404(session, project.id)
    return serialize_project(refreshed)


@router.get(f"{settings.api_prefix}/projects", response_model=list[ProjectOut])
def list_projects(session: Session = Depends(get_db)) -> list[ProjectOut]:
    """Every loose Clip, newest first.

    Clips inside a Batch are left out: they are presented by their Batch, and
    letting them into this list would put uploads in the X mode's rail.
    """
    projects = session.scalars(
        unbatched_clips().order_by(Project.created_at.desc()).limit(50)
    ).all()
    return [serialize_project(project) for project in projects]


@router.delete(f"{settings.api_prefix}/projects", response_model=DeletionOut)
def delete_all_projects(session: Session = Depends(get_db)) -> DeletionOut:
    """Clear every loose Clip. Batches are cleared one Batch at a time."""
    projects = list(session.scalars(unbatched_clips()).all())
    for project in projects:
        ensure_project_can_be_deleted(project)
    project_ids = [project.id for project in projects]
    for project in projects:
        session.delete(project)
    session.commit()
    for project_id in project_ids:
        remove_project_files(project_id)
    return DeletionOut(deleted=len(project_ids))


@router.get(f"{settings.api_prefix}/projects/{{project_id}}", response_model=ProjectOut)
def get_project(project_id: str, session: Session = Depends(get_db)) -> ProjectOut:
    return serialize_project(get_project_or_404(session, project_id))


@router.delete(f"{settings.api_prefix}/projects/{{project_id}}", response_model=DeletionOut)
def delete_project(project_id: str, session: Session = Depends(get_db)) -> DeletionOut:
    project = get_project_or_404(session, project_id)
    ensure_project_can_be_deleted(project)
    session.delete(project)
    session.commit()
    remove_project_files(project_id)
    return DeletionOut(deleted=1)


@router.patch(f"{settings.api_prefix}/projects/{{project_id}}", response_model=ProjectOut)
def update_project(
    project_id: str, payload: ProjectUpdate, session: Session = Depends(get_db)
) -> ProjectOut:
    project = get_project_or_404(session, project_id)
    updates = payload.model_dump(exclude_none=True)
    start = updates.get("trim_start_ms", project.trim_start_ms)
    end = updates.get("trim_end_ms", project.trim_end_ms)
    if end is not None and end <= start:
        raise HTTPException(status_code=422, detail="Trim end must be after trim start")
    if project.duration_ms is not None and end is not None and end > project.duration_ms:
        raise HTTPException(status_code=422, detail="Trim end exceeds source duration")
    for field, value in updates.items():
        setattr(project, field, value)
    session.commit()
    return serialize_project(get_project_or_404(session, project.id))


@router.put(f"{settings.api_prefix}/projects/{{project_id}}/captions", response_model=ProjectOut)
def update_captions(
    project_id: str, payload: CaptionUpdateRequest, session: Session = Depends(get_db)
) -> ProjectOut:
    project = get_project_or_404(session, project_id)
    by_id = {segment.id: segment for segment in project.captions}
    for update in payload.segments:
        segment = by_id.get(update.id)
        if not segment:
            raise HTTPException(status_code=422, detail=f"Caption segment {update.id} not found")
        if update.end_ms <= update.start_ms:
            raise HTTPException(status_code=422, detail="Caption end must be after its start")
        segment.text = update.text.strip()
        segment.start_ms = update.start_ms
        segment.end_ms = update.end_ms
        segment.edited = True
    project.updated_at = datetime.now(timezone.utc)
    session.commit()
    return serialize_project(get_project_or_404(session, project.id))


@router.put(
    f"{settings.api_prefix}/projects/{{project_id}}/social-caption",
    response_model=ProjectOut,
)
def update_social_caption(
    project_id: str, payload: SocialCaptionUpdate, session: Session = Depends(get_db)
) -> ProjectOut:
    project = get_project_or_404(session, project_id)
    project.social_caption = payload.text.strip()
    project.updated_at = datetime.now(timezone.utc)
    session.commit()
    return serialize_project(get_project_or_404(session, project.id))


@router.post(
    f"{settings.api_prefix}/projects/{{project_id}}/social-caption/rewrite",
    response_model=SocialCaptionOut,
)
def rewrite_project_social_caption(
    project_id: str,
    payload: SocialCaptionRewriteRequest,
    session: Session = Depends(get_db),
) -> SocialCaptionOut:
    project = get_project_or_404(session, project_id)
    try:
        rewritten = rewrite_social_caption(caption=payload.text, settings=settings)
    except CaptionRewriteError as exc:
        status_code = 503 if not settings.google_cloud_project else 502
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    project.social_caption = rewritten
    project.updated_at = datetime.now(timezone.utc)
    session.commit()
    return SocialCaptionOut(text=rewritten)


@router.post(
    f"{settings.api_prefix}/projects/{{project_id}}/image-overlays",
    response_model=ImageOverlayOut,
    status_code=201,
)
async def upload_image_overlay(
    project_id: str,
    image: UploadFile = File(),
    start_ms: int = Form(0),
    session: Session = Depends(get_db),
) -> ImageOverlayOut:
    project = get_project_or_404(session, project_id)
    duration = project.duration_ms or 0
    if duration < 100:
        raise HTTPException(status_code=409, detail="The source video is not ready")
    allowed_types = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }
    suffix = allowed_types.get(image.content_type or "")
    if not suffix:
        raise HTTPException(status_code=415, detail="Use a JPG, PNG, or WebP image")

    start = min(max(0, start_ms), duration - 100)
    end = min(duration, start + 3000)
    project_dir = settings.projects_dir / project.id / "overlays"
    project_dir.mkdir(parents=True, exist_ok=True)
    artifact = Artifact(
        project_id=project.id,
        kind="overlay_image",
        path="",
        mime_type=image.content_type or "image/jpeg",
        size_bytes=0,
    )
    session.add(artifact)
    session.flush()
    image_path = project_dir / f"{artifact.id}{suffix}"
    size = 0
    try:
        with image_path.open("wb") as output:
            while chunk := await image.read(1024 * 1024):
                size += len(chunk)
                if size > 10 * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="Images must be 10 MB or smaller")
                output.write(chunk)
        if size == 0:
            raise HTTPException(status_code=422, detail="The uploaded image is empty")
        try:
            validate_overlay_image(image_path)
        except MediaProcessingError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        artifact.path = str(image_path)
        artifact.size_bytes = size
        overlay = ImageOverlay(
            project_id=project.id,
            artifact_id=artifact.id,
            name=Path(image.filename or "Image").name[:120],
            start_ms=start,
            end_ms=end,
        )
        session.add(overlay)
        project.updated_at = datetime.now(timezone.utc)
        session.commit()
    except Exception:
        image_path.unlink(missing_ok=True)
        session.rollback()
        raise
    output = ImageOverlayOut.model_validate(overlay)
    output.url = f"{settings.api_prefix}/artifacts/{artifact.id}"
    return output


@router.post(
    f"{settings.api_prefix}/projects/{{project_id}}/image-overlays/from-storage",
    response_model=ImageOverlayOut,
    status_code=201,
)
def add_image_overlay_from_storage(
    project_id: str,
    payload: OverlayFromStorageCreate,
    session: Session = Depends(get_db),
) -> ImageOverlayOut:
    """Copy one reusable image into a Clip as an independent Overlay."""
    project = get_project_or_404(session, project_id)
    duration = project.duration_ms or 0
    if duration < 100:
        raise HTTPException(status_code=409, detail="The source video is not ready")
    stored = stored_image_or_404(session, payload.storage_image_id)
    source_path = Path(stored.path)
    if not source_path.is_file():
        raise HTTPException(status_code=404, detail="Stored image file not found")

    start = min(max(0, payload.start_ms), duration - 100)
    end = min(duration, start + 3000)
    artifact = Artifact(
        project_id=project.id,
        kind="overlay_image",
        path="",
        mime_type=stored.mime_type,
        size_bytes=stored.size_bytes,
    )
    session.add(artifact)
    session.flush()
    project_dir = settings.projects_dir / project.id / "overlays"
    project_dir.mkdir(parents=True, exist_ok=True)
    suffix = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }.get(stored.mime_type) or source_path.suffix
    image_path = project_dir / f"{artifact.id}{suffix}"
    try:
        shutil.copy2(source_path, image_path)
        artifact.path = str(image_path)
        overlay = ImageOverlay(
            project_id=project.id,
            artifact_id=artifact.id,
            name=stored.name,
            start_ms=start,
            end_ms=end,
        )
        session.add(overlay)
        project.updated_at = datetime.now(timezone.utc)
        session.commit()
    except Exception:
        image_path.unlink(missing_ok=True)
        session.rollback()
        raise
    output = ImageOverlayOut.model_validate(overlay)
    output.url = f"{settings.api_prefix}/artifacts/{artifact.id}"
    return output


@router.patch(
    f"{settings.api_prefix}/projects/{{project_id}}/image-overlays/{{overlay_id}}",
    response_model=ImageOverlayOut,
)
def update_image_overlay(
    project_id: str,
    overlay_id: str,
    payload: ImageOverlayUpdate,
    session: Session = Depends(get_db),
) -> ImageOverlayOut:
    project = get_project_or_404(session, project_id)
    overlay = image_overlay_or_404(session, project_id, overlay_id)
    updates = payload.model_dump(exclude_none=True)
    start = updates.get("start_ms", overlay.start_ms)
    end = updates.get("end_ms", overlay.end_ms)
    if end <= start:
        raise HTTPException(status_code=422, detail="Image end must be after its start")
    if project.duration_ms is not None and end > project.duration_ms:
        raise HTTPException(status_code=422, detail="Image timing exceeds source duration")
    for field, value in updates.items():
        setattr(overlay, field, value)
    project.updated_at = datetime.now(timezone.utc)
    session.commit()
    output = ImageOverlayOut.model_validate(overlay)
    output.url = f"{settings.api_prefix}/artifacts/{overlay.artifact_id}"
    return output


@router.delete(
    f"{settings.api_prefix}/projects/{{project_id}}/image-overlays/{{overlay_id}}",
    response_model=DeletionOut,
)
def delete_image_overlay(
    project_id: str,
    overlay_id: str,
    session: Session = Depends(get_db),
) -> DeletionOut:
    project = get_project_or_404(session, project_id)
    overlay = image_overlay_or_404(session, project_id, overlay_id)
    artifact = overlay.artifact
    image_path = Path(artifact.path)
    session.delete(overlay)
    session.delete(artifact)
    project.updated_at = datetime.now(timezone.utc)
    session.commit()
    image_path.unlink(missing_ok=True)
    return DeletionOut(deleted=1)
