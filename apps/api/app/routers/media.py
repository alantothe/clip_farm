"""Artifact downloads, render downloads, and signed Instagram media serving."""

from pathlib import Path
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Artifact, Render
from app.services.instagram import media_signature_is_valid


settings = get_settings()

router = APIRouter()


@router.get(f"{settings.api_prefix}/media/instagram/{{render_id}}", include_in_schema=False)
def serve_instagram_render(
    render_id: str,
    expires: int,
    signature: str,
    session: Session = Depends(get_db),
) -> FileResponse:
    if expires < int(time.time()):
        raise HTTPException(status_code=403, detail="Media URL expired")
    signing_secret = settings.token_encryption_key or ""
    if not signing_secret or not media_signature_is_valid(
        render_id, expires, signature, signing_secret
    ):
        raise HTTPException(status_code=403, detail="Invalid media signature")
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
