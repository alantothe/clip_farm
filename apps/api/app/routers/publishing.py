"""Publishing a completed render to a connected platform."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Job, PlatformAccount, Publication, Render
from app.publishers import PublishError, check_account, get_publisher
from app.schemas import JobOut, PublishRequest
from app.tasks import publish_task


settings = get_settings()

router = APIRouter()


@router.post(
    f"{settings.api_prefix}/renders/{{render_id}}/publish/{{platform}}",
    response_model=JobOut,
    status_code=202,
)
def publish_render(
    render_id: str,
    platform: str,
    payload: PublishRequest,
    session: Session = Depends(get_db),
) -> Job:
    # Platform rules (duration, size, scopes, configuration) live in the
    # publisher; this route only sequences them and owns the Publication row.
    try:
        publisher = get_publisher(platform)
    except PublishError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    render = session.get(Render, render_id)
    if not render or render.status != "complete" or not render.path:
        raise HTTPException(status_code=404, detail="Completed render not found")
    if not Path(render.path).is_file():
        raise HTTPException(status_code=404, detail="Rendered file is missing")

    account = session.scalar(
        select(PlatformAccount).where(PlatformAccount.platform == platform)
    )
    try:
        publisher.check_render(render)
        publisher.check_configured()
        check_account(publisher, account)
    except PublishError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    label = platform.title()
    publication = session.scalar(
        select(Publication).where(
            Publication.render_id == render.id,
            Publication.platform == platform,
        )
    )
    if publication and publication.status in {"queued", "processing", "publishing"}:
        raise HTTPException(status_code=409, detail=f"This render is already being posted to {label}")
    if publication and publication.status == "complete":
        raise HTTPException(status_code=409, detail=f"This render has already been posted to {label}")
    if not publication:
        publication = Publication(
            render_id=render.id,
            account_id=account.id,
            platform=platform,
        )
        session.add(publication)
    publication.account_id = account.id
    publication.caption = payload.caption.strip()
    publication.share_to_feed = payload.share_to_feed
    publication.status = "queued"
    publication.remote_container_id = None
    publication.remote_media_id = None
    publication.permalink = None
    publication.error_message = None
    publication.started_at = None
    publication.completed_at = None
    job = Job(
        project_id=render.project_id,
        render_id=render.id,
        kind=f"publish_{platform}",
        message=f"Queued for {label}",
    )
    session.add(job)
    session.flush()
    publication.job_id = job.id
    session.commit()
    publish_task(publication.id, job.id)
    return job
