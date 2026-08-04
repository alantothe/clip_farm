"""Instagram Reels implementation of the Publisher protocol.

The Reels rules and the container/poll/publish dance used to be split across the
route (validation), the worker task (upload), and the frontend (button state).
They live here now.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from app.config import get_settings
from app.publishers.base import (
    AccountNotReady,
    PostRejected,
    PostableVideo,
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

    from app.models import PlatformAccount


settings = get_settings()

MIN_DURATION_MS = 3_000
MAX_DURATION_MS = 15 * 60 * 1000
MAX_SIZE_BYTES = 1_000_000_000

# Refresh a long-lived token once it is inside this window of expiring.
REFRESH_WINDOW = timedelta(days=7)

# What Instagram accepts beside the video and caption. Reels take no alt text,
# and branded-content fields are Facebook Login only, so neither is reachable
# from the Instagram Login this app connects through.
MAX_CAPTION_LENGTH = 2_200
MAX_HASHTAGS = 30
MAX_MENTIONS = 20

# Counted the way Instagram counts them: a run of word characters behind the
# marker, not preceded by one, so an email address is not twenty mentions.
HASHTAG_RE = re.compile(r"(?<!\w)#\w+")
MENTION_RE = re.compile(r"(?<!\w)@[\w.]+")


@dataclass(frozen=True)
class InstagramOptions:
    """What Instagram is told beyond the caption.

    A Clip's Publication keeps `share_to_feed` in a column and has no cover
    frame; a Batch's Sequence Publication keeps both in its `options` JSON, so
    a second Platform costs no migration (ADR 0012). Reading either into one
    shape keeps that split out of `publish`.
    """

    share_to_feed: bool = True
    thumb_offset_ms: int | None = None


def _options(publication) -> InstagramOptions:
    raw = getattr(publication, "options", None)
    if not isinstance(raw, dict):
        return InstagramOptions(
            share_to_feed=bool(getattr(publication, "share_to_feed", True))
        )
    offset = raw.get("thumb_offset_ms")
    return InstagramOptions(
        share_to_feed=bool(raw.get("share_to_feed", True)),
        thumb_offset_ms=int(offset) if isinstance(offset, (int, float)) else None,
    )


def _cover_offset(offset_ms: int | None, video: PostableVideo) -> int | None:
    """Keep the chosen cover frame inside the video.

    An offset past the last frame is not a frame, and Instagram answers that
    with a container error rather than falling back to one.
    """
    if offset_ms is None:
        return None
    last_frame = max(0, (video.duration_ms or 0) - 1)
    return min(max(0, int(offset_ms)), last_frame)


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

    def prepare_post(self, caption: str, options: dict) -> tuple[str, dict]:
        text = caption.strip()
        if len(text) > MAX_CAPTION_LENGTH:
            raise PostRejected(
                f"Instagram captions stop at {MAX_CAPTION_LENGTH:,} characters"
            )
        hashtags = len(HASHTAG_RE.findall(text))
        if hashtags > MAX_HASHTAGS:
            raise PostRejected(
                f"Instagram allows {MAX_HASHTAGS} hashtags; this caption has {hashtags}"
            )
        mentions = len(MENTION_RE.findall(text))
        if mentions > MAX_MENTIONS:
            raise PostRejected(
                f"Instagram allows {MAX_MENTIONS} @mentions; this caption has {mentions}"
            )
        offset = options.get("thumb_offset_ms")
        if offset is not None and (not isinstance(offset, (int, float)) or offset < 0):
            raise PostRejected("The cover frame has to be a time inside the video")
        return text, {
            "share_to_feed": bool(options.get("share_to_feed", True)),
            "thumb_offset_ms": int(offset) if offset is not None else None,
        }

    def check_video(self, video: PostableVideo) -> None:
        if not video.path or not Path(video.path).is_file():
            raise RenderNotPostable("The rendered video is no longer available")
        if video.duration_ms is not None:
            if video.duration_ms < MIN_DURATION_MS:
                raise RenderNotPostable("Instagram Reels must be at least 3 seconds")
            if video.duration_ms > MAX_DURATION_MS:
                raise RenderNotPostable("Instagram Reels cannot exceed 15 minutes")
        if Path(video.path).stat().st_size > MAX_SIZE_BYTES:
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

    def _signed_media_url(self, video: PostableVideo) -> str:
        expires = int(time.time()) + settings.instagram_media_url_ttl_seconds
        signature = sign_media_url(video.id, expires, settings.token_encryption_key or "")
        return (
            f"{settings.external_base_url}{video.media_path}"
            f"?expires={expires}&signature={signature}"
        )

    def publish(self, context: PublishContext) -> PublishResult:
        publication = context.publication
        token = context.access_token
        options = _options(publication)

        context.report(12, "Sending video to Instagram")
        container_id = create_reel_container(
            remote_user_id=context.account.remote_user_id,
            access_token=token,
            video_url=self._signed_media_url(context.video),
            caption=publication.caption,
            share_to_feed=options.share_to_feed,
            thumb_offset_ms=_cover_offset(options.thumb_offset_ms, context.video),
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
