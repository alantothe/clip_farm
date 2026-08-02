import asyncio
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from starlette.datastructures import Headers, UploadFile

from app.routers import _helpers, batches as batches_router, projects as projects_router
from app.database import Base
from app.models import Artifact, Batch, Job, Project
from app.schemas import BatchCreate, BatchUpdate


def make_session(tmp_path) -> Session:
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    return Session(engine)


def use_projects_dir(monkeypatch, tmp_path) -> None:
    """Point every module that touches media at a throwaway directory."""
    settings = SimpleNamespace(
        projects_dir=tmp_path / "projects",
        api_prefix="/api",
        max_source_bytes=1_000_000,
    )
    monkeypatch.setattr(batches_router, "settings", settings)
    monkeypatch.setattr(_helpers, "settings", settings)
    monkeypatch.setattr(batches_router, "import_upload_task", lambda *args: None)


def finish_importing(session: Session) -> None:
    """Land every Clip and Job, so deletion guards stop treating them as busy."""
    for clip in session.scalars(select(Project)).all():
        clip.status = "ready"
    for job in session.scalars(select(Job)).all():
        job.status = "complete"
    session.commit()


def video_upload(name: str, content: bytes = b"video-bytes") -> UploadFile:
    return UploadFile(
        file=BytesIO(content),
        filename=name,
        headers=Headers({"content-type": "video/mp4"}),
    )


def test_uploading_videos_creates_one_clip_and_one_import_job_each(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch = batches_router.create_batch(BatchCreate(name="Tuesday pulls"), session)

    result = asyncio.run(
        batches_router.upload_clips(
            batch.id, [video_upload("first.mp4"), video_upload("second.mov")], session
        )
    )

    assert result.accepted == 2
    assert result.rejected == []
    clips = session.scalars(select(Project).order_by(Project.created_at)).all()
    assert [clip.title for clip in clips] == ["first", "second"]
    assert {clip.origin_kind for clip in clips} == {"upload"}
    assert {clip.batch_id for clip in clips} == {batch.id}
    assert {clip.mode for clip in clips} == {"batch-process"}
    # Every Clip is queued behind its own Job, so they import in parallel.
    assert len(session.scalars(select(Job)).all()) == 2
    for clip in clips:
        source = session.scalar(select(Artifact).where(Artifact.project_id == clip.id))
        assert source.kind == "source"
        assert (tmp_path / "projects" / clip.id).is_dir()
    session.close()


def test_an_unreadable_file_is_reported_without_losing_the_rest(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch = batches_router.create_batch(BatchCreate(), session)

    result = asyncio.run(
        batches_router.upload_clips(
            batch.id,
            [video_upload("keep.mp4"), video_upload("notes.pdf"), video_upload("also-keep.webm")],
            session,
        )
    )

    assert result.accepted == 2
    assert len(result.rejected) == 1
    assert "notes.pdf" in result.rejected[0]
    assert sorted(clip.title for clip in session.scalars(select(Project)).all()) == [
        "also-keep",
        "keep",
    ]
    session.close()


def test_an_oversized_video_leaves_no_partial_source_behind(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(
        batches_router.settings, "max_source_bytes", 8, raising=False
    )
    batch = batches_router.create_batch(BatchCreate(), session)

    result = asyncio.run(
        batches_router.upload_clips(
            batch.id, [video_upload("huge.mp4", b"x" * 64), video_upload("fine.mp4", b"tiny")], session
        )
    )

    assert result.accepted == 1
    assert "huge.mp4" in result.rejected[0]
    assert [clip.title for clip in session.scalars(select(Project)).all()] == ["fine"]
    # The rejected Clip's directory was removed rather than left half-written.
    assert len(list((tmp_path / "projects").iterdir())) == 1
    session.close()


def test_upload_of_only_unreadable_files_is_an_error(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch = batches_router.create_batch(BatchCreate(), session)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(batches_router.upload_clips(batch.id, [video_upload("notes.pdf")], session))

    assert exc_info.value.status_code == 415
    assert session.scalars(select(Project)).all() == []
    session.close()


def test_batches_are_listed_with_their_import_progress(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch = batches_router.create_batch(BatchCreate(name="Monday"), session)
    session.add_all(
        [
            Project(id="a", batch_id=batch.id, origin_kind="upload", status="ready"),
            Project(id="b", batch_id=batch.id, origin_kind="upload", status="processing"),
            Project(id="c", batch_id=batch.id, origin_kind="upload", status="failed"),
        ]
    )
    session.commit()

    listed = batches_router.list_batches(session)

    assert len(listed) == 1
    assert listed[0].name == "Monday"
    assert listed[0].clip_count == 3
    assert listed[0].importing_count == 1
    assert listed[0].failed_count == 1
    session.close()


def test_deleting_a_batch_removes_its_clips_and_media(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch = batches_router.create_batch(BatchCreate(), session)
    asyncio.run(batches_router.upload_clips(batch.id, [video_upload("one.mp4")], session))
    clip_id = session.scalar(select(Project.id))
    finish_importing(session)

    result = batches_router.delete_batch(batch.id, session)

    assert result.deleted == 1
    assert session.get(Batch, batch.id) is None
    assert session.scalars(select(Project)).all() == []
    assert not (tmp_path / "projects" / clip_id).exists()
    session.close()


def test_a_batch_with_an_importing_clip_cannot_be_deleted(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch = batches_router.create_batch(BatchCreate(), session)
    session.add(Project(id="busy", batch_id=batch.id, origin_kind="upload", status="processing"))
    session.commit()

    with pytest.raises(HTTPException) as exc_info:
        batches_router.delete_batch(batch.id, session)

    assert exc_info.value.status_code == 409
    assert session.get(Batch, batch.id) is not None
    session.close()


def test_batch_clips_stay_out_of_the_loose_clip_list(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch = batches_router.create_batch(BatchCreate(), session)
    session.add_all(
        [
            Project(
                id="loose",
                source_url="https://x.com/i/status/1",
                source_post_id="1",
                title="From X",
                status="ready",
            ),
            Project(
                id="batched",
                batch_id=batch.id,
                origin_kind="upload",
                title="Uploaded",
                status="ready",
            ),
        ]
    )
    session.commit()

    listed = projects_router.list_projects(session)

    assert [clip.title for clip in listed] == ["From X"]
    # Clearing the X mode's rail must not reach into a Batch.
    projects_router.delete_all_projects(session)
    assert [clip.id for clip in session.scalars(select(Project)).all()] == ["batched"]
    session.close()


def test_an_uploaded_clip_reports_no_origin_url(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch = batches_router.create_batch(BatchCreate(), session)
    asyncio.run(batches_router.upload_clips(batch.id, [video_upload("clip.mp4")], session))

    detail = batches_router.get_batch(batch.id, session)

    assert detail.clips[0].origin_kind == "upload"
    assert detail.clips[0].source_url is None
    assert detail.clips[0].source_post_id is None
    session.close()


def test_a_batch_can_be_renamed(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch = batches_router.create_batch(BatchCreate(), session)
    assert batch.name == "Untitled batch"

    renamed = batches_router.rename_batch(batch.id, BatchUpdate(name="  Client cuts  "), session)

    assert renamed.name == "Client cuts"
    session.close()
