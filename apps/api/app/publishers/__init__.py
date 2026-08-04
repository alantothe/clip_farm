"""Social publishing destinations.

Importing this package registers every built-in publisher, so callers can go
straight to `get_publisher(platform)`.
"""

from app.publishers.base import (
    AccountNotReady,
    PostRejected,
    PostableVideo,
    PublishContext,
    PublisherNotConfigured,
    PublishError,
    PublishResult,
    RenderNotPostable,
    available_platforms,
    check_account,
    get_publisher,
    register,
)
from app.publishers import instagram as _instagram  # noqa: F401 - registers InstagramPublisher

__all__ = [
    "AccountNotReady",
    "PostRejected",
    "PostableVideo",
    "PublishContext",
    "PublishError",
    "PublishResult",
    "PublisherNotConfigured",
    "RenderNotPostable",
    "available_platforms",
    "check_account",
    "get_publisher",
    "register",
]
