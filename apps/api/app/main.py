from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
from pathlib import Path
import shutil

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.database import get_db, init_db
from app.models import Artifact, CaptionSegment, ImageOverlay, Job, Project, Render
from app.schemas import (
    CaptionUpdateRequest,
    DeletionOut,
    ImportRequest,
    ImageOverlayOut,
    ImageOverlayUpdate,
    JobOut,
    ProjectOut,
    ProjectUpdate,
    SocialCaptionOut,
    SocialCaptionRewriteRequest,
    SocialCaptionUpdate,
)
from app.services.caption_rewrite import CaptionRewriteError, rewrite_social_caption
from app.services.x_download import normalize_x_post_url
from app.services.media import MediaProcessingError, validate_overlay_image
from app.tasks import import_project_task, render_project_task, transcribe_project_task


settings = get_settings()
logger = logging.getLogger(__name__)
ACTIVE_PROJECT_STATUSES = {"queued", "processing"}
ACTIVE_JOB_STATUSES = {"queued", "running"}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def project_query():
    return select(Project).options(
        selectinload(Project.artifacts),
        selectinload(Project.captions),
        selectinload(Project.image_overlays).selectinload(ImageOverlay.artifact),
        selectinload(Project.renders),
        selectinload(Project.jobs),
    )


def get_project_or_404(session: Session, project_id: str) -> Project:
    project = session.scalar(project_query().where(Project.id == project_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def serialize_project(project: Project) -> ProjectOut:
    output = ProjectOut.model_validate(project)
    if project.jobs:
        latest_job = max(project.jobs, key=lambda job: job.created_at)
        output.latest_job = JobOut.model_validate(latest_job)
    for artifact in output.artifacts:
        artifact.url = f"{settings.api_prefix}/artifacts/{artifact.id}"
    for render in output.renders:
        if render.status == "complete":
            render.download_url = f"{settings.api_prefix}/renders/{render.id}/download"
    for overlay in output.image_overlays:
        source = next(item for item in project.image_overlays if item.id == overlay.id)
        overlay.url = f"{settings.api_prefix}/artifacts/{source.artifact_id}"
    output.renders.sort(key=lambda item: item.created_at, reverse=True)
    return output


def image_overlay_or_404(session: Session, project_id: str, overlay_id: str) -> ImageOverlay:
    overlay = session.get(ImageOverlay, overlay_id)
    if not overlay or overlay.project_id != project_id:
        raise HTTPException(status_code=404, detail="Image overlay not found")
    return overlay


def ensure_project_can_be_deleted(project: Project) -> None:
    if project.status in ACTIVE_PROJECT_STATUSES or any(
        job.status in ACTIVE_JOB_STATUSES for job in project.jobs
    ):
        raise HTTPException(
            status_code=409,
            detail="Wait for the active import or render to finish before deleting this video",
        )


def remove_project_files(project_id: str) -> None:
    project_dir = settings.projects_dir / project_id
    try:
        if project_dir.is_symlink():
            project_dir.unlink()
        else:
            shutil.rmtree(project_dir, ignore_errors=False)
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("Could not remove media directory for project %s", project_id, exc_info=True)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post(f"{settings.api_prefix}/projects/import", response_model=ProjectOut, status_code=202)
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
        project = Project(source_url=normalized_url, source_post_id=post_id)
        session.add(project)
        session.flush()
    job = Job(project_id=project.id, kind="import", message="Queued for import")
    session.add(job)
    session.commit()
    import_project_task(project.id, job.id)
    refreshed = get_project_or_404(session, project.id)
    return serialize_project(refreshed)


@app.get(f"{settings.api_prefix}/projects", response_model=list[ProjectOut])
def list_projects(session: Session = Depends(get_db)) -> list[ProjectOut]:
    projects = session.scalars(project_query().order_by(Project.created_at.desc()).limit(50)).all()
    return [serialize_project(project) for project in projects]


@app.delete(f"{settings.api_prefix}/projects", response_model=DeletionOut)
def delete_all_projects(session: Session = Depends(get_db)) -> DeletionOut:
    projects = list(session.scalars(project_query()).all())
    for project in projects:
        ensure_project_can_be_deleted(project)
    project_ids = [project.id for project in projects]
    for project in projects:
        session.delete(project)
    session.commit()
    for project_id in project_ids:
        remove_project_files(project_id)
    return DeletionOut(deleted=len(project_ids))


@app.get(f"{settings.api_prefix}/projects/{{project_id}}", response_model=ProjectOut)
def get_project(project_id: str, session: Session = Depends(get_db)) -> ProjectOut:
    return serialize_project(get_project_or_404(session, project_id))


@app.delete(f"{settings.api_prefix}/projects/{{project_id}}", response_model=DeletionOut)
def delete_project(project_id: str, session: Session = Depends(get_db)) -> DeletionOut:
    project = get_project_or_404(session, project_id)
    ensure_project_can_be_deleted(project)
    session.delete(project)
    session.commit()
    remove_project_files(project_id)
    return DeletionOut(deleted=1)


@app.patch(f"{settings.api_prefix}/projects/{{project_id}}", response_model=ProjectOut)
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


@app.put(f"{settings.api_prefix}/projects/{{project_id}}/captions", response_model=ProjectOut)
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


@app.put(
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


@app.post(
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


@app.post(
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


@app.patch(
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


@app.delete(
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


@app.post(f"{settings.api_prefix}/projects/{{project_id}}/transcribe", response_model=JobOut, status_code=202)
def transcribe_project(project_id: str, session: Session = Depends(get_db)) -> Job:
    project = get_project_or_404(session, project_id)
    job = Job(project_id=project.id, kind="transcribe", message="Queued for captioning")
    session.add(job)
    session.commit()
    transcribe_project_task(project.id, job.id)
    return job


@app.post(f"{settings.api_prefix}/projects/{{project_id}}/render", response_model=JobOut, status_code=202)
def render_project(project_id: str, session: Session = Depends(get_db)) -> Job:
    project = get_project_or_404(session, project_id)
    if project.status != "ready":
        raise HTTPException(status_code=409, detail="The source video is not ready")
    end_ms = project.trim_end_ms or project.duration_ms
    if end_ms is None or end_ms <= project.trim_start_ms:
        raise HTTPException(status_code=422, detail="Select a valid trim range")
    render = Render(
        project_id=project.id,
        layout=project.layout,
        trim_start_ms=project.trim_start_ms,
        trim_end_ms=end_ms,
        captions_enabled=project.captions_enabled,
        caption_style=project.caption_style,
        caption_position=project.caption_position,
    )
    session.add(render)
    session.flush()
    job = Job(
        project_id=project.id,
        render_id=render.id,
        kind="render",
        message="Queued for rendering",
    )
    session.add(job)
    session.commit()
    render_project_task(project.id, render.id, job.id)
    return job


@app.get(f"{settings.api_prefix}/jobs/{{job_id}}", response_model=JobOut)
def get_job(job_id: str, session: Session = Depends(get_db)) -> Job:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get(f"{settings.api_prefix}/artifacts/{{artifact_id}}")
def get_artifact(artifact_id: str, session: Session = Depends(get_db)) -> FileResponse:
    artifact = session.get(Artifact, artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    path = Path(artifact.path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Artifact file is missing")
    return FileResponse(path, media_type=artifact.mime_type, filename=path.name)


@app.get(f"{settings.api_prefix}/renders/{{render_id}}/download")
def download_render(render_id: str, session: Session = Depends(get_db)) -> FileResponse:
    render = session.get(Render, render_id)
    if not render or render.status != "complete" or not render.path:
        raise HTTPException(status_code=404, detail="Completed render not found")
    path = Path(render.path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Rendered file is missing")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=f"clip-farm-{render.project_id[:8]}.mp4",
    )
