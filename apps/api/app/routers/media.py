"""Artifact downloads, render downloads, and signed Instagram media serving."""

from pathlib import Path
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Artifact, Render, SequencePublication, SequenceRender
from app.services.instagram import media_signature_is_valid


settings = get_settings()

router = APIRouter()


def _check_media_signature(media_id: str, expires: int, signature: str) -> None:
    """Instagram fetches the file itself, so the URL is the only credential."""
    if expires < int(time.time()):
        raise HTTPException(status_code=403, detail="Media URL expired")
    signing_secret = settings.token_encryption_key or ""
    if not signing_secret or not media_signature_is_valid(
        media_id, expires, signature, signing_secret
    ):
        raise HTTPException(status_code=403, detail="Invalid media signature")


# A custom Cover Image is embedded as frame zero in this post-only copy. The
# Sequence Render remains frozen and its normal download therefore never gains
# a one-frame flash that exists only to make Instagram's frame picker reliable.
@router.get(
    f"{settings.api_prefix}/media/instagram/publications/{{publication_id}}",
    include_in_schema=False,
)
def serve_instagram_publication_video(
    publication_id: str,
    expires: int,
    signature: str,
    session: Session = Depends(get_db),
) -> FileResponse:
    _check_media_signature(publication_id, expires, signature)
    publication = session.get(SequencePublication, publication_id)
    if not publication:
        raise HTTPException(status_code=404, detail="Publication not found")
    path = (
        settings.batches_dir
        / publication.batch_id
        / "publications"
        / f"{publication.id}.mp4"
    )
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Publication video is missing")
    return FileResponse(
        path,
        media_type="video/mp4",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": 'inline; filename="instagram-reel.mp4"',
        },
    )


# Declared before the Render route so a Sequence Render's two-segment path is
# never read as a Render id called "sequences".
@router.get(
    f"{settings.api_prefix}/media/instagram/sequences/{{sequence_render_id}}",
    include_in_schema=False,
)
def serve_instagram_sequence_render(
    sequence_render_id: str,
    expires: int,
    signature: str,
    session: Session = Depends(get_db),
) -> FileResponse:
    _check_media_signature(sequence_render_id, expires, signature)
    sequence_render = session.get(SequenceRender, sequence_render_id)
    if not sequence_render or sequence_render.status != "complete" or not sequence_render.path:
        raise HTTPException(status_code=404, detail="Completed render not found")
    path = Path(sequence_render.path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Rendered file is missing")
    return FileResponse(
        path,
        media_type="video/mp4",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": (
                f'inline; filename="clip-farm-{sequence_render.batch_id[:8]}.mp4"'
            ),
        },
    )


@router.get(f"{settings.api_prefix}/media/instagram/{{render_id}}", include_in_schema=False)
def serve_instagram_render(
    render_id: str,
    expires: int,
    signature: str,
    session: Session = Depends(get_db),
) -> FileResponse:
    _check_media_signature(render_id, expires, signature)
    render = session.get(Render, render_id)
    if not render or render.status != "complete" or not render.path:
        raise HTTPException(status_code=404, detail="Completed render not found")
    path = Path(render.path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Rendered file is missing")
    return FileResponse(
        path,
        media_type="video/mp4",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'inline; filename="clip-farm-{render.project_id[:8]}.mp4"',
        },
    )


@router.get(f"{settings.api_prefix}/artifacts/{{artifact_id}}")
def get_artifact(artifact_id: str, session: Session = Depends(get_db)) -> FileResponse:
    artifact = session.get(Artifact, artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    path = Path(artifact.path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Artifact file is missing")
    return FileResponse(path, media_type=artifact.mime_type, filename=path.name)


@router.get(f"{settings.api_prefix}/renders/{{render_id}}/download")
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
