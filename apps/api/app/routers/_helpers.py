"""Shared query, serialization, and filesystem helpers used across routers."""

import logging
import shutil

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import ImageOverlay, Project, Render
from app.schemas import JobOut, ProjectOut


settings = get_settings()
logger = logging.getLogger(__name__)
ACTIVE_PROJECT_STATUSES = {"queued", "processing"}
ACTIVE_JOB_STATUSES = {"queued", "running"}


def project_query():
    return select(Project).options(
        selectinload(Project.artifacts),
        selectinload(Project.captions),
        selectinload(Project.image_overlays).selectinload(ImageOverlay.artifact),
        selectinload(Project.renders).selectinload(Render.publications),
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
