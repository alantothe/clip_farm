import asyncio
import base64
from io import BytesIO
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.datastructures import Headers, UploadFile

from app.routers import projects as projects_router
from app.database import Base
from app.models import ImageOverlay, Project
from app.schemas import ImageOverlayUpdate


def make_session(tmp_path) -> Session:
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    return Session(engine)


def test_image_overlay_upload_update_and_delete(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    project = Project(
        id="project",
        source_url="https://x.com/i/status/123",
        source_post_id="123",
        title="Video",
        status="ready",
        duration_ms=5000,
    )
    session.add(project)
    session.commit()
    monkeypatch.setattr(
        projects_router,
        "settings",
        SimpleNamespace(projects_dir=tmp_path / "projects", api_prefix="/api"),
    )
    image_bytes = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )
    upload = UploadFile(
        file=BytesIO(image_bytes),
        filename="callout.png",
        headers=Headers({"content-type": "image/png"}),
    )

    created = asyncio.run(projects_router.upload_image_overlay("project", upload, 1200, session))

    assert created.name == "callout.png"
    assert created.start_ms == 1200
    assert created.end_ms == 4200
    assert created.rotation_deg == 0
    assert created.opacity == 1
    assert created.url.startswith("/api/artifacts/")
    overlay = session.get(ImageOverlay, created.id)
    assert overlay is not None
    assert overlay.artifact.size_bytes == len(image_bytes)

    updated = projects_router.update_image_overlay(
        "project",
        created.id,
        ImageOverlayUpdate(end_ms=4800, width_percent=42, center_y=25, rotation_deg=-12, opacity=0.6),
        session,
    )
    assert updated.end_ms == 4800
    assert updated.width_percent == 42
    assert updated.center_y == 25
    assert updated.rotation_deg == -12
    assert updated.opacity == 0.6

    image_path = tmp_path / "projects" / "project" / "overlays" / f"{overlay.artifact_id}.png"
    assert image_path.is_file()
    assert projects_router.delete_image_overlay("project", created.id, session).deleted == 1
    assert session.get(ImageOverlay, created.id) is None
    assert not image_path.exists()
    session.close()
