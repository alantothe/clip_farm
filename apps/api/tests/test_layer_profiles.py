from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Batch, BatchMedia, Project, Shot, Title
from app.routers import _helpers, batches as batches_router, layer_profiles as profiles_router
from app.schemas import LayerProfileCreate, ShotCreate


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
    output = profiles_router.apply_layer_profile(target.id, profile.id, session)

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
        profiles_router.apply_layer_profile(target.id, profile.id, session)
    assert caught.value.status_code == 409
