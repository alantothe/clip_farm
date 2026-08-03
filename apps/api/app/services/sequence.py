"""Flattening a Sequence with Cutaways back into a list of stretches to join.

A Cutaway covers the whole frame, so a Base Shot with one on it is just three
shorter stretches in a row — base, cutaway, base. That is why ADR 0003's join
survives Cutaways untouched: the Sequence is still a concatenation, and nothing
has to be composited.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models import Shot


@dataclass(frozen=True)
class Segment:
    """One stretch of the finished video: whose picture, and whose sound.

    Times are offsets into each Shot's Clip's Source Video, ready to hand to
    `render_vertical` — not offsets into the Sequence.
    """

    picture: Shot
    picture_start_ms: int
    picture_end_ms: int
    #: Set only when the picture comes from a Cutaway, whose own audio is
    #: replaced by the Base Shot's for this stretch.
    audio: Shot | None = None
    audio_start_ms: int = 0
    audio_end_ms: int = 0

    @property
    def duration_ms(self) -> int:
        return self.picture_end_ms - self.picture_start_ms

    @property
    def is_covered(self) -> bool:
        return self.audio is not None


def plan_segments(base: Shot) -> list[Segment]:
    """Cut a Base Shot at the edges of the Cutaways covering it.

    A Cutaway is clipped to whatever of its Base Shot remains — trimming a Base
    Shot shorter than the Cutaway on it is an ordinary edit, not an error, and
    one left entirely past the end simply does not render (ADR 0005).
    """
    base_start, base_end = base.span()
    if base_end is None or base_end <= base_start:
        return []
    span = base_end - base_start

    segments: list[Segment] = []
    cursor = 0
    for cutaway in sorted(base.cutaways, key=lambda shot: shot.offset_ms or 0):
        cut_start, cut_end = cutaway.span()
        if cut_end is None or cut_end <= cut_start:
            continue
        start = max(cursor, cutaway.offset_ms or 0)
        # Whatever of the Cutaway fits in what is left of the Base Shot.
        end = min(start + (cut_end - cut_start), span)
        if end <= start:
            continue

        if start > cursor:
            segments.append(
                Segment(
                    picture=base,
                    picture_start_ms=base_start + cursor,
                    picture_end_ms=base_start + start,
                )
            )
        segments.append(
            Segment(
                picture=cutaway,
                picture_start_ms=cut_start,
                picture_end_ms=cut_start + (end - start),
                audio=base,
                audio_start_ms=base_start + start,
                audio_end_ms=base_start + end,
            )
        )
        cursor = end

    if cursor < span:
        segments.append(
            Segment(
                picture=base,
                picture_start_ms=base_start + cursor,
                picture_end_ms=base_end,
            )
        )
    return segments


def plan_sequence(shots: list[Shot]) -> list[Segment]:
    """Every stretch of the finished video, in play order."""
    segments: list[Segment] = []
    for shot in shots:
        segments.extend(plan_segments(shot))
    return segments
