"""Turning a stored row into something a publisher can upload.

Two tables hold a finished video: `renders` for a Clip and `sequence_renders`
for a Batch (ADR 0003). Publishers are written against neither — they take a
PostableVideo (ADR 0012) — so this is the one module that knows both, including
which route serves each one's bytes.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from app.config import get_settings
from app.publishers.base import PostableVideo, RenderNotPostable

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.models import Render, SequenceRender


settings = get_settings()


def _checked(path: str | None) -> str:
    if not path or not Path(path).is_file():
        raise RenderNotPostable("The rendered video is no longer available")
    return path


def video_for_render(render: "Render") -> PostableVideo:
    if render.status != "complete":
        raise RenderNotPostable("The rendered video is not finished")
    return PostableVideo(
        id=render.id,
        path=_checked(render.path),
        duration_ms=render.duration_ms,
        media_path=f"{settings.api_prefix}/media/instagram/{render.id}",
    )


def video_for_sequence_render(sequence_render: "SequenceRender") -> PostableVideo:
    if sequence_render.status != "complete":
        raise RenderNotPostable("Export the timeline before posting it")
    return PostableVideo(
        id=sequence_render.id,
        path=_checked(sequence_render.path),
        duration_ms=sequence_render.duration_ms,
        media_path=(
            f"{settings.api_prefix}/media/instagram/sequences/{sequence_render.id}"
        ),
    )
