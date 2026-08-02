from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.routers import _helpers, projects as projects_router
from app.database import Base
from app.models import Artifact, CaptionSegment, Job, Project


def make_session(tmp_path) -> Session:
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    return Session(engine)


def add_project(session: Session, project_id: str, *, status: str = "ready") -> Project:
    project = Project(
        id=project_id,
        source_url=f"https://x.com/i/status/{project_id}",
        source_post_id=project_id,
        title=f"Video {project_id}",
        status=status,
    )
    session.add(project)
    session.flush()
    session.add_all(
        [
            Artifact(
                project_id=project.id,
                kind="source",
                path=f"/tmp/{project.id}.mp4",
                mime_type="video/mp4",
                size_bytes=10,
            ),
            CaptionSegment(
                project_id=project.id,
                sequence=0,
                start_ms=0,
                end_ms=1000,
                text="Caption",
            ),
        ]
    )
    session.commit()
    return project


def test_delete_project_removes_database_records_and_media(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    projects_dir = tmp_path / "projects"
    media_dir = projects_dir / "one"
    media_dir.mkdir(parents=True)
    (media_dir / "source.mp4").write_bytes(b"video")
    monkeypatch.setattr(_helpers, "settings", SimpleNamespace(projects_dir=projects_dir))
    add_project(session, "one")

    result = projects_router.delete_project("one", session)

    assert result.deleted == 1
    assert session.get(Project, "one") is None
    assert session.scalars(select(Artifact)).all() == []
    assert session.scalars(select(CaptionSegment)).all() == []
    assert not media_dir.exists()
    session.close()


def test_clear_all_projects_removes_every_video(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    projects_dir = tmp_path / "projects"
    monkeypatch.setattr(_helpers, "settings", SimpleNamespace(projects_dir=projects_dir))
    add_project(session, "one")
    add_project(session, "two")

    result = projects_router.delete_all_projects(session)

    assert result.deleted == 2
    assert session.scalars(select(Project)).all() == []
    session.close()


def test_active_project_cannot_be_deleted(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    monkeypatch.setattr(_helpers, "settings", SimpleNamespace(projects_dir=tmp_path / "projects"))
    project = add_project(session, "one", status="ready")
    session.add(Job(project_id=project.id, kind="render", status="running"))
    session.commit()

    with pytest.raises(HTTPException) as exc_info:
        projects_router.delete_project("one", session)

    assert exc_info.value.status_code == 409
    assert session.get(Project, "one") is not None
    session.close()
