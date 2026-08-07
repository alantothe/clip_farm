"""Publishing a completed render to a connected platform.

A Clip posts its Render; a Batch posts its Sequence Render. They are separate
tables (ADR 0003) and so separate routes, but everything that decides whether a
post is allowed — the file, the account, the caption, the platform's own
options — is the one Publisher seam underneath (ADR 0012).
"""

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import (
    Job,
    PlatformAccount,
    Publication,
    Render,
    SequencePublication,
    StoredImage,
)
from app.publishers import PublishError, check_account, get_publisher
from app.publishers.targets import video_for_render, video_for_sequence_render
from app.routers._helpers import get_batch_or_404, latest_sequence_render
from app.schemas import JobOut, PublishRequest, SequencePublicationOut, SequencePublishRequest
from app.tasks import publish_sequence_task, publish_task


settings = get_settings()

router = APIRouter()

# A post already on its way holds the render; a second would race it.
ACTIVE_PUBLICATION_STATUSES = {"queued", "processing", "publishing"}


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
        publisher.check_video(video_for_render(render))
        publisher.check_configured()
        check_account(publisher, account)
        # Same caption rules as a Batch's post: the platform is what enforces
        # them, so a Clip cannot be held to a different set.
        caption, options = publisher.prepare_post(
            payload.caption, {"share_to_feed": payload.share_to_feed}
        )
    except PublishError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    label = platform.title()
    publication = session.scalar(
        select(Publication).where(
            Publication.render_id == render.id,
            Publication.platform == platform,
        )
    )
    if publication and publication.status in ACTIVE_PUBLICATION_STATUSES:
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
    publication.caption = caption
    publication.share_to_feed = options["share_to_feed"]
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


@router.post(
    f"{settings.api_prefix}/batches/{{batch_id}}/publish/{{platform}}",
    response_model=SequencePublicationOut,
    status_code=202,
)
def publish_sequence(
    batch_id: str,
    platform: str,
    payload: SequencePublishRequest,
    session: Session = Depends(get_db),
) -> SequencePublication:
    """Post a Batch's finished export to one Platform.

    One Platform per request, and one row per Platform, so picking three
    destinations is three posts that succeed, fail, and are retried on their
    own. Nothing here is Instagram-specific: the publisher decides what the
    file, the account, and the filled-in form have to satisfy.
    """
    try:
        publisher = get_publisher(platform)
    except PublishError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    batch = get_batch_or_404(session, batch_id)
    sequence_render = latest_sequence_render(batch)
    if not sequence_render:
        raise HTTPException(
            status_code=404, detail="Export the timeline before posting it"
        )

    account = session.scalar(
        select(PlatformAccount).where(PlatformAccount.platform == platform)
    )
    label = platform.title()
    try:
        publisher.check_video(video_for_sequence_render(sequence_render))
        publisher.check_configured()
        check_account(publisher, account)
        caption, options = publisher.prepare_post(payload.caption, payload.options)
    except PublishError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    # A Cover Image is selected from local Storage. Catch a stale/deleted id
    # before the background worker hands Instagram a signed URL that returns
    # 404, where the useful cause would be hidden behind a container failure.
    cover_image_id = options.get("cover_image_id")
    if cover_image_id:
        cover_image = session.get(StoredImage, cover_image_id)
        if not cover_image or not Path(cover_image.path).is_file():
            raise HTTPException(
                status_code=422,
                detail="The selected cover image is no longer in Storage",
            )

    publication = session.scalar(
        select(SequencePublication).where(
            SequencePublication.sequence_render_id == sequence_render.id,
            SequencePublication.platform == platform,
        )
    )
    if publication and publication.status in ACTIVE_PUBLICATION_STATUSES:
        raise HTTPException(
            status_code=409, detail=f"This export is already being posted to {label}"
        )
    if publication and publication.status == "complete":
        raise HTTPException(
            status_code=409, detail=f"This export has already been posted to {label}"
        )
    if not publication:
        publication = SequencePublication(
            batch_id=batch.id,
            sequence_render_id=sequence_render.id,
            platform=platform,
        )
        session.add(publication)
    # A retry reuses the row, so everything the last attempt left behind goes.
    publication.account_id = account.id
    publication.caption = caption
    publication.options = options
    publication.status = "queued"
    publication.progress = 0
    publication.message = f"Queued for {label}"
    publication.remote_container_id = None
    publication.remote_media_id = None
    publication.permalink = None
    publication.error_message = None
    publication.started_at = None
    publication.completed_at = None
    # Posting is not an edit either, so the Batch's `updated_at` stays where the
    # last real change left it — see the export route.
    session.commit()

    # Queued after the commit, so the worker can load what it was handed.
    publish_sequence_task(publication.id)
    return publication
