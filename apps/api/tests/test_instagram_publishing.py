from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from cryptography.fernet import Fernet
from fastapi import HTTPException
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import Job, PlatformAccount, Project, Publication, Render
from app.publishers import instagram as instagram_publisher
from app.schemas import PublishRequest
from app.services import instagram
from app import main, tasks


def test_instagram_reel_requests_use_server_side_bearer_token(monkeypatch) -> None:
    calls: list[tuple[str, str, dict, dict]] = []

    class Response:
        status_code = 200
        is_error = False

        def __init__(self, payload: dict):
            self.payload = payload

        def json(self) -> dict:
            return self.payload

    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, url: str, data: dict, headers: dict):
            calls.append(("POST", url, data, headers))
            return Response({"id": "container-1" if url.endswith("/media") else "media-1"})

        def get(self, url: str, params: dict, headers: dict):
            calls.append(("GET", url, params, headers))
            return Response({"status_code": "FINISHED", "status": "ready"})

    monkeypatch.setattr(instagram.httpx, "Client", Client)
    settings = SimpleNamespace(instagram_api_version="v23.0")

    container_id = instagram.create_reel_container(
        remote_user_id="ig-user-1",
        access_token="private-token",
        video_url="https://clips.example/api/media/video",
        caption="Test Reel",
        share_to_feed=True,
        settings=settings,
    )
    status, _ = instagram.get_container_status(container_id, "private-token", settings)
    media_id = instagram.publish_reel(
        remote_user_id="ig-user-1",
        container_id=container_id,
        access_token="private-token",
        settings=settings,
    )

    assert (container_id, status, media_id) == ("container-1", "FINISHED", "media-1")
    assert calls[0][1] == "https://graph.instagram.com/v23.0/ig-user-1/media"
    assert calls[0][2] == {
        "media_type": "REELS",
        "video_url": "https://clips.example/api/media/video",
        "caption": "Test Reel",
        "share_to_feed": "true",
    }
    assert calls[1][2] == {"fields": "status_code,status"}
    assert calls[2][2] == {"creation_id": "container-1"}
    assert all(headers == {"Authorization": "Bearer private-token"} for *_, headers in calls)
    assert all("private-token" not in values.values() for _, _, values, _ in calls)


def test_instagram_publish_worker_completes_and_uses_signed_media_url(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'publish.db'}")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    key = Fernet.generate_key().decode()
    video = tmp_path / "render.mp4"
    video.write_bytes(b"rendered-video")

    with Session(engine) as session:
        project = Project(source_url="https://x.com/i/status/1", source_post_id="1")
        session.add(project)
        session.flush()
        render = Render(
            project_id=project.id,
            status="complete",
            path=str(video),
            layout="fit_background",
            trim_start_ms=0,
            trim_end_ms=5000,
            captions_enabled=True,
            caption_style="bold",
        )
        account = PlatformAccount(
            platform="instagram",
            remote_user_id="ig-user-1",
            username="clipfarmer",
            access_token_encrypted=instagram.encrypt_token("private-token", key),
            scopes="instagram_business_basic,instagram_business_content_publish",
            token_expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        )
        session.add_all([render, account])
        session.flush()
        job = Job(project_id=project.id, render_id=render.id, kind="publish_instagram")
        publication = Publication(
            render_id=render.id,
            account_id=account.id,
            platform="instagram",
            caption="A test post",
            share_to_feed=True,
        )
        session.add_all([job, publication])
        session.flush()
        publication.job_id = job.id
        session.commit()
        publication_id, job_id = publication.id, job.id

    worker_settings = SimpleNamespace(
        token_encryption_key=key,
        instagram_media_url_ttl_seconds=3600,
        instagram_processing_timeout_seconds=30,
        instagram_poll_interval_seconds=0,
        external_base_url="https://clips.example",
        api_prefix="/api",
    )
    captured: dict[str, str] = {}

    def create_container(**kwargs):
        captured["video_url"] = kwargs["video_url"]
        assert kwargs["access_token"] == "private-token"
        return "container-1"

    monkeypatch.setattr(tasks, "SessionLocal", session_factory)
    monkeypatch.setattr(instagram_publisher, "settings", worker_settings)
    monkeypatch.setattr(instagram_publisher, "create_reel_container", create_container)
    monkeypatch.setattr(
        instagram_publisher, "get_container_status", lambda *_args: ("FINISHED", "ready")
    )
    monkeypatch.setattr(instagram_publisher, "publish_reel", lambda **_kwargs: "media-1")
    monkeypatch.setattr(
        instagram_publisher,
        "get_media_permalink",
        lambda *_args: "https://www.instagram.com/reel/test/",
    )

    tasks.publish_task.call_local(publication_id, job_id)

    with Session(engine) as session:
        publication = session.get(Publication, publication_id)
        job = session.get(Job, job_id)
        assert publication is not None and publication.status == "complete"
        assert publication.remote_container_id == "container-1"
        assert publication.remote_media_id == "media-1"
        assert job is not None and job.status == "complete" and job.progress == 100

    assert captured["video_url"].startswith(
        "https://clips.example/api/media/instagram/"
    )
    query = captured["video_url"].split("?", 1)[1]
    values = dict(item.split("=", 1) for item in query.split("&"))
    render_id = captured["video_url"].split("/instagram/", 1)[1].split("?", 1)[0]
    assert instagram.media_signature_is_valid(
        render_id, int(values["expires"]), values["signature"], key
    )


def test_refreshes_instagram_token_before_expiration(monkeypatch) -> None:
    class Response:
        status_code = 200
        is_error = False

        def json(self):
            return {"access_token": "refreshed-token", "expires_in": 5_184_000}

    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, url: str, params: dict):
            assert url == "https://graph.instagram.com/refresh_access_token"
            assert params == {
                "grant_type": "ig_refresh_token",
                "access_token": "old-token",
            }
            return Response()

    monkeypatch.setattr(instagram.httpx, "Client", Client)
    result = instagram.refresh_long_lived_token("old-token", SimpleNamespace())
    assert result.access_token == "refreshed-token"
    assert result.expires_at is not None


def test_instagram_media_route_requires_an_unexpired_signature(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'media.db'}")
    Base.metadata.create_all(engine)
    key = Fernet.generate_key().decode()
    video = tmp_path / "render.mp4"
    video.write_bytes(b"rendered-video")
    with Session(engine) as session:
        project = Project(source_url="https://x.com/i/status/2", source_post_id="2")
        session.add(project)
        session.flush()
        render = Render(
            project_id=project.id,
            status="complete",
            path=str(video),
            layout="fit_background",
            trim_start_ms=0,
            trim_end_ms=5000,
            captions_enabled=True,
            caption_style="bold",
        )
        session.add(render)
        session.commit()

        now = int(datetime.now(timezone.utc).timestamp())
        expires = now + 600
        signature = instagram.sign_media_url(render.id, expires, key)
        monkeypatch.setattr(main, "settings", SimpleNamespace(token_encryption_key=key))

        response = main.serve_instagram_render(render.id, expires, signature, session)
        assert Path(response.path) == video
        assert response.media_type == "video/mp4"
        assert response.headers["cache-control"] == "private, no-store"

        with pytest.raises(HTTPException) as invalid:
            main.serve_instagram_render(render.id, expires, "not-a-signature", session)
        assert invalid.value.status_code == 403

        with pytest.raises(HTTPException) as expired:
            main.serve_instagram_render(
                render.id,
                now - 1,
                instagram.sign_media_url(render.id, now - 1, key),
                session,
            )
        assert expired.value.status_code == 403


def test_publish_endpoint_queues_connected_completed_render(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'endpoint.db'}")
    Base.metadata.create_all(engine)
    video = tmp_path / "render.mp4"
    video.write_bytes(b"rendered-video")
    queued: dict[str, str] = {}
    monkeypatch.setattr(
        instagram_publisher,
        "settings",
        SimpleNamespace(instagram_is_configured=True, external_base_url="https://clips.example"),
    )
    monkeypatch.setattr(
        main,
        "publish_task",
        lambda publication_id, job_id: queued.update(
            publication_id=publication_id, job_id=job_id
        ),
    )

    with Session(engine) as session:
        project = Project(source_url="https://x.com/i/status/3", source_post_id="3")
        session.add(project)
        session.flush()
        render = Render(
            project_id=project.id,
            status="complete",
            path=str(video),
            layout="fit_background",
            trim_start_ms=0,
            trim_end_ms=5000,
            captions_enabled=True,
            caption_style="bold",
        )
        account = PlatformAccount(
            platform="instagram",
            remote_user_id="ig-user-1",
            username="clipfarmer",
            access_token_encrypted="encrypted-token",
            scopes="instagram_business_basic,instagram_business_content_publish",
        )
        session.add_all([render, account])
        session.commit()

        job = main.publish_render(
            render.id,
            "instagram",
            PublishRequest(caption="  Reel caption  ", share_to_feed=False),
            session,
        )
        publication = session.query(Publication).one()

        assert job.kind == "publish_instagram" and job.status == "queued"
        assert publication.caption == "Reel caption"
        assert publication.share_to_feed is False
        assert queued == {"publication_id": publication.id, "job_id": job.id}
