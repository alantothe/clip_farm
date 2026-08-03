from types import SimpleNamespace

import pysubs2

from app.services import media
from app.services.media import create_ass_captions


def test_captions_use_vertical_canvas_and_safe_margins(tmp_path) -> None:
    output = tmp_path / "captions.ass"
    segment = SimpleNamespace(start_ms=100, end_ms=1200, text="Keep this in frame")

    created = create_ass_captions(
        segments=[segment],
        trim_start_ms=0,
        trim_end_ms=1500,
        style_name="bold",
        position="bottom",
        output=output,
    )

    subtitles = pysubs2.load(str(output))
    style = subtitles.styles["Default"]
    assert created is True
    assert subtitles.info["PlayResX"] == "1080"
    assert subtitles.info["PlayResY"] == "1920"
    assert style.alignment == pysubs2.Alignment.BOTTOM_CENTER
    assert style.marginl == 86
    assert style.marginr == 86
    assert style.marginv == 280


def test_minimal_captions_render_with_a_readable_box(tmp_path) -> None:
    output = tmp_path / "captions.ass"
    segment = SimpleNamespace(start_ms=100, end_ms=1200, text="Quiet and clear")

    create_ass_captions(
        segments=[segment],
        trim_start_ms=0,
        trim_end_ms=1500,
        style_name="minimal",
        position="bottom",
        output=output,
    )

    style = pysubs2.load(str(output)).styles["Default"]
    assert style.borderstyle == 3
    assert style.marginv == 240


def test_caption_position_selects_matching_vertical_alignment(tmp_path) -> None:
    segment = SimpleNamespace(start_ms=0, end_ms=1000, text="Move me")
    expected = {
        "top": pysubs2.Alignment.TOP_CENTER,
        "middle": pysubs2.Alignment.MIDDLE_CENTER,
        "bottom": pysubs2.Alignment.BOTTOM_CENTER,
    }

    for position, alignment in expected.items():
        output = tmp_path / f"captions-{position}.ass"
        create_ass_captions(
            segments=[segment],
            trim_start_ms=0,
            trim_end_ms=1000,
            style_name="bold",
            position=position,
            output=output,
        )
        assert pysubs2.load(str(output)).styles["Default"].alignment == alignment


def test_fitted_video_zoom_and_position_are_built_into_the_filter(tmp_path, monkeypatch) -> None:
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    commands: list[list[str]] = []
    monkeypatch.setattr(media, "run_command", lambda command: commands.append(command))

    media.render_vertical(
        source=source,
        output=tmp_path / "output.mp4",
        temp_dir=tmp_path,
        layout="fit_background",
        start_ms=0,
        end_ms=1_000,
        crop_center_x=50,
        frame_zoom=1.5,
        frame_center_x=20,
        frame_center_y=80,
        caption_segments=[],
        captions_enabled=False,
        caption_style="bold",
        caption_position="bottom",
        image_overlays=[],
    )

    command = commands[0]
    filters = command[command.index("-filter_complex") + 1]
    assert "[fg]scale=1620:2880" in filters
    assert "overlay=x='(W-w)*0.2000':y='(H-h)*0.8000'" in filters
