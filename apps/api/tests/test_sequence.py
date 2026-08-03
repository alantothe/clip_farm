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
from app.schemas import BatchCreate, ShotCreate, ShotUpdate


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

    batch = batches_router.update_shot(batch_id, last.id, ShotUpdate(position=0), session)

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

    batch = batches_router.update_shot(batch_id, first.id, ShotUpdate(position=99), session)

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


def test_a_clip_can_be_placed_more_than_once(tmp_path, monkeypatch) -> None:
    """`uq_shots_project` used to make this a 409. Per-Shot trim is the point.

    The same source at two different in/out points is an ordinary edit, so a
    second placement is a second Shot rather than a conflict (ADR 0004).
    """
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 1)

    batches_router.add_shot(batch_id, ShotCreate(clip_id=clips[0]), session)
    batch = batches_router.add_shot(batch_id, ShotCreate(clip_id=clips[0]), session)

    assert order(batch) == [clips[0], clips[0]]
    assert [shot.position for shot in batch.shots] == [0, 1]
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


def test_a_shot_follows_its_clips_trim_until_it_is_trimmed(tmp_path, monkeypatch) -> None:
    """Null is the Shot following its Clip, not an absent value."""
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 1)
    clip = session.get(Project, clips[0])
    clip.trim_start_ms = 1_000
    clip.trim_end_ms = 5_000
    session.commit()
    batch = batches_router.add_shot(batch_id, ShotCreate(clip_id=clips[0]), session)
    shot = session.get(Shot, batch.shots[0].id)

    assert shot.span() == (1_000, 5_000)

    # The Clip moves, and an un-overridden Shot moves with it.
    clip.trim_start_ms = 2_000
    session.commit()
    assert shot.span() == (2_000, 5_000)


def test_trimming_a_shot_leaves_its_clip_alone(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 1)
    clip = session.get(Project, clips[0])
    clip.trim_start_ms = 0
    clip.trim_end_ms = 9_000
    session.commit()
    added = batches_router.add_shot(batch_id, ShotCreate(clip_id=clips[0]), session)

    batches_router.update_shot(
        batch_id, added.shots[0].id, ShotUpdate(trim_start_ms=2_000, trim_end_ms=4_000), session
    )

    shot = session.get(Shot, added.shots[0].id)
    assert shot.span() == (2_000, 4_000)
    assert (clip.trim_start_ms, clip.trim_end_ms) == (0, 9_000)
    # The Clip moving no longer drags an overridden Shot with it.
    clip.trim_start_ms = 3_000
    session.commit()
    assert shot.span() == (2_000, 4_000)
    session.close()


def test_half_a_trim_override_falls_back_for_the_other_half(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 1)
    clip = session.get(Project, clips[0])
    clip.trim_start_ms = 500
    clip.trim_end_ms = 8_000
    session.commit()
    added = batches_router.add_shot(batch_id, ShotCreate(clip_id=clips[0]), session)

    batches_router.update_shot(batch_id, added.shots[0].id, ShotUpdate(trim_end_ms=6_000), session)

    assert session.get(Shot, added.shots[0].id).span() == (500, 6_000)
    session.close()


def test_a_null_trim_resets_the_shot_to_its_clip(tmp_path, monkeypatch) -> None:
    """Absent and null mean different things, and only null resets."""
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 1)
    clip = session.get(Project, clips[0])
    clip.trim_start_ms = 100
    clip.trim_end_ms = 7_000
    session.commit()
    added = batches_router.add_shot(
        batch_id, ShotCreate(clip_id=clips[0], trim_start_ms=1_000, trim_end_ms=2_000), session
    )
    shot_id = added.shots[0].id

    # Moving it says nothing about its trim, so the override survives.
    batches_router.update_shot(batch_id, shot_id, ShotUpdate(position=0), session)
    assert session.get(Shot, shot_id).span() == (1_000, 2_000)

    batches_router.update_shot(
        batch_id, shot_id, ShotUpdate(trim_start_ms=None, trim_end_ms=None), session
    )

    shot = session.get(Shot, shot_id)
    assert (shot.trim_start_ms, shot.trim_end_ms) == (None, None)
    assert shot.span() == (100, 7_000)
    session.close()


def test_a_shot_that_ends_before_it_starts_is_refused(tmp_path, monkeypatch) -> None:
    """Caught here, not at export after every other Shot has rendered."""
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 1)
    added = batches_router.add_shot(batch_id, ShotCreate(clip_id=clips[0]), session)

    with pytest.raises(HTTPException) as exc_info:
        batches_router.update_shot(
            batch_id, added.shots[0].id, ShotUpdate(trim_start_ms=5_000, trim_end_ms=1_000), session
        )

    assert exc_info.value.status_code == 422
    session.close()


def test_a_shot_can_be_placed_at_a_position(tmp_path, monkeypatch) -> None:
    """Undoing a removal puts the Shot back where it was, with its trim."""
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 3)
    for clip_id in clips[:2]:
        batches_router.add_shot(batch_id, ShotCreate(clip_id=clip_id), session)

    batch = batches_router.add_shot(
        batch_id,
        ShotCreate(clip_id=clips[2], position=0, trim_start_ms=250, trim_end_ms=1_250),
        session,
    )

    assert order(batch) == [clips[2], clips[0], clips[1]]
    assert [shot.position for shot in batch.shots] == [0, 1, 2]
    restored = next(shot for shot in batch.shots if shot.clip_id == clips[2])
    assert (restored.trim_start_ms, restored.trim_end_ms) == (250, 1_250)
    session.close()


def test_placing_past_the_end_lands_at_the_end(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 2)
    batches_router.add_shot(batch_id, ShotCreate(clip_id=clips[0]), session)

    batch = batches_router.add_shot(
        batch_id, ShotCreate(clip_id=clips[1], position=99), session
    )

    assert order(batch) == [clips[0], clips[1]]
    session.close()
