from types import SimpleNamespace

import pysubs2

from app.services.media import create_ass_captions


def test_captions_use_vertical_canvas_and_safe_margins(tmp_path) -> None:
    output = tmp_path / "captions.ass"
    segment = SimpleNamespace(start_ms=100, end_ms=1200, text="Keep this in frame")

    created = create_ass_captions(
        segments=[segment],
        trim_start_ms=0,
        trim_end_ms=1500,
        style_name="bold",
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
        output=output,
    )

    style = pysubs2.load(str(output)).styles["Default"]
    assert style.borderstyle == 3
    assert style.marginv == 240
