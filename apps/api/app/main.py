from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.database import get_db, init_db
from app.models import Artifact, CaptionSegment, Job, Project, Render
from app.schemas import (
    CaptionUpdateRequest,
    ImportRequest,
    JobOut,
    ProjectOut,
    ProjectUpdate,
)
from app.services.x_download import normalize_x_post_url
from app.tasks import import_project_task, render_project_task, transcribe_project_task


settings = get_settings()


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
        selectinload(Project.renders),
    )


def get_project_or_404(session: Session, project_id: str) -> Project:
    project = session.scalar(project_query().where(Project.id == project_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def serialize_project(project: Project) -> ProjectOut:
    output = ProjectOut.model_validate(project)
    for artifact in output.artifacts:
        artifact.url = f"{settings.api_prefix}/artifacts/{artifact.id}"
    for render in output.renders:
        if render.status == "complete":
            render.download_url = f"{settings.api_prefix}/renders/{render.id}/download"
    output.renders.sort(key=lambda item: item.created_at, reverse=True)
    return output


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


@app.get(f"{settings.api_prefix}/projects/{{project_id}}", response_model=ProjectOut)
def get_project(project_id: str, session: Session = Depends(get_db)) -> ProjectOut:
    return serialize_project(get_project_or_404(session, project_id))


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
