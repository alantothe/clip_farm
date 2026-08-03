"""Sequence duration and layers whose back edge follows it."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BatchMedia, Shot, Title


def sequence_duration_ms(session: Session, batch_id: str) -> int:
    shots = session.scalars(
        select(Shot)
        .where(Shot.batch_id == batch_id, Shot.parent_shot_id.is_(None))
        .order_by(Shot.position)
    ).all()
    total = 0
    for shot in shots:
        start, end = shot.span()
        if end is not None:
            total += max(0, end - start)
    return total


def sync_sequence_end_layers(session: Session, batch_id: str) -> int:
    """Move every end-bound layer's back edge to the current Sequence end."""
    duration = sequence_duration_ms(session, batch_id)
    for title in session.scalars(
        select(Title).where(Title.batch_id == batch_id, Title.end_at_sequence_end.is_(True))
    ).all():
        title.end_ms = duration
    for item in session.scalars(
        select(BatchMedia).where(
            BatchMedia.batch_id == batch_id,
            BatchMedia.end_at_sequence_end.is_(True),
        )
    ).all():
        item.end_ms = duration
    return duration
