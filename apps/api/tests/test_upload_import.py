"""The upload importer, and the one thing it cannot do: fetch its source again.

An X import that fails can always re-download. An uploaded Clip has exactly one
copy of its Source Video, so these cover how the task finds that file.
"""

from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app import tasks
from app.database import Base
from app.models import Artifact, Job, Project
from app.services.upload import UploadRejected, clip_title, source_suffix


def make_session(tmp_path) -> Session:
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    return Session(engine)


def prepare(tmp_path, monkeypatch, *, with_artifact: bool):
    """An uploaded Clip whose Source Video is on disk, queued for import."""
    session = make_session(tmp_path)
    projects_dir = tmp_path / "projects"
    monkeypatch.setattr(tasks, "settings", SimpleNamespace(projects_dir=projects_dir))
    monkeypatch.setattr(tasks, "SessionLocal", lambda: session)
    # Keep the session alive across the task's `with SessionLocal() as session`.
    monkeypatch.setattr(session, "close", lambda: None)

    clip = Project(id="clip", origin_kind="upload", title="Holiday", status="queued")
    job = Job(id="job", project_id="clip", kind="import", message="Queued for import")
    session.add_all([clip, job])
    source = projects_dir / "clip" / "source.mp4"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"video")
    if with_artifact:
        session.add(
            Artifact(
                project_id="clip",
                kind="source",
                path=str(source),
                mime_type="video/mp4",
                size_bytes=5,
            )
        )
    session.commit()
    return session, source


def test_the_importer_uses_the_source_artifact_when_it_is_there(tmp_path, monkeypatch) -> None:
    session, source = prepare(tmp_path, monkeypatch, with_artifact=True)
    seen: list = []
    monkeypatch.setattr(tasks, "_prepare_clip", lambda _s, _p, _j, path: seen.append(path))

    tasks.import_upload_task.call_local("clip", "job")

    assert seen == [source]
    session.close()


def test_a_retry_finds_the_source_after_its_artifact_row_was_cleared(tmp_path, monkeypatch) -> None:
    """A first attempt can fail after wiping Artifacts. The file is still there."""
    session, source = prepare(tmp_path, monkeypatch, with_artifact=False)
    seen: list = []
    monkeypatch.setattr(tasks, "_prepare_clip", lambda _s, _p, _j, path: seen.append(path))

    tasks.import_upload_task.call_local("clip", "job")

    assert seen == [source]
    session.close()


def test_a_clip_whose_source_never_landed_fails_rather_than_hanging(tmp_path, monkeypatch) -> None:
    session, source = prepare(tmp_path, monkeypatch, with_artifact=True)
    source.unlink()

    with pytest.raises(RuntimeError):
        tasks.import_upload_task.call_local("clip", "job")

    clip = session.scalar(select(Project))
    job = session.scalar(select(Job))
    assert clip.status == "failed"
    assert job.status == "failed"
    assert "missing from disk" in job.error_message
    session.close()


def test_uploads_are_named_and_screened_by_their_file_name() -> None:
    assert clip_title("Beach Day.final.MP4") == "Beach Day.final"
    assert clip_title(None) == "Uploaded clip"
    assert source_suffix("clip.MOV") == ".mov"
    with pytest.raises(UploadRejected):
        source_suffix("notes.pdf")
    with pytest.raises(UploadRejected):
        source_suffix(None)
