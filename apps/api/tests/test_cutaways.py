"""Covering a Shot with another Clip, and flattening that back into a join.

`plan_segments` is the load-bearing part: if a covered Shot does not come apart
into ordinary stretches, ADR 0003's whole render pipeline stops applying.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.routers import _helpers, batches as batches_router
from app.database import Base
from app.models import Batch, Project, Shot
from app.schemas import CutawayCreate, CutawayUpdate, ShotCreate, ShotUpdate
from app.services.sequence import plan_segments, plan_sequence


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
                duration_ms=30_000,
                trim_start_ms=0,
                trim_end_ms=10_000,
            )
        )
        clip_ids.append(clip_id)
    session.commit()
    return batch.id, clip_ids


# --- flattening, without a database -------------------------------------


def detached(trim_start: int, trim_end: int, *, offset: int | None = None) -> Shot:
    """A Shot that never sees a session, so the maths can be read on its own."""
    clip = Project(origin_kind="upload", title="clip", trim_start_ms=0, trim_end_ms=trim_end)
    shot = Shot(trim_start_ms=trim_start, trim_end_ms=trim_end, offset_ms=offset)
    shot.clip = clip
    return shot


def test_a_shot_with_no_cutaway_is_one_stretch() -> None:
    base = detached(1_000, 6_000)

    segments = plan_segments(base)

    assert len(segments) == 1
    assert (segments[0].picture_start_ms, segments[0].picture_end_ms) == (1_000, 6_000)
    assert segments[0].audio is None


def test_a_cutaway_cuts_its_base_shot_into_three() -> None:
    """base, cutaway, base — which is why the join still applies (ADR 0005)."""
    base = detached(1_000, 9_000)
    cutaway = detached(0, 2_000, offset=3_000)
    base.cutaways = [cutaway]

    segments = plan_segments(base)

    assert [segment.is_covered for segment in segments] == [False, True, False]
    # 1.0s–4.0s of the base's source, then the cutaway, then 6.0s–9.0s.
    assert (segments[0].picture_start_ms, segments[0].picture_end_ms) == (1_000, 4_000)
    assert (segments[2].picture_start_ms, segments[2].picture_end_ms) == (6_000, 9_000)


def test_the_covered_stretch_takes_the_base_shots_audio() -> None:
    base = detached(1_000, 9_000)
    cutaway = detached(500, 2_500, offset=3_000)
    base.cutaways = [cutaway]

    covered = plan_segments(base)[1]

    # Picture from the cutaway's own trim...
    assert (covered.picture_start_ms, covered.picture_end_ms) == (500, 2_500)
    # ...sound from the base's source, over the stretch it covers.
    assert covered.audio is base
    assert (covered.audio_start_ms, covered.audio_end_ms) == (4_000, 6_000)
    assert covered.duration_ms == 2_000


def test_a_cutaway_at_the_very_start_leaves_no_stretch_before_it() -> None:
    base = detached(0, 5_000)
    base.cutaways = [detached(0, 2_000, offset=0)]

    segments = plan_segments(base)

    assert [segment.is_covered for segment in segments] == [True, False]


def test_a_cutaway_covering_the_whole_shot_leaves_nothing_of_it() -> None:
    base = detached(0, 4_000)
    base.cutaways = [detached(0, 4_000, offset=0)]

    segments = plan_segments(base)

    assert [segment.is_covered for segment in segments] == [True]
    assert segments[0].duration_ms == 4_000


def test_two_cutaways_on_one_shot_stay_in_offset_order() -> None:
    base = detached(0, 12_000)
    base.cutaways = [detached(0, 1_000, offset=8_000), detached(0, 1_000, offset=2_000)]

    segments = plan_segments(base)

    assert [segment.is_covered for segment in segments] == [False, True, False, True, False]
    assert segments[1].audio_start_ms == 2_000
    assert segments[3].audio_start_ms == 8_000


def test_a_cutaway_is_clipped_to_a_base_shot_trimmed_shorter_than_it() -> None:
    """Trimming the base is an ordinary edit, not an error (ADR 0005)."""
    base = detached(0, 4_000)
    base.cutaways = [detached(0, 3_000, offset=3_000)]

    segments = plan_segments(base)

    assert [segment.is_covered for segment in segments] == [False, True]
    # Only the second left of the base survives to be covered.
    assert segments[1].duration_ms == 1_000
    assert (segments[1].audio_start_ms, segments[1].audio_end_ms) == (3_000, 4_000)


def test_a_cutaway_left_past_the_end_of_its_base_shot_does_not_render() -> None:
    base = detached(0, 4_000)
    base.cutaways = [detached(0, 2_000, offset=9_000)]

    segments = plan_segments(base)

    assert [segment.is_covered for segment in segments] == [False]
    assert segments[0].duration_ms == 4_000


def test_a_shot_with_no_usable_trim_contributes_nothing() -> None:
    base = detached(5_000, 5_000)

    assert plan_segments(base) == []


def test_the_sequence_is_every_shot_flattened_in_order() -> None:
    first = detached(0, 3_000)
    second = detached(0, 6_000)
    second.cutaways = [detached(0, 1_000, offset=2_000)]

    segments = plan_sequence([first, second])

    assert [segment.is_covered for segment in segments] == [False, False, True, False]


# --- placing and moving a Cutaway ---------------------------------------


def place_shot(session, batch_id: str, clip_id: str) -> str:
    batch = batches_router.add_shot(batch_id, ShotCreate(clip_id=clip_id), session)
    return batch.shots[-1].id


def test_a_cutaway_covers_a_shot_without_joining_the_sequence(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 2)
    base_id = place_shot(session, batch_id, clips[0])

    batch = batches_router.add_cutaway(
        batch_id,
        CutawayCreate(clip_id=clips[1], base_shot_id=base_id, offset_ms=2_000),
        session,
    )

    # The running order is untouched; the Cutaway is reported apart from it.
    assert [shot.id for shot in batch.shots] == [base_id]
    assert len(batch.cutaways) == 1
    assert batch.cutaways[0].base_shot_id == base_id
    assert batch.cutaways[0].offset_ms == 2_000
    session.close()


def test_a_cutaway_travels_with_the_shot_it_covers(tmp_path, monkeypatch) -> None:
    """The point of anchoring: reordering does not strand the cover."""
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 3)
    first = place_shot(session, batch_id, clips[0])
    second = place_shot(session, batch_id, clips[1])
    batches_router.add_cutaway(
        batch_id,
        CutawayCreate(clip_id=clips[2], base_shot_id=second, offset_ms=1_000),
        session,
    )

    batch = batches_router.update_shot(batch_id, second, ShotUpdate(position=0), session)

    assert [shot.id for shot in batch.shots] == [second, first]
    # Still on the same shot, at the same offset into it.
    assert batch.cutaways[0].base_shot_id == second
    assert batch.cutaways[0].offset_ms == 1_000
    session.close()


def test_removing_a_base_shot_takes_its_cutaways(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 2)
    base_id = place_shot(session, batch_id, clips[0])
    batches_router.add_cutaway(
        batch_id,
        CutawayCreate(clip_id=clips[1], base_shot_id=base_id, offset_ms=1_000),
        session,
    )

    batch = batches_router.remove_shot(batch_id, base_id, session)

    assert batch.shots == []
    assert batch.cutaways == []
    assert session.scalars(select(Shot)).all() == []
    session.close()


def test_a_cutaway_cannot_cover_a_cutaway(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 3)
    base_id = place_shot(session, batch_id, clips[0])
    batch = batches_router.add_cutaway(
        batch_id,
        CutawayCreate(clip_id=clips[1], base_shot_id=base_id, offset_ms=1_000),
        session,
    )

    with pytest.raises(HTTPException) as exc_info:
        batches_router.add_cutaway(
            batch_id,
            CutawayCreate(clip_id=clips[2], base_shot_id=batch.cutaways[0].id, offset_ms=0),
            session,
        )

    assert exc_info.value.status_code == 422
    session.close()


def test_two_cutaways_cannot_claim_the_same_stretch(tmp_path, monkeypatch) -> None:
    """Overlapping would leave the flattening with two answers."""
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 3)
    base_id = place_shot(session, batch_id, clips[0])
    batches_router.add_cutaway(
        batch_id,
        # Clip 1 covers 2.0s–12.0s of the base.
        CutawayCreate(clip_id=clips[1], base_shot_id=base_id, offset_ms=2_000),
        session,
    )

    with pytest.raises(HTTPException) as exc_info:
        batches_router.add_cutaway(
            batch_id,
            CutawayCreate(clip_id=clips[2], base_shot_id=base_id, offset_ms=5_000),
            session,
        )

    assert exc_info.value.status_code == 409
    session.close()


def test_cutaways_that_only_touch_are_allowed(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 3)
    base_id = place_shot(session, batch_id, clips[0])
    batches_router.add_cutaway(
        batch_id,
        # 0–2s.
        CutawayCreate(clip_id=clips[1], base_shot_id=base_id, offset_ms=0, trim_end_ms=2_000),
        session,
    )

    batch = batches_router.add_cutaway(
        batch_id,
        # Starts exactly where the other ends.
        CutawayCreate(clip_id=clips[2], base_shot_id=base_id, offset_ms=2_000, trim_end_ms=2_000),
        session,
    )

    assert len(batch.cutaways) == 2
    session.close()


def test_moving_a_cutaway_onto_another_shot_re_anchors_it(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 3)
    first = place_shot(session, batch_id, clips[0])
    second = place_shot(session, batch_id, clips[1])
    batch = batches_router.add_cutaway(
        batch_id,
        CutawayCreate(clip_id=clips[2], base_shot_id=first, offset_ms=1_000),
        session,
    )
    cutaway_id = batch.cutaways[0].id

    batch = batches_router.update_cutaway(
        batch_id, cutaway_id, CutawayUpdate(base_shot_id=second, offset_ms=4_000), session
    )

    assert batch.cutaways[0].base_shot_id == second
    assert batch.cutaways[0].offset_ms == 4_000
    session.close()


def test_a_cutaway_can_be_uncovered_leaving_the_clip_in_the_batch(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 2)
    base_id = place_shot(session, batch_id, clips[0])
    batch = batches_router.add_cutaway(
        batch_id,
        CutawayCreate(clip_id=clips[1], base_shot_id=base_id, offset_ms=1_000),
        session,
    )

    batch = batches_router.remove_cutaway(batch_id, batch.cutaways[0].id, session)

    assert batch.cutaways == []
    assert [shot.id for shot in batch.shots] == [base_id]
    assert len(batch.clips) == 2
    session.close()


def test_a_cutaway_is_not_counted_as_a_placed_shot(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    batch_id, clips = make_batch_with_clips(session, 2)
    base_id = place_shot(session, batch_id, clips[0])
    batches_router.add_cutaway(
        batch_id,
        CutawayCreate(clip_id=clips[1], base_shot_id=base_id, offset_ms=1_000),
        session,
    )

    listed = batches_router.list_batches(session)

    assert listed[0].shot_count == 1
    session.close()


def test_exporting_waits_for_a_cutaways_clip_to_import(tmp_path, monkeypatch) -> None:
    """A Cutaway's Clip renders like any other, so it has to be ready too.

    `batch_shots` stopped returning Cutaways, which took them out of the export
    guard along with the running order.
    """
    session = make_session(tmp_path)
    use_projects_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(batches_router.settings, "batches_dir", tmp_path / "batches", raising=False)
    batch_id, clips = make_batch_with_clips(session, 2)
    base_id = place_shot(session, batch_id, clips[0])
    batches_router.add_cutaway(
        batch_id,
        CutawayCreate(clip_id=clips[1], base_shot_id=base_id, offset_ms=1_000),
        session,
    )
    covering = session.get(Project, clips[1])
    covering.status = "processing"
    session.commit()

    with pytest.raises(HTTPException) as exc_info:
        batches_router.render_sequence(batch_id, session)

    assert exc_info.value.status_code == 409
    assert "Clip 1" in exc_info.value.detail
    session.close()
