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


#: The looks an operator picks from, and the whole of what most of them will
#: ever touch. They are the editor's main control rather than a shortcut past
#: it, so there are enough of them to answer "which one of these is it" without
#: opening a font list: each names a different vendored family, and no two share
#: a case, a placement, a colour and a way of standing off the picture.
#:
#: Ordered roughly by how often a reel wants them — the hook and the caption bar
#: first, the party pieces last — because the first is also what a new Title is
#: made from.
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
    {
        "id": f"{BUILTIN_PREFIX}broadcast",
        "name": "Broadcast",
        "font_family": "oswald",
        "font_weight": 700,
        "uppercase": True,
        "font_size_percent": 3.8,
        "letter_spacing": 0.06,
        "color": "#FFFFFF",
        "background": "box",
        "background_color": "#C81E1E",
        "background_opacity": 1.0,
        "background_padding": 0.32,
        "outline_width": 0.0,
        "center_y": 82.0,
        "width_percent": 70.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}subtitle",
        "name": "Subtitle",
        "font_family": "lato",
        "font_weight": 700,
        "font_size_percent": 4.4,
        "color": "#FFF000",
        "outline_color": "#000000",
        "outline_width": 0.08,
        "shadow_offset": 0.03,
        "center_y": 86.0,
        "width_percent": 84.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}punch",
        "name": "Punch",
        "font_family": "rubik",
        "font_weight": 900,
        "uppercase": True,
        "font_size_percent": 6.0,
        "color": "#FFFFFF",
        "background": "box",
        "background_color": "#1E40FF",
        "background_opacity": 1.0,
        "background_padding": 0.28,
        "outline_width": 0.0,
        "center_y": 32.0,
        "width_percent": 70.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}poster",
        "name": "Poster",
        "font_family": "archivo-black",
        "font_weight": 400,
        "uppercase": True,
        "font_size_percent": 7.0,
        "color": "#FFFFFF",
        "outline_width": 0.0,
        "shadow_color": "#FF3B30",
        "shadow_offset": 0.06,
        "center_y": 50.0,
        "width_percent": 82.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}meme",
        "name": "Meme",
        "font_family": "bangers",
        "font_weight": 400,
        "font_size_percent": 7.0,
        "letter_spacing": 0.02,
        "color": "#FFFFFF",
        "outline_color": "#000000",
        "outline_width": 0.12,
        "center_y": 84.0,
        "width_percent": 88.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}neon",
        "name": "Neon",
        "font_family": "bebas-neue",
        "font_weight": 400,
        "uppercase": True,
        "font_size_percent": 8.0,
        "letter_spacing": 0.05,
        "color": "#7CF9FF",
        "outline_color": "#101018",
        "outline_width": 0.03,
        "shadow_color": "#FF00C8",
        "shadow_offset": 0.05,
        "center_y": 30.0,
        "width_percent": 78.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}quote",
        "name": "Quote",
        "font_family": "merriweather",
        "font_weight": 400,
        "italic": True,
        "font_size_percent": 4.6,
        "color": "#FFFFFF",
        "outline_width": 0.0,
        "shadow_offset": 0.04,
        "center_y": 50.0,
        "width_percent": 66.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}ticket",
        "name": "Ticket",
        "font_family": "teko",
        "font_weight": 700,
        "uppercase": True,
        "font_size_percent": 6.5,
        "letter_spacing": 0.1,
        "color": "#101010",
        "background": "box",
        "background_color": "#FFFFFF",
        "background_opacity": 1.0,
        "background_padding": 0.3,
        "outline_width": 0.0,
        "center_y": 18.0,
        "width_percent": 60.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}headline",
        "name": "Headline",
        "font_family": "roboto-condensed",
        "font_weight": 700,
        "uppercase": True,
        "font_size_percent": 5.2,
        "color": "#FFFFFF",
        "outline_color": "#000000",
        "outline_width": 0.07,
        "center_y": 88.0,
        "width_percent": 90.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}tag",
        "name": "Tag",
        "font_family": "space-grotesk",
        "font_weight": 700,
        "uppercase": True,
        "font_size_percent": 3.6,
        "letter_spacing": 0.08,
        "color": "#0B0B0B",
        "background": "box",
        "background_color": "#7CF29C",
        "background_opacity": 1.0,
        "background_padding": 0.35,
        "outline_width": 0.0,
        "center_y": 14.0,
        "width_percent": 50.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}clean",
        "name": "Clean",
        "font_family": "poppins",
        "font_weight": 400,
        "font_size_percent": 4.8,
        "letter_spacing": 0.02,
        "color": "#FFFFFF",
        "outline_width": 0.0,
        "shadow_offset": 0.03,
        "center_y": 50.0,
        "width_percent": 74.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}stamp",
        "name": "Stamp",
        "font_family": "fjalla-one",
        "font_weight": 400,
        "uppercase": True,
        "font_size_percent": 4.6,
        "letter_spacing": 0.14,
        "color": "#FFFFFF",
        "outline_color": "#000000",
        "outline_width": 0.05,
        "center_y": 20.0,
        "width_percent": 55.0,
        "rotation_deg": -8.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}note",
        "name": "Note",
        "font_family": "caveat",
        "font_weight": 700,
        "font_size_percent": 7.0,
        "color": "#FFFFFF",
        "outline_width": 0.0,
        "shadow_color": "#000000",
        "shadow_offset": 0.04,
        "center_y": 62.0,
        "width_percent": 60.0,
        "rotation_deg": 2.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}signature",
        "name": "Signature",
        "font_family": "pacifico",
        "font_weight": 400,
        "font_size_percent": 6.0,
        "color": "#FFD9A0",
        "outline_color": "#2A1B0E",
        "outline_width": 0.06,
        "center_y": 72.0,
        "width_percent": 68.0,
        "rotation_deg": -2.0,
    },
    {
        "id": f"{BUILTIN_PREFIX}retro",
        "name": "Retro",
        "font_family": "lobster",
        "font_weight": 400,
        "font_size_percent": 7.5,
        "color": "#FFEFC2",
        "outline_color": "#3B1F0B",
        "outline_width": 0.07,
        "shadow_color": "#E0553B",
        "shadow_offset": 0.05,
        "center_y": 34.0,
        "width_percent": 76.0,
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
