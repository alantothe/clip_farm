"""Platform-agnostic seam for posting a finished render to a social account.

Every destination differs in four ways: what makes a render postable, what a
connected account must be allowed to do, how its access token is kept fresh, and
the API dance that actually uploads the file. Publisher isolates those four so
adding TikTok or YouTube is a new module plus a registry entry, instead of edits
spread across the route, the worker task, and the frontend.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.orm import Session

    from app.models import PlatformAccount, Publication, Render


class PublishError(RuntimeError):
    """A publish attempt failed for a reason worth showing the user.

    Carries the HTTP status the route should surface, so platform rules live
    with the platform rather than in a chain of route-level if statements.
    """

    def __init__(self, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class RenderNotPostable(PublishError):
    """The render violates a platform rule (duration, size, format)."""

    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=422)


class PublisherNotConfigured(PublishError):
    """The deployment is missing credentials or public URLs this platform needs."""

    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=503)


class AccountNotReady(PublishError):
    """No usable connection: missing, disconnected, expired, or under-scoped."""

    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=409)


@dataclass
class PublishContext:
    """Everything a publisher needs for one upload attempt.

    `report` persists incremental progress to the job row; publishers call it
    instead of touching job or session plumbing themselves.
    """

    publication: "Publication"
    account: "PlatformAccount"
    render: "Render"
    access_token: str
    report: Callable[[int, str], None]


@dataclass
class PublishResult:
    remote_media_id: str
    permalink: str | None = None


class Publisher(Protocol):
    """One social destination."""

    platform: str
    required_scopes: tuple[str, ...]

    def check_configured(self) -> None:
        """Raise PublisherNotConfigured if the deployment cannot post at all."""

    def check_render(self, render: "Render") -> None:
        """Raise RenderNotPostable if this platform would reject the file."""

    def access_token(self, session: "Session", account: "PlatformAccount") -> str:
        """Return a usable token, refreshing and persisting it when needed."""

    def publish(self, context: PublishContext) -> PublishResult:
        """Upload the render. Raise PublishError on failure."""


_PUBLISHERS: dict[str, Publisher] = {}


def register(publisher: Publisher) -> Publisher:
    _PUBLISHERS[publisher.platform] = publisher
    return publisher


def get_publisher(platform: str) -> Publisher:
    try:
        return _PUBLISHERS[platform]
    except KeyError:
        raise PublishError(
            f"Clip Farm cannot post to {platform!r} yet", status_code=404
        ) from None


def available_platforms() -> list[str]:
    return sorted(_PUBLISHERS)


def check_account(publisher: Publisher, account: "PlatformAccount | None") -> None:
    """Shared connection preflight: connected, and granted the right scopes."""
    if not account or account.status != "connected":
        raise AccountNotReady(f"Connect {publisher.platform.title()} before posting")
    granted = {scope for scope in account.scopes.split(",") if scope}
    missing = [scope for scope in publisher.required_scopes if scope not in granted]
    if missing:
        raise AccountNotReady(
            f"Reconnect {publisher.platform.title()} and grant content publishing access"
        )
