"""Editing a Batch's Sequence: which Clips are Shots, and in what order."""

from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.routers import _helpers, batches as batches_router, projects as projects_router
from app.database import Base
from app.models import Batch, Project, Shot
from app.schemas import BatchCreate, ShotCreate, ShotMove


def make_session(tmp_path) -> Session:
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    return Session(engine)


def use_projects_dir(monkeypatch, tmp_path) -> None:
    settings = SimpleNamespace(
        projects_dir=tmp_path / "projects",
        api_prefix="/api",
        max_source_bytes=1_000_000,
    )
    monkeypatch.setattr(batches_router, "settings", settings)
    monkeypatch.setattr(_helpers, "settings", settings)


def make_batch_with_clips(session: Session, count: int) -> tuple[str, list[str]]:
    batch = Batch(name="Monday")
    session.add(batch)
    session.flush()
    clip_ids = []
    for index in range(count):
        clip_id = f"clip-{index}"
        session.add(
            Project(
                id=clip_id,
                batch_id=batch.id,
                origin_kind="upload",
                title=f"Clip {index}",
                status="ready",
            )
        )
        clip_ids.append(clip_id)
    session.commit()
    return batch.id, clip_ids


def order(batch) -> list[str]:
    """The Sequence as clip ids, in play order."""
    return [shot.clip_id for shot in sorted(batch.shots, key=lambda item: item.position)]


def test_a_clip_joins_the_sequence_at_the_end(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 3)

    for clip_id in clips:
        batch = batches_router.add_shot(batch_id, ShotCreate(clip_id=clip_id), session)

    assert order(batch) == clips
    assert [shot.position for shot in batch.shots] == [0, 1, 2]
    session.close()


def test_uploading_a_clip_does_not_put_it_in_the_sequence(tmp_path, monkeypatch) -> None:
    """Being in a Batch and being in its Sequence are separate decisions."""
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 2)

    batch = batches_router.get_batch(batch_id, session)

    assert len(batch.clips) == 2
    assert batch.shots == []
    session.close()


def test_a_clip_cannot_be_placed_twice(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 1)
    batches_router.add_shot(batch_id, ShotCreate(clip_id=clips[0]), session)

    with pytest.raises(HTTPException) as exc_info:
        batches_router.add_shot(batch_id, ShotCreate(clip_id=clips[0]), session)

    assert exc_info.value.status_code == 409
    assert len(session.scalars(select(Shot)).all()) == 1
    session.close()


def test_a_clip_from_another_batch_cannot_be_placed(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    first, _ = make_batch_with_clips(session, 1)
    other = batches_router.create_batch(BatchCreate(name="Other"), session)
    session.add(Project(id="outsider", batch_id=other.id, origin_kind="upload", status="ready"))
    session.commit()

    with pytest.raises(HTTPException) as exc_info:
        batches_router.add_shot(first, ShotCreate(clip_id="outsider"), session)

    assert exc_info.value.status_code == 404
    session.close()


def test_moving_a_shot_slides_the_others_and_closes_gaps(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 4)
    for clip_id in clips:
        batches_router.add_shot(batch_id, ShotCreate(clip_id=clip_id), session)
    last = session.scalar(select(Shot).where(Shot.project_id == clips[3]))

    batch = batches_router.move_shot(batch_id, last.id, ShotMove(position=0), session)

    assert order(batch) == [clips[3], clips[0], clips[1], clips[2]]
    assert [shot.position for shot in batch.shots] == [0, 1, 2, 3]
    session.close()


def test_moving_past_the_end_lands_at_the_end(tmp_path, monkeypatch) -> None:
    """The UI should not have to know the length to move something last."""
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 3)
    for clip_id in clips:
        batches_router.add_shot(batch_id, ShotCreate(clip_id=clip_id), session)
    first = session.scalar(select(Shot).where(Shot.project_id == clips[0]))

    batch = batches_router.move_shot(batch_id, first.id, ShotMove(position=99), session)

    assert order(batch) == [clips[1], clips[2], clips[0]]
    session.close()


def test_removing_a_shot_keeps_the_clip_in_the_batch(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 3)
    for clip_id in clips:
        batches_router.add_shot(batch_id, ShotCreate(clip_id=clip_id), session)
    middle = session.scalar(select(Shot).where(Shot.project_id == clips[1]))

    batch = batches_router.remove_shot(batch_id, middle.id, session)

    assert order(batch) == [clips[0], clips[2]]
    assert [shot.position for shot in batch.shots] == [0, 1]
    # The Clip is still available to add back.
    assert len(batch.clips) == 3
    session.close()


def test_a_removed_clip_leaves_the_sequence_with_it(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(projects_router, "remove_project_files", lambda *args: None)
    batch_id, clips = make_batch_with_clips(session, 2)
    for clip_id in clips:
        batches_router.add_shot(batch_id, ShotCreate(clip_id=clip_id), session)

    projects_router.delete_project(clips[0], session)

    batch = batches_router.get_batch(batch_id, session)
    assert order(batch) == [clips[1]]
    session.close()


def test_deleting_a_batch_takes_its_sequence(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(batches_router, "remove_project_files", lambda *args: None)
    batch_id, clips = make_batch_with_clips(session, 2)
    for clip_id in clips:
        batches_router.add_shot(batch_id, ShotCreate(clip_id=clip_id), session)

    batches_router.delete_batch(batch_id, session)

    assert session.scalars(select(Shot)).all() == []
    session.close()


def test_adding_after_a_deleted_clip_does_not_reuse_a_position(tmp_path, monkeypatch) -> None:
    """Deleting a Clip leaves its position behind.

    Appending at len() then lands on top of a Shot that is still there: with
    positions 0 and 2 left, the next Shot became a second 2 and the Sequence
    had no defined order.
    """
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(projects_router, "remove_project_files", lambda *args: None)
    batch_id, clips = make_batch_with_clips(session, 4)
    for clip_id in clips[:3]:
        batches_router.add_shot(batch_id, ShotCreate(clip_id=clip_id), session)
    projects_router.delete_project(clips[1], session)

    batch = batches_router.add_shot(batch_id, ShotCreate(clip_id=clips[3]), session)

    positions = [shot.position for shot in batch.shots]
    assert positions == sorted(set(positions))
    assert order(batch) == [clips[0], clips[2], clips[3]]
    session.close()


def test_a_racing_duplicate_add_is_refused_not_a_crash(tmp_path, monkeypatch) -> None:
    """The `clip.shot` check is not atomic with the insert.

    A double-submitted add races past it, and the unique constraint is what
    actually stops the second one. Without translating that, the loser of the
    race gets a 500 instead of the 409 the check would have given.
    """
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 1)
    batches_router.add_shot(batch_id, ShotCreate(clip_id=clips[0]), session)
    # Stand in for the racing request: the guard sees no Shot, the insert does.
    monkeypatch.setattr(Project, "shot", property(lambda self: None))

    with pytest.raises(HTTPException) as exc_info:
        batches_router.add_shot(batch_id, ShotCreate(clip_id=clips[0]), session)

    assert exc_info.value.status_code == 409
    session.rollback()
    assert len(session.scalars(select(Shot)).all()) == 1
    session.close()


def test_shots_sharing_a_position_still_play_in_a_defined_order(tmp_path, monkeypatch) -> None:
    """Concurrent adds can momentarily tie. Play order must not be ambiguous."""
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 2)
    for clip_id in clips:
        batches_router.add_shot(batch_id, ShotCreate(clip_id=clip_id), session)
    # Tie the positions, and make the Shot inserted second the older one, so
    # created_at and insertion order disagree about what comes first.
    for shot in session.scalars(select(Shot)).all():
        shot.position = 0
        shot.created_at = datetime(2026, 1, 1 if shot.project_id == clips[1] else 2)
    session.commit()

    batch = batches_router.get_batch(batch_id, session)

    # Ties break on created_at, not on whatever order SQLite happens to return.
    assert order(batch) == [clips[1], clips[0]]
    session.close()


def test_the_batch_list_counts_placed_shots(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 3)
    batches_router.add_shot(batch_id, ShotCreate(clip_id=clips[0]), session)

    listed = batches_router.list_batches(session)

    assert listed[0].clip_count == 3
    assert listed[0].shot_count == 1
    session.close()
