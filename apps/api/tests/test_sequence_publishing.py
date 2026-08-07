"""Publishing a Batch's Sequence Render, and the seam that made it possible.

ADR 0003 left publishing a Batch out because `publications.render_id` points at
a Clip's Render. ADR 0012 added the second target rather than reshaping the
first, so these cover both the new route and the fact that the old one still
posts what it always did.
"""

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from cryptography.fernet import Fernet
from fastapi import HTTPException
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    Batch,
    PlatformAccount,
    SequencePublication,
    SequenceRender,
    StoredImage,
)
from app.publishers import PostRejected, get_publisher
from app.publishers import instagram as instagram_publisher
from app.publishers.base import PostableVideo
from app.publishers.targets import video_for_sequence_render
from app.routers import media, publishing
from app.schemas import SequencePublishRequest
from app.services import instagram
from app import tasks


CONNECTED_SCOPES = "instagram_business_basic,instagram_business_content_publish"


def _batch_with_export(session: Session, video: Path, *, status: str = "complete") -> Batch:
    batch = Batch(name="Sunday cut")
    session.add(batch)
    session.flush()
    sequence_render = SequenceRender(
        batch_id=batch.id,
        status=status,
        progress=100 if status == "complete" else 0,
        message="Done" if status == "complete" else "Queued",
        path=str(video),
        duration_ms=9_000,
        shot_count=3,
    )
    account = PlatformAccount(
        platform="instagram",
        remote_user_id="ig-user-1",
        username="clipfarmer",
        access_token_encrypted="encrypted-token",
        scopes=CONNECTED_SCOPES,
    )
    session.add_all([sequence_render, account])
    session.commit()
    return batch


def _configured(monkeypatch) -> None:
    monkeypatch.setattr(
        instagram_publisher,
        "settings",
        SimpleNamespace(
            instagram_is_configured=True,
            external_base_url="https://clips.example",
        ),
    )


def test_publish_route_queues_a_sequence_render_per_platform(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'sequence-publish.db'}")
    Base.metadata.create_all(engine)
    video = tmp_path / "sequence.mp4"
    video.write_bytes(b"joined-video")
    queued: list[str] = []
    _configured(monkeypatch)
    monkeypatch.setattr(
        publishing, "publish_sequence_task", lambda publication_id: queued.append(publication_id)
    )

    with Session(engine) as session:
        batch = _batch_with_export(session, video)

        publication = publishing.publish_sequence(
            batch.id,
            "instagram",
            SequencePublishRequest(
                caption="  A caption with #one tag  ",
                options={"share_to_feed": False, "thumb_offset_ms": 1_500},
            ),
            session,
        )

        assert publication.status == "queued"
        assert publication.caption == "A caption with #one tag"
        assert publication.options == {"share_to_feed": False, "thumb_offset_ms": 1_500}
        assert queued == [publication.id]


def test_publish_route_rejects_a_cover_deleted_from_storage(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'missing-cover.db'}")
    Base.metadata.create_all(engine)
    video = tmp_path / "sequence.mp4"
    video.write_bytes(b"joined-video")
    _configured(monkeypatch)

    with Session(engine) as session:
        batch = _batch_with_export(session, video)

        with pytest.raises(HTTPException) as missing:
            publishing.publish_sequence(
                batch.id,
                "instagram",
                SequencePublishRequest(
                    caption="Cover",
                    options={"cover_image_id": "deleted-cover"},
                ),
                session,
            )

        assert missing.value.status_code == 422
        assert "no longer in Storage" in missing.value.detail


def test_publishing_the_same_export_twice_is_refused(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'twice.db'}")
    Base.metadata.create_all(engine)
    video = tmp_path / "sequence.mp4"
    video.write_bytes(b"joined-video")
    _configured(monkeypatch)
    monkeypatch.setattr(publishing, "publish_sequence_task", lambda _publication_id: None)

    with Session(engine) as session:
        batch = _batch_with_export(session, video)
        request = SequencePublishRequest(caption="Once")
        publishing.publish_sequence(batch.id, "instagram", request, session)

        with pytest.raises(HTTPException) as already:
            publishing.publish_sequence(batch.id, "instagram", request, session)
        assert already.value.status_code == 409

        # A finished post is refused too, rather than posting the file twice.
        session.query(SequencePublication).one().status = "complete"
        session.commit()
        with pytest.raises(HTTPException) as posted:
            publishing.publish_sequence(batch.id, "instagram", request, session)
        assert posted.value.status_code == 409
        assert "already been posted" in posted.value.detail


def test_publishing_an_unexported_batch_is_refused(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'unexported.db'}")
    Base.metadata.create_all(engine)
    _configured(monkeypatch)

    with Session(engine) as session:
        batch = Batch(name="Nothing rendered yet")
        session.add(batch)
        session.commit()

        with pytest.raises(HTTPException) as missing:
            publishing.publish_sequence(
                batch.id, "instagram", SequencePublishRequest(caption="Hi"), session
            )
        assert missing.value.status_code == 404
        assert "Export the timeline" in missing.value.detail


def test_a_running_export_is_not_postable(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'running.db'}")
    Base.metadata.create_all(engine)
    video = tmp_path / "sequence.mp4"
    video.write_bytes(b"joined-video")
    _configured(monkeypatch)

    with Session(engine) as session:
        batch = _batch_with_export(session, video, status="running")
        with pytest.raises(HTTPException) as unfinished:
            publishing.publish_sequence(
                batch.id, "instagram", SequencePublishRequest(caption="Hi"), session
            )
        assert unfinished.value.status_code == 422


def test_caption_limits_are_the_platforms_and_not_the_routes() -> None:
    publisher = get_publisher("instagram")

    caption, options = publisher.prepare_post("  Clean  ", {})
    assert caption == "Clean"
    # Absent options come back as the platform's defaults, not as nothing.
    assert options == {"share_to_feed": True, "thumb_offset_ms": None}

    with pytest.raises(PostRejected, match="30 hashtags"):
        publisher.prepare_post(" ".join(f"#tag{index}" for index in range(31)), {})
    with pytest.raises(PostRejected, match="20 @mentions"):
        publisher.prepare_post(" ".join(f"@friend{index}" for index in range(21)), {})
    with pytest.raises(PostRejected, match="2,200 characters"):
        publisher.prepare_post("x" * 2_201, {})
    # An email address is one word, not a fistful of mentions.
    assert publisher.prepare_post("mail me at me@example.com", {})[0].count("@") == 1


def test_the_cover_frame_is_sent_and_kept_inside_the_video(monkeypatch) -> None:
    captured: dict[str, object] = {}
    monkeypatch.setattr(
        instagram_publisher,
        "create_reel_container",
        lambda **kwargs: (captured.update(kwargs), "container-1")[1],
    )
    monkeypatch.setattr(
        instagram_publisher, "get_container_status", lambda *_args: ("FINISHED", None)
    )
    monkeypatch.setattr(instagram_publisher, "publish_reel", lambda **_kwargs: "media-1")
    monkeypatch.setattr(instagram_publisher, "get_media_permalink", lambda *_args: None)
    monkeypatch.setattr(
        instagram_publisher,
        "settings",
        SimpleNamespace(
            instagram_is_configured=True,
            external_base_url="https://clips.example",
            api_prefix="/api",
            instagram_media_url_ttl_seconds=600,
            token_encryption_key=Fernet.generate_key().decode(),
            instagram_processing_timeout_seconds=30,
            instagram_poll_interval_seconds=0,
        ),
    )
    video = PostableVideo(
        id="sequence-1",
        path="/tmp/sequence.mp4",
        duration_ms=9_000,
        media_path="/api/media/instagram/sequences/sequence-1",
    )
    publication = SimpleNamespace(
        caption="Cover test",
        # Past the end of a 9 second video: the frame asked for does not exist.
        options={"share_to_feed": True, "thumb_offset_ms": 30_000},
        remote_container_id=None,
        status="queued",
    )

    get_publisher("instagram").publish(
        instagram_publisher.PublishContext(
            publication=publication,
            account=SimpleNamespace(remote_user_id="ig-user-1"),
            video=video,
            access_token="token",
            report=lambda *_args: None,
        )
    )

    assert captured["thumb_offset_ms"] == 8_999
    assert captured["video_url"].startswith(
        "https://clips.example/api/media/instagram/sequences/sequence-1?"
    )


def test_a_cover_image_becomes_frame_zero_in_a_post_only_video(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'embedded-cover.db'}")
    Base.metadata.create_all(engine)
    video_path = tmp_path / "sequence.mp4"
    video_path.write_bytes(b"sequence")
    cover_path = tmp_path / "cover.jpg"
    cover_path.write_bytes(b"cover")
    captured: dict = {}
    embedded: dict = {}

    with Session(engine) as session:
        batch = _batch_with_export(session, video_path)
        sequence_render = session.query(SequenceRender).one()
        cover = StoredImage(
            name="cover.jpg",
            path=str(cover_path),
            mime_type="image/jpeg",
            size_bytes=5,
        )
        session.add(cover)
        session.flush()
        publication = SequencePublication(
            batch_id=batch.id,
            sequence_render_id=sequence_render.id,
            account_id=session.query(PlatformAccount).one().id,
            platform="instagram",
            caption="Embedded cover",
            options={"share_to_feed": True, "cover_image_id": cover.id},
        )
        session.add(publication)
        session.commit()
        monkeypatch.setattr(
            instagram_publisher,
            "settings",
            SimpleNamespace(
                external_base_url="https://clips.example",
                api_prefix="/api",
                batches_dir=tmp_path / "batches",
                instagram_media_url_ttl_seconds=600,
                token_encryption_key=Fernet.generate_key().decode(),
                instagram_processing_timeout_seconds=30,
                instagram_poll_interval_seconds=0,
            ),
        )
        monkeypatch.setattr(
            instagram_publisher,
            "embed_cover_as_first_frame",
            lambda video, image, output: embedded.update(
                video=video, image=image, output=output
            ),
        )
        monkeypatch.setattr(
            instagram_publisher,
            "create_reel_container",
            lambda **kwargs: (captured.update(kwargs), "container-1")[1],
        )
        monkeypatch.setattr(
            instagram_publisher,
            "get_container_status",
            lambda *_args: ("FINISHED", None),
        )
        monkeypatch.setattr(
            instagram_publisher, "publish_reel", lambda **_kwargs: "media-1"
        )
        monkeypatch.setattr(
            instagram_publisher, "get_media_permalink", lambda *_args: None
        )

        get_publisher("instagram").publish(
            instagram_publisher.PublishContext(
                publication=publication,
                account=SimpleNamespace(remote_user_id="ig-user-1"),
                video=PostableVideo(
                    id=sequence_render.id,
                    path=str(video_path),
                    duration_ms=9_000,
                    media_path=f"/api/media/instagram/sequences/{sequence_render.id}",
                ),
                access_token="token",
                report=lambda *_args: None,
            )
        )

    assert embedded["video"] == video_path
    assert embedded["image"] == cover_path
    assert embedded["output"].name == f"{publication.id}.mp4"
    assert captured["thumb_offset_ms"] == 0
    assert "/media/instagram/publications/" in captured["video_url"]


def test_sequence_media_route_serves_only_a_signed_finished_export(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'sequence-media.db'}")
    Base.metadata.create_all(engine)
    key = Fernet.generate_key().decode()
    video = tmp_path / "sequence.mp4"
    video.write_bytes(b"joined-video")

    with Session(engine) as session:
        batch = _batch_with_export(session, video)
        sequence_render = session.query(SequenceRender).one()
        now = int(datetime.now(timezone.utc).timestamp())
        expires = now + 600
        signature = instagram.sign_media_url(sequence_render.id, expires, key)
        monkeypatch.setattr(media, "settings", SimpleNamespace(token_encryption_key=key))

        response = media.serve_instagram_sequence_render(
            sequence_render.id, expires, signature, session
        )
        assert Path(response.path) == video
        assert response.headers["cache-control"] == "private, no-store"
        assert batch.id[:8] in response.headers["content-disposition"]

        with pytest.raises(HTTPException) as invalid:
            media.serve_instagram_sequence_render(
                sequence_render.id, expires, "not-a-signature", session
            )
        assert invalid.value.status_code == 403


def test_instagram_can_fetch_the_post_only_video_with_its_embedded_cover(
    tmp_path, monkeypatch
) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'cover-video.db'}")
    Base.metadata.create_all(engine)
    key = Fernet.generate_key().decode()
    monkeypatch.setattr(
        media,
        "settings",
        SimpleNamespace(token_encryption_key=key, batches_dir=tmp_path / "batches"),
    )

    with Session(engine) as session:
        batch = _batch_with_export(session, tmp_path / "sequence.mp4")
        sequence_render = session.query(SequenceRender).one()
        publication = SequencePublication(
            batch_id=batch.id,
            sequence_render_id=sequence_render.id,
            platform="instagram",
        )
        session.add(publication)
        session.commit()
        post_video = (
            media.settings.batches_dir
            / batch.id
            / "publications"
            / f"{publication.id}.mp4"
        )
        post_video.parent.mkdir(parents=True)
        post_video.write_bytes(b"video-with-cover-at-frame-zero")
        expires = int(datetime.now(timezone.utc).timestamp()) + 600
        signature = instagram.sign_media_url(publication.id, expires, key)

        response = media.serve_instagram_publication_video(
            publication.id, expires, signature, session
        )

        assert Path(response.path) == post_video
        assert response.media_type == "video/mp4"
        assert response.headers["content-disposition"] == 'inline; filename="instagram-reel.mp4"'


def test_the_worker_reports_progress_on_the_publication_itself(tmp_path, monkeypatch) -> None:
    """A Sequence has no Clip, so it has no Job to carry progress (ADR 0003)."""
    engine = create_engine(f"sqlite:///{tmp_path / 'worker.db'}")
    Base.metadata.create_all(engine)
    video = tmp_path / "sequence.mp4"
    video.write_bytes(b"joined-video")
    monkeypatch.setattr(tasks, "SessionLocal", lambda: Session(engine))
    monkeypatch.setattr(
        instagram_publisher,
        "create_reel_container",
        lambda **_kwargs: "container-1",
    )
    monkeypatch.setattr(
        instagram_publisher, "get_container_status", lambda *_args: ("FINISHED", None)
    )
    monkeypatch.setattr(instagram_publisher, "publish_reel", lambda **_kwargs: "media-1")
    monkeypatch.setattr(
        instagram_publisher,
        "get_media_permalink",
        lambda *_args: "https://www.instagram.com/reel/test/",
    )
    monkeypatch.setattr(
        instagram_publisher,
        "settings",
        SimpleNamespace(
            instagram_is_configured=True,
            external_base_url="https://clips.example",
            api_prefix="/api",
            instagram_media_url_ttl_seconds=600,
            token_encryption_key=Fernet.generate_key().decode(),
            instagram_processing_timeout_seconds=30,
            instagram_poll_interval_seconds=0,
        ),
    )

    with Session(engine) as session:
        batch = _batch_with_export(session, video)
        sequence_render = session.query(SequenceRender).one()
        account = session.query(PlatformAccount).one()
        publication = SequencePublication(
            batch_id=batch.id,
            sequence_render_id=sequence_render.id,
            account_id=account.id,
            platform="instagram",
            caption="Posted from a batch",
            options={"share_to_feed": True, "thumb_offset_ms": None},
        )
        session.add(publication)
        session.commit()
        publication_id = publication.id

    monkeypatch.setattr(
        instagram_publisher, "decrypt_token", lambda *_args: "plain-token"
    )
    tasks.publish_sequence_task.call_local(publication_id)

    with Session(engine) as session:
        publication = session.get(SequencePublication, publication_id)
        assert publication is not None
        assert publication.status == "complete"
        assert publication.progress == 100
        assert publication.remote_media_id == "media-1"
        assert publication.permalink == "https://www.instagram.com/reel/test/"


def test_an_edit_that_keeps_the_shot_count_still_dates_the_export(tmp_path) -> None:
    """Retrimming, reframing, or adding a Title changes the cut, not the count."""
    from datetime import timedelta

    from app.routers._helpers import serialize_sequence_render

    engine = create_engine(f"sqlite:///{tmp_path / 'stale.db'}")
    Base.metadata.create_all(engine)
    video = tmp_path / "sequence.mp4"
    video.write_bytes(b"joined-video")

    with Session(engine) as session:
        batch = _batch_with_export(session, video)
        sequence_render = session.query(SequenceRender).one()

        # Exporting is not editing, so a freshly finished export is current.
        batch.updated_at = sequence_render.created_at - timedelta(seconds=1)
        session.commit()
        assert serialize_sequence_render(sequence_render, batch).stale is False

        # A Title added afterwards leaves shot_count at 3 and dates the file.
        batch.updated_at = sequence_render.created_at + timedelta(minutes=7)
        session.commit()
        current = serialize_sequence_render(sequence_render, batch)
        assert current.stale is True
        assert current.shot_count == 3


def test_exporting_does_not_count_as_editing_the_batch(tmp_path, monkeypatch) -> None:
    """Otherwise every export dates itself the instant it is made."""
    from app.routers import batches

    engine = create_engine(f"sqlite:///{tmp_path / 'export-touch.db'}")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(batches, "render_sequence_task", lambda *_args: None)

    with Session(engine) as session:
        from app.models import Project, Shot

        batch = Batch(name="Fresh")
        session.add(batch)
        session.flush()
        clip = Project(
            source_url="",
            source_post_id="",
            batch_id=batch.id,
            status="ready",
            duration_ms=4_000,
            trim_end_ms=4_000,
        )
        session.add(clip)
        session.flush()
        session.add(Shot(batch_id=batch.id, project_id=clip.id, position=0))
        session.commit()
        edited_at = batch.updated_at

        rendered = batches.render_sequence(batch.id, session)

        session.refresh(batch)
        assert batch.updated_at == edited_at
        assert rendered.stale is False


def test_a_sequence_render_names_the_route_that_serves_it(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'target.db'}")
    Base.metadata.create_all(engine)
    video = tmp_path / "sequence.mp4"
    video.write_bytes(b"joined-video")

    with Session(engine) as session:
        _batch_with_export(session, video)
        sequence_render = session.query(SequenceRender).one()
        postable = video_for_sequence_render(sequence_render)
        assert postable.id == sequence_render.id
        assert postable.media_path.endswith(f"/media/instagram/sequences/{sequence_render.id}")
        assert postable.duration_ms == 9_000
