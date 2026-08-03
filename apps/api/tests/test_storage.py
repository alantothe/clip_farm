import asyncio
from io import BytesIO
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.datastructures import Headers, UploadFile

from app.database import Base
from app.models import StoredImage
from app.routers import storage as storage_router


def make_session(tmp_path) -> Session:
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    return Session(engine)


def image_upload() -> UploadFile:
    return UploadFile(
        file=BytesIO(b"image"),
        filename="brand mark.png",
        headers=Headers({"content-type": "image/png"}),
    )


def test_storage_uploads_lists_serves_and_deletes_images(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    settings = SimpleNamespace(
        api_prefix="/api",
        storage_dir=tmp_path / "storage" / "images",
    )
    monkeypatch.setattr(storage_router, "settings", settings)
    monkeypatch.setattr(storage_router, "validate_overlay_image", lambda _path: None)

    created = asyncio.run(storage_router.upload_stored_image(image_upload(), session))

    assert created.name == "brand mark.png"
    assert created.url == f"/api/storage/images/{created.id}/file"
    assert storage_router.list_stored_images(session)[0].id == created.id
    path = settings.storage_dir / f"{created.id}.png"
    assert path.read_bytes() == b"image"
    response = storage_router.get_stored_image_file(created.id, session)
    assert response.path == path

    assert storage_router.delete_stored_image(created.id, session).deleted == 1
    assert session.get(StoredImage, created.id) is None
    assert not path.exists()
    session.close()
