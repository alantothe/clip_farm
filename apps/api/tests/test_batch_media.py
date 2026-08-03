import asyncio
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from starlette.datastructures import Headers, UploadFile

from app.database import Base
from app.models import Batch, BatchMedia, Project, Shot, StoredImage
from app.routers import _helpers, batch_media as media_router
from app.schemas import BatchMediaFromStorageCreate, BatchMediaUpdate
from app.services.batch_media import media_in_span


def make_session(tmp_path) -> Session:
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    return Session(engine)


def image_upload(name: str = "logo.png", content: bytes = b"image") -> UploadFile:
    return UploadFile(
        file=BytesIO(content),
        filename=name,
        headers=Headers({"content-type": "image/png"}),
    )


def make_sequence(session: Session) -> Batch:
    batch = Batch(name="Media test")
    clip = Project(
        batch=batch,
        origin_kind="upload",
        status="ready",
        duration_ms=5000,
        trim_end_ms=5000,
    )
    session.add_all([batch, clip])
    session.flush()
    session.add(Shot(batch_id=batch.id, project_id=clip.id, position=0))
    session.commit()
    return batch


def use_media_dir(monkeypatch, tmp_path) -> None:
    settings = SimpleNamespace(api_prefix="/api", batches_dir=tmp_path / "batches")
    monkeypatch.setattr(media_router, "settings", settings)
    monkeypatch.setattr(_helpers, "settings", settings)
    monkeypatch.setattr(media_router, "validate_overlay_image", lambda _path: None)


def test_upload_places_an_image_across_the_full_sequence(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_media_dir(monkeypatch, tmp_path)
    batch = make_sequence(session)

    output = asyncio.run(
        media_router.upload_batch_media(batch.id, image_upload(), None, session)
    )

    assert len(output.media) == 1
    item = output.media[0]
    assert (item.start_ms, item.end_ms) == (0, 5000)
    assert item.url == f"/api/batches/{batch.id}/media/{item.id}/file"
    stored = session.scalar(select(BatchMedia))
    assert stored is not None
    assert stored.size_bytes == len(b"image")
    assert (tmp_path / "batches" / batch.id / "media" / f"{stored.id}.png").is_file()
    session.close()


def test_media_can_be_stretched_and_removed(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_media_dir(monkeypatch, tmp_path)
    batch = make_sequence(session)
    created = asyncio.run(media_router.upload_batch_media(batch.id, image_upload(), None, session))
    media_id = created.media[0].id

    updated = media_router.update_batch_media(
        batch.id,
        media_id,
        BatchMediaUpdate(
            start_ms=500,
            end_ms=4500,
            center_x=72,
            center_y=18,
            width_percent=42,
        ),
        session,
    )
    assert [(item.start_ms, item.end_ms) for item in updated.media] == [(500, 4500)]
    assert (
        updated.media[0].center_x,
        updated.media[0].center_y,
        updated.media[0].width_percent,
    ) == (72, 18, 42)

    path = session.get(BatchMedia, media_id).path
    removed = media_router.remove_batch_media(batch.id, media_id, session)
    assert removed.media == []
    assert not Path(path).exists()
    session.close()


def test_stored_image_is_copied_into_a_sequence(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_media_dir(monkeypatch, tmp_path)
    batch = make_sequence(session)
    source = tmp_path / "stored.png"
    source.write_bytes(b"stored image")
    stored = StoredImage(
        name="logo.png",
        path=str(source),
        mime_type="image/png",
        size_bytes=source.stat().st_size,
    )
    session.add(stored)
    session.commit()

    output = media_router.add_batch_media_from_storage(
        batch.id,
        BatchMediaFromStorageCreate(storage_image_id=stored.id),
        session,
    )

    item = output.media[0]
    copied = tmp_path / "batches" / batch.id / "media" / f"{item.id}.png"
    assert copied.read_bytes() == source.read_bytes()
    assert item.name == "logo.png"
    session.close()


def test_media_cannot_be_uploaded_without_a_sequence(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_media_dir(monkeypatch, tmp_path)
    batch = Batch(name="Empty")
    session.add(batch)
    session.commit()

    with pytest.raises(HTTPException) as error:
        asyncio.run(media_router.upload_batch_media(batch.id, image_upload(), None, session))
    assert error.value.status_code == 409
    session.close()


def test_sequence_media_is_sliced_to_each_render_segment() -> None:
    item = SimpleNamespace(start_ms=1500, end_ms=4500)
    assert media_in_span([item], 2000, 2000) == [(item, 0, 2000)]
    assert media_in_span([item], 0, 1000) == []
