from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.routers import publishing
from app.database import Base
from app.models import PlatformAccount, Project, Render
from app.publishers import (
    AccountNotReady,
    PublishError,
    RenderNotPostable,
    available_platforms,
    check_account,
    get_publisher,
)
from app.publishers import instagram as instagram_publisher
from app.schemas import PublishRequest


def test_instagram_is_registered() -> None:
    assert available_platforms() == ["instagram"]
    assert get_publisher("instagram").platform == "instagram"


def test_unknown_platform_is_a_404_not_a_crash() -> None:
    with pytest.raises(PublishError) as excinfo:
        get_publisher("myspace")
    assert excinfo.value.status_code == 404


def test_check_account_requires_a_connected_account() -> None:
    publisher = get_publisher("instagram")
    with pytest.raises(AccountNotReady):
        check_account(publisher, None)
    with pytest.raises(AccountNotReady):
        check_account(
            publisher,
            SimpleNamespace(status="expired", scopes="instagram_business_content_publish"),
        )


def test_check_account_requires_the_publishing_scope() -> None:
    publisher = get_publisher("instagram")
    with pytest.raises(AccountNotReady, match="grant content publishing access"):
        check_account(publisher, SimpleNamespace(status="connected", scopes="instagram_business_basic"))
    check_account(
        publisher,
        SimpleNamespace(
            status="connected",
            scopes="instagram_business_basic,instagram_business_content_publish",
        ),
    )


@pytest.mark.parametrize(
    ("duration_ms", "expected"),
    [
        (2_999, "at least 3 seconds"),
        (15 * 60 * 1000 + 1, "cannot exceed 15 minutes"),
    ],
)
def test_reel_duration_rules_live_in_the_publisher(tmp_path, duration_ms, expected) -> None:
    video = tmp_path / "render.mp4"
    video.write_bytes(b"x")
    render = SimpleNamespace(status="complete", path=str(video), duration_ms=duration_ms)
    with pytest.raises(RenderNotPostable, match=expected):
        get_publisher("instagram").check_render(render)


def test_publish_route_rejects_an_unsupported_platform(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'route.db'}")
    Base.metadata.create_all(engine)
    video = tmp_path / "render.mp4"
    video.write_bytes(b"rendered-video")

    monkeypatch.setattr(
        instagram_publisher,
        "settings",
        SimpleNamespace(instagram_is_configured=True, external_base_url="https://clips.example"),
    )

    with Session(engine) as session:
        project = Project(source_url="https://x.com/i/status/9", source_post_id="9")
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

        with pytest.raises(HTTPException) as excinfo:
            publishing.publish_render(render.id, "tiktok", PublishRequest(caption="hi"), session)
        assert excinfo.value.status_code == 404
