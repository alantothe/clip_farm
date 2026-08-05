from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Batch, BatchMedia, LayerProfileMedia, Project, Shot, Title
from app.routers import _helpers, batches as batches_router, layer_profiles as profiles_router
from app.schemas import LayerProfileApply, LayerProfileCreate, ShotCreate


def make_session(tmp_path) -> Session:
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    return Session(engine)


def use_profile_dirs(monkeypatch, tmp_path) -> None:
    settings = SimpleNamespace(
        api_prefix="/api",
        batches_dir=tmp_path / "batches",
        layer_profiles_dir=tmp_path / "layer-profiles",
    )
    monkeypatch.setattr(profiles_router, "settings", settings)
    monkeypatch.setattr(_helpers, "settings", settings)


def make_sequence(session: Session, duration_ms: int, name: str) -> Batch:
    batch = Batch(name=name)
    clip = Project(
        batch=batch,
        origin_kind="upload",
        status="ready",
        duration_ms=duration_ms,
        trim_end_ms=duration_ms,
    )
    session.add_all([batch, clip])
    session.flush()
    session.add(Shot(batch_id=batch.id, project_id=clip.id, position=0))
    session.commit()
    return batch


def test_profile_copies_text_and_image_across_any_target_duration(tmp_path, monkeypatch):
    session = make_session(tmp_path)
    use_profile_dirs(monkeypatch, tmp_path)
    source_batch = make_sequence(session, 5_000, "Source")
    title = Title(
        batch_id=source_batch.id,
        text="Watch this",
        start_ms=1_000,
        end_ms=3_000,
        center_y=18,
        font_family="anton",
    )
    source_path = tmp_path / "source-logo.png"
    source_path.write_bytes(b"profile image")
    image = BatchMedia(
        batch_id=source_batch.id,
        name="logo.png",
        path=str(source_path),
        mime_type="image/png",
        size_bytes=source_path.stat().st_size,
        start_ms=2_000,
        end_ms=4_000,
        center_x=72,
        width_percent=31,
    )
    session.add_all([title, image])
    session.commit()

    profile = profiles_router.create_layer_profile(
        source_batch.id,
        LayerProfileCreate(name="Brand close", title_ids=[title.id], media_ids=[image.id]),
        session,
    )
    assert profile.name == "Brand close"
    assert [item.text for item in profile.titles] == ["Watch this"]
    assert profile.media[0].url.endswith(f"/{profile.media[0].id}/file")

    # The profile owns the bytes; the Batch it came from no longer needs to.
    source_path.unlink()
    target = make_sequence(session, 17_500, "Target")
    output = profiles_router.apply_layer_profile(target.id, profile.id, session=session)

    assert [(item.text, item.start_ms, item.end_ms) for item in output.titles] == [
        ("Watch this", 0, 17_500)
    ]
    assert [(item.start_ms, item.end_ms) for item in output.media] == [(0, 17_500)]
    assert (output.titles[0].font_family, output.titles[0].center_y) == ("anton", 18)
    assert (output.media[0].center_x, output.media[0].width_percent) == (72, 31)
    copied = session.get(BatchMedia, output.media[0].id)
    assert copied is not None and Path(copied.path).read_bytes() == b"profile image"

    # Full-span is a live back edge: extending the Sequence later extends every
    # layer that came from the profile too.
    target_clip = session.query(Project).filter(Project.batch_id == target.id).one()
    extended = batches_router.add_shot(
        target.id, ShotCreate(clip_id=target_clip.id), session
    )
    assert [(item.start_ms, item.end_ms) for item in extended.titles] == [(0, 35_000)]
    assert [(item.start_ms, item.end_ms) for item in extended.media] == [(0, 35_000)]


def test_profile_can_contain_only_one_layer_kind(tmp_path, monkeypatch):
    session = make_session(tmp_path)
    use_profile_dirs(monkeypatch, tmp_path)
    batch = make_sequence(session, 4_000, "Text only")
    title = Title(batch_id=batch.id, text="Only words", start_ms=0, end_ms=4_000)
    session.add(title)
    session.commit()

    profile = profiles_router.create_layer_profile(
        batch.id,
        LayerProfileCreate(name="Words", title_ids=[title.id]),
        session,
    )

    assert len(profile.titles) == 1
    assert profile.media == []


def test_applying_profile_respects_three_title_slots(tmp_path, monkeypatch):
    session = make_session(tmp_path)
    use_profile_dirs(monkeypatch, tmp_path)
    source = make_sequence(session, 4_000, "Source")
    saved = [
        Title(batch_id=source.id, text=f"Saved {index}", start_ms=0, end_ms=4_000)
        for index in range(2)
    ]
    session.add_all(saved)
    session.commit()
    profile = profiles_router.create_layer_profile(
        source.id,
        LayerProfileCreate(name="Two titles", title_ids=[item.id for item in saved]),
        session,
    )

    target = make_sequence(session, 6_000, "Full")
    session.add_all(
        [
            Title(batch_id=target.id, text=str(index), start_ms=0, end_ms=6_000)
            for index in range(2)
        ]
    )
    session.commit()

    with pytest.raises(HTTPException) as caught:
        profiles_router.apply_layer_profile(target.id, profile.id, session=session)
    assert caught.value.status_code == 409


def make_profile_with_image(session: Session, tmp_path, name: str, text: str):
    """A one-text, one-image profile, saved off a Batch of its own."""
    source = make_sequence(session, 4_000, f"{name} source")
    title = Title(batch_id=source.id, text=text, start_ms=0, end_ms=4_000)
    image_path = tmp_path / f"{name}.png"
    image_path.write_bytes(name.encode())
    image = BatchMedia(
        batch_id=source.id,
        name=f"{name}.png",
        path=str(image_path),
        mime_type="image/png",
        size_bytes=image_path.stat().st_size,
        start_ms=0,
        end_ms=4_000,
    )
    session.add_all([title, image])
    session.commit()
    return profiles_router.create_layer_profile(
        source.id,
        LayerProfileCreate(name=name, title_ids=[title.id], media_ids=[image.id]),
        session,
    )


def test_replacing_swaps_profile_layers_and_keeps_hand_made_ones(tmp_path, monkeypatch):
    session = make_session(tmp_path)
    use_profile_dirs(monkeypatch, tmp_path)
    first = make_profile_with_image(session, tmp_path, "Brand close", "BRAND CLOSE")
    second = make_profile_with_image(session, tmp_path, "New hook", "NEW HOOK")

    target = make_sequence(session, 9_000, "Target")
    by_hand = Title(batch_id=target.id, text="link in bio", start_ms=4_000, end_ms=7_000)
    session.add(by_hand)
    session.commit()

    applied = profiles_router.apply_layer_profile(target.id, first.id, session=session)
    assert sorted(item.text for item in applied.titles) == ["BRAND CLOSE", "link in bio"]
    assert len(applied.media) == 1
    replaced_image = Path(session.get(BatchMedia, applied.media[0].id).path)

    swapped = profiles_router.apply_layer_profile(
        target.id, second.id, LayerProfileApply(mode="replace"), session=session
    )

    # The first profile's layers are gone, the hand-written Title is not, and
    # its timing is untouched by a full-span arrangement landing beside it.
    assert sorted(item.text for item in swapped.titles) == ["NEW HOOK", "link in bio"]
    kept = next(item for item in swapped.titles if item.text == "link in bio")
    assert (kept.start_ms, kept.end_ms, kept.applied_profile_id) == (4_000, 7_000, None)
    assert len(swapped.media) == 1
    assert swapped.media[0].applied_profile_id == second.id
    # The swapped-out image takes its bytes with it rather than orphaning them.
    assert not replaced_image.exists()
    assert Path(session.get(BatchMedia, swapped.media[0].id).path).read_bytes() == b"New hook"


def test_applying_without_replacing_still_stacks(tmp_path, monkeypatch):
    session = make_session(tmp_path)
    use_profile_dirs(monkeypatch, tmp_path)
    first = make_profile_with_image(session, tmp_path, "One", "FIRST")
    second = make_profile_with_image(session, tmp_path, "Two", "SECOND")
    target = make_sequence(session, 9_000, "Target")

    profiles_router.apply_layer_profile(target.id, first.id, session=session)
    stacked = profiles_router.apply_layer_profile(
        target.id, second.id, LayerProfileApply(mode="add"), session=session
    )

    assert sorted(item.text for item in stacked.titles) == ["FIRST", "SECOND"]
    assert len(stacked.media) == 2


def test_replacing_frees_the_title_slots_the_old_profile_held(tmp_path, monkeypatch):
    """Swapping three Titles for three must not trip the fourth-slot rule."""
    session = make_session(tmp_path)
    use_profile_dirs(monkeypatch, tmp_path)
    source = make_sequence(session, 4_000, "Source")
    saved = [
        Title(batch_id=source.id, text=f"Saved {index}", start_ms=0, end_ms=4_000)
        for index in range(3)
    ]
    session.add_all(saved)
    session.commit()
    full = profiles_router.create_layer_profile(
        source.id,
        LayerProfileCreate(name="Three", title_ids=[item.id for item in saved]),
        session,
    )
    other = make_profile_with_image(session, tmp_path, "Other", "OTHER")

    target = make_sequence(session, 6_000, "Target")
    profiles_router.apply_layer_profile(target.id, full.id, session=session)

    # Adding on top would need a fourth row and is refused; replacing does not.
    with pytest.raises(HTTPException) as caught:
        profiles_router.apply_layer_profile(
            target.id, other.id, LayerProfileApply(mode="add"), session=session
        )
    assert caught.value.status_code == 409

    swapped = profiles_router.apply_layer_profile(
        target.id, other.id, LayerProfileApply(mode="replace"), session=session
    )
    assert [item.text for item in swapped.titles] == ["OTHER"]


def test_deleting_a_profile_leaves_the_layers_it_applied(tmp_path, monkeypatch):
    """The words and bytes were copied at apply time; they are the edit now."""
    session = make_session(tmp_path)
    use_profile_dirs(monkeypatch, tmp_path)
    profile = make_profile_with_image(session, tmp_path, "Doomed", "STILL HERE")
    target = make_sequence(session, 9_000, "Target")
    applied = profiles_router.apply_layer_profile(target.id, profile.id, session=session)
    image_path = Path(session.get(BatchMedia, applied.media[0].id).path)

    session.execute(text("PRAGMA foreign_keys=ON"))
    profiles_router.delete_layer_profile(profile.id, session)

    survivor = session.get(Title, applied.titles[0].id)
    assert survivor is not None and survivor.text == "STILL HERE"
    # Untagged now, so a later Replace has no claim on a layer it never made.
    assert survivor.applied_profile_id is None
    assert image_path.read_bytes() == b"Doomed"


def test_a_refused_swap_leaves_the_old_layers_where_they_were(tmp_path, monkeypatch):
    """The clearing and the writing are one operation or they are a data loss."""
    session = make_session(tmp_path)
    use_profile_dirs(monkeypatch, tmp_path)
    first = make_profile_with_image(session, tmp_path, "Keep me", "KEEP ME")
    doomed = make_profile_with_image(session, tmp_path, "Broken", "BROKEN")

    target = make_sequence(session, 9_000, "Target")
    applied = profiles_router.apply_layer_profile(target.id, first.id, session=session)
    kept_image = Path(session.get(BatchMedia, applied.media[0].id).path)

    # The second profile's bytes go missing between saving and applying.
    Path(session.get(LayerProfileMedia, doomed.media[0].id).path).unlink()
    with pytest.raises(HTTPException) as caught:
        profiles_router.apply_layer_profile(
            target.id, doomed.id, LayerProfileApply(mode="replace"), session=session
        )
    assert caught.value.status_code == 404

    session.expire_all()
    survivors = _helpers.batch_titles(session, target.id)
    assert [item.text for item in survivors] == ["KEEP ME"]
    assert len(_helpers.batch_media(session, target.id)) == 1
    assert kept_image.read_bytes() == b"Keep me"
