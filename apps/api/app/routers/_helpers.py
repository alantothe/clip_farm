"""Shared query, serialization, and filesystem helpers used across routers."""

import logging
import shutil

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import Batch, ImageOverlay, Project, Render, SequenceRender, Shot
from app.schemas import (
    BatchOut,
    BatchSummaryOut,
    CutawayOut,
    JobOut,
    ProjectOut,
    SequenceRenderOut,
    ShotOut,
)


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


def get_batch_or_404(session: Session, batch_id: str) -> Batch:
    batch = session.get(Batch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return batch


def batch_clips(session: Session, batch_id: str) -> list[Project]:
    """Every Clip in a Batch, oldest first, so the grid keeps drop order."""
    return list(
        session.scalars(
            project_query().where(Project.batch_id == batch_id).order_by(Project.created_at)
        ).all()
    )


def batch_shots(session: Session, batch_id: str) -> list[Shot]:
    """A Batch's Sequence, in play order.

    Cutaways are excluded: they are Shots too, but they sit on a Base Shot at
    an offset rather than in the running order, so a `position` means nothing
    for them (ADR 0005).
    """
    return list(
        session.scalars(
            select(Shot)
            .where(Shot.batch_id == batch_id, Shot.parent_shot_id.is_(None))
            .order_by(Shot.position, Shot.created_at)
        ).all()
    )


def batch_cutaways(session: Session, batch_id: str) -> list[Shot]:
    """Every Cutaway in a Batch, whichever Base Shot each one covers."""
    return list(
        session.scalars(
            select(Shot)
            .where(Shot.batch_id == batch_id, Shot.parent_shot_id.is_not(None))
            .order_by(Shot.offset_ms, Shot.created_at)
        ).all()
    )


def renumber_shots(shots: list[Shot]) -> None:
    """Close any gaps so positions read 0..n-1 after an edit."""
    for position, shot in enumerate(shots):
        shot.position = position


def latest_sequence_render(batch: Batch) -> SequenceRender | None:
    """The Batch's most recent export. Older ones stay on disk but unlisted."""
    if not batch.sequence_renders:
        return None
    return max(batch.sequence_renders, key=lambda item: item.created_at)


def serialize_sequence_render(sequence_render: SequenceRender) -> SequenceRenderOut:
    output = SequenceRenderOut.model_validate(sequence_render)
    if sequence_render.status == "complete":
        output.download_url = (
            f"{settings.api_prefix}/batches/{sequence_render.batch_id}/render/download"
        )
    return output


def serialize_batch(session: Session, batch: Batch) -> BatchOut:
    output = BatchOut.model_validate(batch)
    # The relationship holds Cutaways too, and they have no place in the
    # running order, so both lists are filled deliberately rather than by
    # whatever `shots` happens to contain.
    output.shots = [ShotOut.model_validate(shot) for shot in batch_shots(session, batch.id)]
    output.cutaways = [
        CutawayOut.model_validate(cutaway) for cutaway in batch_cutaways(session, batch.id)
    ]
    output.clips = [serialize_project(clip) for clip in batch_clips(session, batch.id)]
    newest = latest_sequence_render(batch)
    output.sequence_render = serialize_sequence_render(newest) if newest else None
    return output


def summarize_batch(batch: Batch, clips: list[Project]) -> BatchSummaryOut:
    output = BatchSummaryOut.model_validate(batch)
    output.clip_count = len(clips)
    output.importing_count = sum(1 for clip in clips if clip.status in ACTIVE_PROJECT_STATUSES)
    output.failed_count = sum(1 for clip in clips if clip.status == "failed")
    # Cutaways are not part of the running order, so they are not counted here.
    output.shot_count = sum(1 for shot in batch.shots if not shot.is_cutaway)
    return output


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
