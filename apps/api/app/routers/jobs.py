"""Job status plus the transcribe and render triggers."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Job, Render
from app.schemas import JobOut
from app.tasks import render_project_task, transcribe_project_task

from app.routers._helpers import get_project_or_404


settings = get_settings()

router = APIRouter()


@router.post(f"{settings.api_prefix}/projects/{{project_id}}/transcribe", response_model=JobOut, status_code=202)
def transcribe_project(project_id: str, session: Session = Depends(get_db)) -> Job:
    project = get_project_or_404(session, project_id)
    job = Job(project_id=project.id, kind="transcribe", message="Queued for captioning")
    session.add(job)
    session.commit()
    transcribe_project_task(project.id, job.id)
    return job


@router.post(f"{settings.api_prefix}/projects/{{project_id}}/render", response_model=JobOut, status_code=202)
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


@router.get(f"{settings.api_prefix}/jobs/{{job_id}}", response_model=JobOut)
def get_job(job_id: str, session: Session = Depends(get_db)) -> Job:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
