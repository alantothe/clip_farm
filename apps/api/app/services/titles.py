"""Clip Farm's own Title Styles, and copying a Style onto a Title.

The built-ins are code rather than seeded rows so improving one is a release
instead of a data migration, and so nothing has to write to the database on
startup — `create_all` is what builds a database here, not Alembic (ADR 0002,
ADR 0008). Their ids are prefixed, which is also what tells the API that they
cannot be edited or deleted.
"""

from __future__ import annotations

from typing import Any

from app.models import TITLE_LOOK_FIELDS, Title, TitleStyle

BUILTIN_PREFIX = "builtin:"


def is_builtin(style_id: str) -> bool:
    return style_id.startswith(BUILTIN_PREFIX)


#: Five starting points, chosen to be visibly different from each other rather
#: than to cover a grid: a heavy centred hook, a lower caption bar, a sticker,
#: a serif card, and a handwritten note.
BUILTIN_STYLES: tuple[dict[str, Any], ...] = (
    {
        "id": f"{BUILTIN_PREFIX}hook",
        "name": "Hook",
        "font_family": "anton",
        "font_weight": 400,
        "uppercase": True,
        "font_size_percent": 7.5,
        "color": "#FFFFFF",
        "outline_color": "#000000",
        "outline_width": 0.1,
        "shadow_offset": 0.04,
        "center_y": 26.0,
        "width_percent": 84.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}caption-bar",
        "name": "Caption bar",
        "font_family": "inter",
        "font_weight": 700,
        "font_size_percent": 4.2,
        "color": "#FFFFFF",
        "background": "box",
        "background_color": "#000000",
        "background_opacity": 0.72,
        "background_padding": 0.35,
        "outline_width": 0.0,
        "center_y": 78.0,
        "width_percent": 76.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}sticker",
        "name": "Sticker",
        "font_family": "montserrat",
        "font_weight": 900,
        "uppercase": True,
        "font_size_percent": 5.0,
        "letter_spacing": 0.04,
        "color": "#111111",
        "background": "box",
        "background_color": "#FFE500",
        "background_opacity": 1.0,
        "background_padding": 0.3,
        "outline_width": 0.0,
        "center_y": 22.0,
        "width_percent": 62.0,
        "rotation_deg": -4.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}serif-card",
        "name": "Serif card",
        "font_family": "playfair-display",
        "font_weight": 900,
        "font_size_percent": 6.5,
        "color": "#F7F3EA",
        "outline_color": "#1A1712",
        "outline_width": 0.05,
        "shadow_offset": 0.05,
        "center_y": 46.0,
        "width_percent": 72.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}handwritten",
        "name": "Handwritten",
        "font_family": "permanent-marker",
        "font_weight": 400,
        "font_size_percent": 6.0,
        "color": "#FFFFFF",
        "outline_color": "#0B0B0B",
        "outline_width": 0.09,
        "center_y": 68.0,
        "width_percent": 70.0,
        "rotation_deg": -3.0,
    },
)


def builtin_style(style_id: str) -> dict[str, Any] | None:
    return next((style for style in BUILTIN_STYLES if style["id"] == style_id), None)


def look_of(source: TitleStyle | dict[str, Any]) -> dict[str, Any]:
    """A Style's look and placement, as the fields a Title stores them in.

    A built-in Style is a partial dict — it names only what it changes — so the
    gaps come from the model's own column defaults rather than from a second
    copy of them written out here.
    """
    if isinstance(source, dict):
        defaults = {
            field: Title.__table__.columns[field].default.arg for field in TITLE_LOOK_FIELDS
        }
        return {**defaults, **{k: v for k, v in source.items() if k in TITLE_LOOK_FIELDS}}
    return {field: getattr(source, field) for field in TITLE_LOOK_FIELDS}


def apply_style(title: Title, source: TitleStyle | dict[str, Any]) -> None:
    """Copy a Style onto a Title. A copy, never a link (ADR 0008)."""
    for field, value in look_of(source).items():
        setattr(title, field, value)


def titles_in_span(
    titles: list[Title], start_ms: int, duration_ms: int
) -> list[tuple[Title, int, int]]:
    """The Titles visible during one segment, timed from that segment's start.

    A Sequence is rendered as separate segments and concatenated, so a Title
    long enough to cross a cut has to be sliced and burned into each piece with
    its times rebased (ADR 0008). The seam does not show because every piece
    positions the text identically in frame; only the picture behind it changes.

    Touching is not overlapping: a Title ending exactly where a segment begins
    is not in it, the same rule `plan_segments` uses for Cutaways.
    """
    end_ms = start_ms + duration_ms
    visible = []
    for title in titles:
        if not title.text.strip() or title.end_ms <= start_ms or title.start_ms >= end_ms:
            continue
        visible.append(
            (
                title,
                max(0, title.start_ms - start_ms),
                min(duration_ms, title.end_ms - start_ms),
            )
        )
    return visible
