"""Instagram Reels implementation of the Publisher protocol.

The Reels rules and the container/poll/publish dance used to be split across the
route (validation), the worker task (upload), and the frontend (button state).
They live here now.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from app.config import get_settings
from app.publishers.base import (
    AccountNotReady,
    PublishContext,
    PublisherNotConfigured,
    PublishError,
    PublishResult,
    RenderNotPostable,
    register,
)
from app.services.instagram import (
    create_reel_container,
    decrypt_token,
    encrypt_token,
    get_container_status,
    get_media_permalink,
    publish_reel,
    refresh_long_lived_token,
    sign_media_url,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.orm import Session

    from app.models import PlatformAccount, Render


settings = get_settings()

MIN_DURATION_MS = 3_000
MAX_DURATION_MS = 15 * 60 * 1000
MAX_SIZE_BYTES = 1_000_000_000

# Refresh a long-lived token once it is inside this window of expiring.
REFRESH_WINDOW = timedelta(days=7)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class InstagramPublisher:
    platform = "instagram"
    required_scopes = ("instagram_business_content_publish",)

    def check_configured(self) -> None:
        if not settings.instagram_is_configured:
            raise PublisherNotConfigured("Instagram publishing is not configured")
        if not settings.external_base_url.startswith("https://"):
            raise PublisherNotConfigured(
                "Set PUBLIC_BASE_URL to the public HTTPS address of Clip Farm before posting"
            )

    def check_render(self, render: "Render") -> None:
        if render.status != "complete" or not render.path or not Path(render.path).is_file():
            raise RenderNotPostable("The rendered video is no longer available")
        if render.duration_ms is not None:
            if render.duration_ms < MIN_DURATION_MS:
                raise RenderNotPostable("Instagram Reels must be at least 3 seconds")
            if render.duration_ms > MAX_DURATION_MS:
                raise RenderNotPostable("Instagram Reels cannot exceed 15 minutes")
        if Path(render.path).stat().st_size > MAX_SIZE_BYTES:
            raise RenderNotPostable("Instagram Reels must be smaller than 1 GB")

    def access_token(self, session: "Session", account: "PlatformAccount") -> str:
        key = settings.token_encryption_key or ""
        access_token = decrypt_token(account.access_token_encrypted, key)
        expires_at = _as_utc(account.token_expires_at)
        if expires_at and expires_at <= _now():
            account.status = "expired"
            session.commit()
            raise AccountNotReady("The Instagram login expired; reconnect the account")
        if expires_at and expires_at <= _now() + REFRESH_WINDOW:
            refreshed = refresh_long_lived_token(access_token, settings)
            access_token = refreshed.access_token
            account.access_token_encrypted = encrypt_token(access_token, key)
            account.token_expires_at = refreshed.expires_at
            account.updated_at = _now()
            session.commit()
        return access_token

    def _signed_media_url(self, render_id: str) -> str:
        expires = int(time.time()) + settings.instagram_media_url_ttl_seconds
        signature = sign_media_url(render_id, expires, settings.token_encryption_key or "")
        return (
            f"{settings.external_base_url}{settings.api_prefix}/media/instagram/{render_id}"
            f"?expires={expires}&signature={signature}"
        )

    def publish(self, context: PublishContext) -> PublishResult:
        publication = context.publication
        render = context.render
        token = context.access_token

        context.report(12, "Sending video to Instagram")
        container_id = create_reel_container(
            remote_user_id=context.account.remote_user_id,
            access_token=token,
            video_url=self._signed_media_url(render.id),
            caption=publication.caption,
            share_to_feed=publication.share_to_feed,
            settings=settings,
        )
        # Persisted before the poll loop so a later failure still records which
        # container Instagram was working on.
        publication.remote_container_id = container_id
        context.report(24, "Instagram is processing the Reel")

        self._await_container(container_id, token, context)

        publication.status = "publishing"
        context.report(90, "Publishing Reel to Instagram")
        media_id = publish_reel(
            remote_user_id=context.account.remote_user_id,
            container_id=container_id,
            access_token=token,
            settings=settings,
        )
        return PublishResult(
            remote_media_id=media_id,
            permalink=get_media_permalink(media_id, token, settings),
        )

    def _await_container(self, container_id: str, token: str, context: PublishContext) -> None:
        timeout = settings.instagram_processing_timeout_seconds
        deadline = time.monotonic() + timeout
        while True:
            status_code, _status_message = get_container_status(container_id, token, settings)
            if status_code == "FINISHED":
                return
            if status_code in {"ERROR", "EXPIRED"}:
                raise PublishError("Instagram could not process the rendered video")
            if time.monotonic() >= deadline:
                raise PublishError(
                    "Instagram took too long to process the Reel; try posting again"
                )
            remaining = max(0, deadline - time.monotonic())
            elapsed_fraction = 1 - (remaining / max(1, timeout))
            context.report(
                min(82, 24 + round(elapsed_fraction * 58)),
                "Instagram is processing the Reel",
            )
            time.sleep(settings.instagram_poll_interval_seconds)


register(InstagramPublisher())
