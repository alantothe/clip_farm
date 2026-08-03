"""The vendored Title faces, and how a stored font choice reaches a file.

A Title stores a family id and a weight — `("inter", 900)`. Turning that into
something that draws is this module's whole job, and it is not a formality:
libass matches faces by *name* and carries a bold boolean rather than a weight
axis, so "Inter at 900" has to become the exact name inside exactly one file
before it means anything (ADR 0008).

`tools/vendor_fonts.py` writes `catalog.json` alongside the faces and records
that name per file. Nothing here infers it.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

FONTS_DIR = Path(__file__).resolve().parents[2] / "fonts"

#: What a Title falls back to when its family is gone — which today only happens
#: to a Title written before a family was dropped from the catalog.
DEFAULT_FAMILY = "inter"
DEFAULT_WEIGHT = 900


class FontsUnavailable(RuntimeError):
    """The vendored faces are missing, so no Title can be drawn as chosen."""


@lru_cache(maxsize=1)
def catalog() -> dict:
    path = FONTS_DIR / "catalog.json"
    if not path.is_file():
        raise FontsUnavailable(
            f"No font catalog at {path}. Run tools/vendor_fonts.py to vendor the Title faces."
        )
    return json.loads(path.read_text(encoding="utf-8"))


def families() -> list[dict]:
    """Every family an operator can pick, with the weights it actually has."""
    return catalog()["families"]


@lru_cache(maxsize=1)
def _faces_by_family() -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for face in catalog()["faces"]:
        grouped.setdefault(face["family"], []).append(face)
    for faces in grouped.values():
        faces.sort(key=lambda face: face["weight"])
    return grouped


def resolve_face(family: str, weight: int) -> dict:
    """The one vendored file a family-and-weight choice means.

    An unknown family falls back to the default rather than raising: a Title
    written against a family later dropped from the catalog should render in
    something, not fail an export that is otherwise fine. The weight falls back
    to the nearest the family actually has, which is why Bebas Neue — a single
    400 face — can still be asked for at 900.
    """
    grouped = _faces_by_family()
    faces = grouped.get(family) or grouped.get(DEFAULT_FAMILY)
    if not faces:
        raise FontsUnavailable("The font catalog lists no faces")
    return min(faces, key=lambda face: abs(face["weight"] - weight))


def face_path(face: dict) -> Path:
    return FONTS_DIR / face["file"]


def is_available() -> bool:
    """Whether Titles can be drawn at all. False in a checkout with no faces."""
    try:
        return bool(catalog()["faces"])
    except (FontsUnavailable, KeyError, json.JSONDecodeError):
        return False
