"""Joining Shots into a Sequence, and the guards on asking for one.

The join tests drive real ffmpeg, because what they are checking is exactly
what ffmpeg does quietly: stream-copying Shots together exits 0 and writes a
playable file whose audio has drifted away from its video. See ADR 0003.
"""

import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.routers import _helpers, batches as batches_router
from app.database import Base
from app.models import Batch, Project, SequenceRender
from app.schemas import ShotCreate
from app.services.media import MediaProcessingError, inspect_media, join_shots


needs_ffmpeg = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")),
    reason="FFmpeg and FFprobe are required to join shots",
)


def make_session(tmp_path) -> Session:
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    return Session(engine)


def use_dirs(monkeypatch, tmp_path) -> None:
    settings = SimpleNamespace(
        projects_dir=tmp_path / "projects",
        batches_dir=tmp_path / "batches",
        api_prefix="/api",
        max_source_bytes=1_000_000,
    )
    monkeypatch.setattr(batches_router, "settings", settings)
    monkeypatch.setattr(_helpers, "settings", settings)
    monkeypatch.setattr(batches_router, "render_sequence_task", lambda *args: None)


def make_shot_video(path: Path, *, tone_hz: int, seconds: float, audio: str = "stereo") -> Path:
    """A Shot-shaped video: 1080x1920, 30 fps, in the export's format."""
    command = ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
               f"testsrc=size=1080x1920:rate=30:duration={seconds}"]
    if audio != "none":
        channels = "1" if audio == "mono" else "2"
        command += ["-f", "lavfi", "-i",
                    f"sine=frequency={tone_hz}:sample_rate=48000:duration={seconds}",
                    "-ac", channels]
    command += ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
                "-pix_fmt", "yuv420p", "-r", "30", "-t", str(seconds)]
    if audio != "none":
        command += ["-c:a", "aac", "-b:a", "128k", "-ar", "48000"]
    else:
        command += ["-an"]
    command.append(str(path))
    subprocess.run(command, check=True, capture_output=True)
    return path


def audio_seconds(path: Path) -> float:
    """Decoded audio length, which is what actually plays.

    The container's reported stream duration hides the AAC padding that causes
    the drift, so the audio is decoded rather than trusted.
    """
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a", "-f", "wav", "-"],
        check=True,
        capture_output=True,
    )
    # 44-byte WAV header, then 16-bit stereo at 48 kHz.
    return (len(result.stdout) - 44) / (48000 * 2 * 2)


# --- the join ------------------------------------------------------------


@needs_ffmpeg
def test_joining_shots_keeps_audio_the_length_of_the_video(tmp_path) -> None:
    """The regression ADR 0003 exists for.

    Stream-copying AAC Shots accumulates about 27 ms of excess audio per join,
    silently. Four Shots is enough for it to show.
    """
    shots = [
        make_shot_video(tmp_path / f"shot-{index}.mp4", tone_hz=440 + index * 110, seconds=1.0)
        for index in range(4)
    ]
    output = tmp_path / "sequence.mp4"

    join_shots(shots=shots, output=output, temp_dir=tmp_path)

    metadata = inspect_media(output)
    video_seconds = metadata["duration_ms"] / 1000
    assert 3.9 < video_seconds < 4.1
    # Audio within 40 ms of video. Stream-copying these same four Shots gives
    # 96 ms, with ffmpeg exiting 0 — which is what this threshold catches.
    assert abs(audio_seconds(output) - video_seconds) < 0.04


@needs_ffmpeg
def test_a_shot_with_no_audio_does_not_truncate_the_sequence(tmp_path) -> None:
    """A silent Shot used to end the export's audio track early, exiting 0."""
    shots = [
        make_shot_video(tmp_path / "with-audio.mp4", tone_hz=440, seconds=1.0),
        make_shot_video(tmp_path / "silent.mp4", tone_hz=0, seconds=1.0, audio="none"),
        make_shot_video(tmp_path / "after.mp4", tone_hz=660, seconds=1.0),
    ]
    output = tmp_path / "sequence.mp4"

    join_shots(shots=shots, output=output, temp_dir=tmp_path)

    video_seconds = inspect_media(output)["duration_ms"] / 1000
    assert abs(audio_seconds(output) - video_seconds) < 0.04


@needs_ffmpeg
def test_a_mono_shot_joins_without_losing_its_audio(tmp_path) -> None:
    """Mono used to be copied into a stream declared stereo without complaint."""
    shots = [
        make_shot_video(tmp_path / "stereo.mp4", tone_hz=440, seconds=1.0),
        make_shot_video(tmp_path / "mono.mp4", tone_hz=660, seconds=1.0, audio="mono"),
    ]
    output = tmp_path / "sequence.mp4"

    join_shots(shots=shots, output=output, temp_dir=tmp_path)

    metadata = inspect_media(output)
    assert metadata["has_audio"]
    assert abs(audio_seconds(output) - metadata["duration_ms"] / 1000) < 0.04


@needs_ffmpeg
def test_joining_leaves_no_intermediates_behind(tmp_path) -> None:
    shots = [make_shot_video(tmp_path / "only.mp4", tone_hz=440, seconds=0.5)]
    work = tmp_path / "work"
    work.mkdir()

    join_shots(shots=shots, output=work / "sequence.mp4", temp_dir=work)

    assert [item.name for item in work.iterdir()] == ["sequence.mp4"]


def test_joining_nothing_is_an_error(tmp_path) -> None:
    with pytest.raises(MediaProcessingError):
        join_shots(shots=[], output=tmp_path / "out.mp4", temp_dir=tmp_path)


def test_a_missing_shot_render_names_which_one(tmp_path) -> None:
    with pytest.raises(MediaProcessingError) as exc_info:
        join_shots(shots=[tmp_path / "gone.mp4"], output=tmp_path / "out.mp4", temp_dir=tmp_path)

    assert "Shot 1" in str(exc_info.value)


# --- asking for an export ------------------------------------------------


def seed(session: Session, statuses: list[str]) -> str:
    batch = Batch(name="Monday")
    session.add(batch)
    session.flush()
    for index, status in enumerate(statuses):
        session.add(
            Project(
                id=f"clip-{index}",
                batch_id=batch.id,
                origin_kind="upload",
                title=f"Clip {index}",
                status=status,
            )
        )
    session.commit()
    for index in range(len(statuses)):
        batches_router.add_shot(batch.id, ShotCreate(clip_id=f"clip-{index}"), session)
    return batch.id


def test_exporting_an_empty_timeline_is_refused(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_dirs(monkeypatch, tmp_path)
    batch_id = seed(session, [])

    with pytest.raises(HTTPException) as exc_info:
        batches_router.render_sequence(batch_id, session)

    assert exc_info.value.status_code == 422
    session.close()


def test_exporting_waits_for_an_importing_clip(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_dirs(monkeypatch, tmp_path)
    batch_id = seed(session, ["ready", "processing"])

    with pytest.raises(HTTPException) as exc_info:
        batches_router.render_sequence(batch_id, session)

    assert exc_info.value.status_code == 409
    assert "finish importing" in exc_info.value.detail
    assert session.scalars(select(SequenceRender)).all() == []
    session.close()


def test_a_failed_clip_must_leave_the_timeline_first(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_dirs(monkeypatch, tmp_path)
    batch_id = seed(session, ["ready", "failed"])

    with pytest.raises(HTTPException) as exc_info:
        batches_router.render_sequence(batch_id, session)

    assert exc_info.value.status_code == 409
    assert "remove it from the timeline" in exc_info.value.detail
    session.close()


def test_a_ready_sequence_queues_one_export(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_dirs(monkeypatch, tmp_path)
    batch_id = seed(session, ["ready", "ready", "ready"])

    queued = batches_router.render_sequence(batch_id, session)

    assert queued.status == "queued"
    # What produced this file is frozen, even though the Sequence can change.
    assert queued.shot_count == 3
    assert queued.download_url is None
    session.close()


def test_a_second_export_is_refused_while_one_runs(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_dirs(monkeypatch, tmp_path)
    batch_id = seed(session, ["ready"])
    batches_router.render_sequence(batch_id, session)

    with pytest.raises(HTTPException) as exc_info:
        batches_router.render_sequence(batch_id, session)

    assert exc_info.value.status_code == 409
    assert len(session.scalars(select(SequenceRender)).all()) == 1
    session.close()


def test_a_finished_export_can_be_replaced(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_dirs(monkeypatch, tmp_path)
    batch_id = seed(session, ["ready"])
    first = batches_router.render_sequence(batch_id, session)
    session.get(SequenceRender, first.id).status = "complete"
    session.commit()

    second = batches_router.render_sequence(batch_id, session)

    assert second.id != first.id
    # The newest export is the one the Batch reports.
    assert batches_router.get_sequence_render(batch_id, session).id == second.id
    session.close()


def test_a_batch_reports_its_latest_export(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_dirs(monkeypatch, tmp_path)
    batch_id = seed(session, ["ready"])
    assert batches_router.get_batch(batch_id, session).sequence_render is None

    batches_router.render_sequence(batch_id, session)

    batch = batches_router.get_batch(batch_id, session)
    assert batch.sequence_render is not None
    assert batch.sequence_render.status == "queued"
    session.close()


def test_a_completed_export_offers_a_download(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_dirs(monkeypatch, tmp_path)
    batch_id = seed(session, ["ready"])
    queued = batches_router.render_sequence(batch_id, session)
    session.get(SequenceRender, queued.id).status = "complete"
    session.commit()

    reported = batches_router.get_sequence_render(batch_id, session)

    assert reported.download_url == f"/api/batches/{batch_id}/render/download"
    session.close()


def test_downloading_before_an_export_finishes_is_a_404(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_dirs(monkeypatch, tmp_path)
    batch_id = seed(session, ["ready"])
    batches_router.render_sequence(batch_id, session)

    with pytest.raises(HTTPException) as exc_info:
        batches_router.download_sequence_render(batch_id, session)

    assert exc_info.value.status_code == 404
    session.close()


def test_deleting_a_batch_takes_its_exports(tmp_path, monkeypatch) -> None:
    session = make_session(tmp_path)
    use_dirs(monkeypatch, tmp_path)
    monkeypatch.setattr(batches_router, "remove_project_files", lambda *args: None)
    batch_id = seed(session, ["ready"])
    batches_router.render_sequence(batch_id, session)

    batches_router.delete_batch(batch_id, session)

    assert session.scalars(select(SequenceRender)).all() == []
    session.close()


def test_a_batch_name_becomes_a_safe_download_filename() -> None:
    assert batches_router._download_name("Monday pulls") == "Monday-pulls"
    assert batches_router._download_name("../../etc/passwd") == "etc-passwd"
    assert batches_router._download_name("///") == "clip-farm-sequence"


def test_the_worker_renders_each_shots_own_span(tmp_path, monkeypatch) -> None:
    """A Shot's Trim is what reaches render_vertical, not always its Clip's.

    This is the seam ADR 0004 moves: the same Clip appears twice, once
    following its Clip's Trim and once trimmed on the Timeline.
    """
    from sqlalchemy.orm import sessionmaker

    from app import tasks
    from app.models import Artifact, Shot

    engine = create_engine(f"sqlite:///{tmp_path / 'worker.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    source = tmp_path / "source.mp4"
    source.write_bytes(b"not really a video")
    with factory() as session:
        batch = Batch(name="Monday")
        session.add(batch)
        session.flush()
        clip = Project(
            batch_id=batch.id,
            origin_kind="upload",
            title="Clip",
            status="ready",
            trim_start_ms=1_000,
            trim_end_ms=9_000,
        )
        session.add(clip)
        session.flush()
        session.add(
            Artifact(
                project_id=clip.id, kind="source", path=str(source), mime_type="video/mp4"
            )
        )
        # Same Clip twice: the second one trimmed on the Timeline.
        session.add(Shot(batch_id=batch.id, project_id=clip.id, position=0))
        session.add(
            Shot(
                batch_id=batch.id,
                project_id=clip.id,
                position=1,
                trim_start_ms=3_000,
                trim_end_ms=4_500,
            )
        )
        sequence_render = SequenceRender(batch_id=batch.id, shot_count=2)
        session.add(sequence_render)
        session.commit()
        batch_id, render_id = batch.id, sequence_render.id

    spans: list[tuple[int, int]] = []

    def fake_render_vertical(**kwargs):
        spans.append((kwargs["start_ms"], kwargs["end_ms"]))
        Path(kwargs["output"]).write_bytes(b"rendered")

    monkeypatch.setattr(tasks, "SessionLocal", factory)
    monkeypatch.setattr(tasks, "settings", SimpleNamespace(batches_dir=tmp_path / "batches"))
    monkeypatch.setattr(tasks, "render_vertical", fake_render_vertical)
    monkeypatch.setattr(
        tasks, "join_shots", lambda **kwargs: Path(kwargs["output"]).write_bytes(b"joined")
    )
    monkeypatch.setattr(
        tasks, "inspect_media", lambda _path: {"width": 1080, "height": 1920, "duration_ms": 9_500}
    )
    monkeypatch.setattr(tasks, "sha256_file", lambda _path: "checksum")

    # `render_sequence_task` is a huey task, so calling it would only enqueue.
    tasks.render_sequence_task.call_local(batch_id, render_id)

    assert spans == [(1_000, 9_000), (3_000, 4_500)]
    with factory() as session:
        assert session.get(SequenceRender, render_id).status == "complete"
