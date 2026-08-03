import hashlib
import json
import math
import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

import cv2
import numpy as np
import pysubs2

from app.services import fonts


class MediaProcessingError(RuntimeError):
    pass


def validate_overlay_image(path: Path) -> None:
    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise MediaProcessingError("The uploaded file is not a readable image")
    height, width = image.shape[:2]
    if width > 8192 or height > 8192 or width * height > 40_000_000:
        raise MediaProcessingError("Images must be no larger than 8192 px or 40 megapixels")


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise MediaProcessingError(f"Required executable not found: {command[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "Media command failed").strip().splitlines()
        raise MediaProcessingError(detail[-1] if detail else "Media command failed") from exc


def parse_fraction(value: str | None) -> float:
    if not value or value == "0/0":
        return 0.0
    numerator, denominator = value.split("/", 1)
    return float(numerator) / float(denominator)


def inspect_media(path: Path) -> dict:
    result = run_command(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(path),
        ]
    )
    data = json.loads(result.stdout)
    video = next((stream for stream in data.get("streams", []) if stream.get("codec_type") == "video"), None)
    if not video:
        raise MediaProcessingError("The source file has no video stream")
    duration = float(video.get("duration") or data.get("format", {}).get("duration") or 0)
    return {
        "duration_ms": max(1, round(duration * 1000)),
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "fps": parse_fraction(video.get("avg_frame_rate") or video.get("r_frame_rate")),
        "video_codec": video.get("codec_name"),
        "has_audio": any(
            stream.get("codec_type") == "audio" for stream in data.get("streams", [])
        ),
    }


def create_preview(source: Path, output: Path) -> None:
    run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(source),
            "-vf",
            "scale='min(960,iw)':-2",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "25",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(output),
        ]
    )


def create_thumbnail(source: Path, output: Path) -> None:
    run_command(
        [
            "ffmpeg",
            "-y",
            "-ss",
            "0.5",
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-vf",
            "scale=640:-2",
            "-q:v",
            "3",
            str(output),
        ]
    )


def extract_audio(source: Path, output: Path) -> None:
    run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(source),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "flac",
            str(output),
        ]
    )


CAPTION_STYLES = {
    "bold": {
        "fontname": "DejaVu Sans",
        "fontsize": 72,
        "primarycolor": pysubs2.Color(255, 255, 255),
        "outlinecolor": pysubs2.Color(8, 12, 16),
        "outline": 6,
        "shadow": 1,
        "bold": True,
        "marginl": 86,
        "marginr": 86,
        "marginv": 280,
    },
    "classic": {
        "fontname": "DejaVu Sans",
        "fontsize": 60,
        "primarycolor": pysubs2.Color(255, 255, 255),
        "outlinecolor": pysubs2.Color(0, 0, 0),
        "outline": 4,
        "shadow": 2,
        "bold": False,
        "marginl": 86,
        "marginr": 86,
        "marginv": 260,
    },
    "minimal": {
        "fontname": "DejaVu Sans",
        "fontsize": 56,
        "primarycolor": pysubs2.Color(245, 246, 240),
        "outlinecolor": pysubs2.Color(18, 22, 24),
        "borderstyle": 3,
        "outline": 10,
        "shadow": 0,
        "bold": True,
        "marginl": 86,
        "marginr": 86,
        "marginv": 240,
    },
}


def create_ass_captions(
    *,
    segments: list,
    trim_start_ms: int,
    trim_end_ms: int,
    style_name: str,
    position: str,
    output: Path,
) -> bool:
    subtitles = pysubs2.SSAFile()
    # Anchor all subtitle measurements to the final vertical canvas. Without an
    # explicit play resolution, libass uses a small fallback canvas and scales
    # fonts and margins unpredictably on the 1080 x 1920 export.
    subtitles.info["PlayResX"] = "1080"
    subtitles.info["PlayResY"] = "1920"
    style_values = CAPTION_STYLES.get(style_name, CAPTION_STYLES["bold"])
    style = pysubs2.SSAStyle(**style_values)
    style.alignment = {
        "top": pysubs2.Alignment.TOP_CENTER,
        "middle": pysubs2.Alignment.MIDDLE_CENTER,
        "bottom": pysubs2.Alignment.BOTTOM_CENTER,
    }.get(position, pysubs2.Alignment.BOTTOM_CENTER)
    subtitles.styles["Default"] = style
    for segment in segments:
        start = max(segment.start_ms, trim_start_ms)
        end = min(segment.end_ms, trim_end_ms)
        text = segment.text.strip()
        if not text or end <= start:
            continue
        subtitles.events.append(
            pysubs2.SSAEvent(
                start=start - trim_start_ms,
                end=end - trim_start_ms,
                text=text.replace("\n", "\\N"),
                style="Default",
            )
        )
    if not subtitles.events:
        return False
    subtitles.save(str(output))
    return True


#: The canvas every Title measurement is anchored to, matching the Subtitles
#: above and the shape the export is validated against.
TITLE_CANVAS = (1080, 1920)


def _ass_color(hex_color: str, opacity: float = 1.0) -> pysubs2.Color:
    """`#RRGGBB` plus an opacity, as ASS keeps it.

    ASS stores transparency rather than opacity, and inverted: 0 is fully
    opaque. Doing the flip in one place is what keeps a Title at 50% from
    coming out invisible.
    """
    value = hex_color.lstrip("#")
    red, green, blue = (int(value[index : index + 2], 16) for index in (0, 2, 4))
    return pysubs2.Color(red, green, blue, round((1 - max(0.0, min(1.0, opacity))) * 255))


def _ass_text(text: str, *, uppercase: bool) -> str:
    r"""A Title's words, safe to put in an ASS event.

    Braces open and close an override block, so a Title reading `{sponsored}`
    would otherwise be parsed as a malformed instruction and vanish. Escaping
    them is what makes the operator's text the operator's text.
    """
    cleaned = text.upper() if uppercase else text
    cleaned = cleaned.replace("{", r"\{").replace("}", r"\}")
    return cleaned.replace("\r\n", "\n").replace("\n", r"\N")


def create_ass_titles(
    *,
    titles: list[tuple],
    output: Path,
    canvas: tuple[int, int] = TITLE_CANVAS,
) -> bool:
    r"""Draw a segment's Titles into an ASS file.

    `titles` is what `titles_in_span` produces: each Title with its start and
    end already rebased onto this segment.

    Every Title gets a style of its own, because they share nothing — one may be
    Anton in a yellow box and the next Playfair outlined in black. Placement is
    an absolute `\pos` in canvas pixels, so the same Title lands on the same
    pixels in every segment it crosses and the joins do not show.

    The event's left and right margins are what set the wrap width. libass wraps
    inside them even under `\pos`, which is what makes a Title's `width_percent`
    mean the same thing here as the box the operator dragged on the stage.
    """
    width, height = canvas
    subtitles = pysubs2.SSAFile()
    subtitles.info["PlayResX"] = str(width)
    subtitles.info["PlayResY"] = str(height)
    # Greedy, line-by-line wrapping. libass's default balances the lines
    # instead, which reads better but is not what the browser does — and a
    # Title that re-wraps between the stage and the export is the one thing
    # this whole arrangement exists to avoid (ADR 0008).
    subtitles.info["WrapStyle"] = "1"
    subtitles.info["ScaledBorderAndShadow"] = "yes"

    for index, (title, start_ms, end_ms) in enumerate(titles):
        if end_ms <= start_ms:
            continue
        face = fonts.resolve_face(title.font_family, title.font_weight)
        font_px = title.font_size_percent / 100 * height
        boxed = title.background == "box"
        name = f"Title{index}"

        subtitles.styles[name] = pysubs2.SSAStyle(
            fontname=face["face_name"],
            fontsize=font_px,
            bold=face["face_bold"],
            italic=title.italic,
            primarycolor=_ass_color(title.color, title.opacity),
            # BorderStyle 3 spends the outline width on the box's padding
            # instead of on an outline, so the two are one control, not two.
            borderstyle=3 if boxed else 1,
            outlinecolor=(
                _ass_color(title.background_color, title.background_opacity)
                if boxed
                else _ass_color(title.outline_color, title.opacity)
            ),
            outline=(title.background_padding if boxed else title.outline_width) * font_px,
            backcolor=_ass_color(title.shadow_color, title.opacity),
            shadow=title.shadow_offset * font_px,
            spacing=title.letter_spacing * font_px,
        )

        box_width = title.width_percent / 100 * width
        left = title.center_x / 100 * width - box_width / 2
        # The anchor moves with the alignment so the *box* stays put: text set
        # left is pinned to the box's left edge, not centred on its middle.
        anchor, x = {
            "left": (4, left),
            "right": (6, left + box_width),
        }.get(title.align, (5, title.center_x / 100 * width))

        subtitles.events.append(
            pysubs2.SSAEvent(
                start=start_ms,
                end=end_ms,
                style=name,
                marginl=max(0, round(left)),
                marginr=max(0, round(width - left - box_width)),
                # ASS rotates anticlockwise where CSS rotates clockwise, and
                # the stage is the one the operator dragged.
                text=(
                    rf"{{\an{anchor}\pos({round(x)},{round(title.center_y / 100 * height)})"
                    rf"\frz{-title.rotation_deg:.2f}}}"
                    + _ass_text(title.text, uppercase=title.uppercase)
                ),
            )
        )

    if not subtitles.events:
        return False
    subtitles.save(str(output))
    return True


def _face_detector():
    try:
        import mediapipe as mp

        detector = mp.solutions.face_detection.FaceDetection(
            model_selection=1, min_detection_confidence=0.45
        )

        def detect(frame: np.ndarray) -> list[tuple[float, float, float]]:
            result = detector.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            faces = []
            for item in result.detections or []:
                box = item.location_data.relative_bounding_box
                faces.append((box.xmin + box.width / 2, box.ymin + box.height / 2, box.width * box.height))
            return faces

        return detect, detector.close
    except (ImportError, AttributeError):
        cascade = cv2.CascadeClassifier(
            str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")
        )

        def detect(frame: np.ndarray) -> list[tuple[float, float, float]]:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            height, width = gray.shape
            found = cascade.detectMultiScale(gray, 1.12, 5, minSize=(40, 40))
            return [((x + w / 2) / width, (y + h / 2) / height, (w * h) / (width * height)) for x, y, w, h in found]

        return detect, lambda: None


def create_smart_crop_video(
    *,
    source: Path,
    output: Path,
    start_ms: int,
    end_ms: int,
    fallback_center_x: float,
    progress: Callable[[int], None] | None = None,
) -> None:
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise MediaProcessingError("OpenCV could not open the source video")
    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    start_frame = max(0, round(start_ms / 1000 * fps))
    end_frame = max(start_frame + 1, round(end_ms / 1000 * fps))
    capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    writer = cv2.VideoWriter(
        str(output), cv2.VideoWriter_fourcc(*"mp4v"), fps, (1080, 1920)
    )
    if not writer.isOpened():
        capture.release()
        raise MediaProcessingError("OpenCV could not create the crop intermediate")

    detect_faces, close_detector = _face_detector()
    detect_interval = max(1, round(fps / 4))
    center_x = fallback_center_x / 100
    target_x = center_x
    last_progress = -1

    try:
        frame_number = start_frame
        while frame_number < end_frame:
            ok, frame = capture.read()
            if not ok:
                break
            height, width = frame.shape[:2]
            if (frame_number - start_frame) % detect_interval == 0:
                faces = detect_faces(frame)
                if faces:
                    target_x = max(
                        faces,
                        key=lambda face: face[2] * (1.2 - min(1.0, abs(face[0] - center_x))),
                    )[0]
            center_x += (target_x - center_x) * 0.08

            source_ratio = width / height
            target_ratio = 9 / 16
            if source_ratio >= target_ratio:
                crop_height = height
                crop_width = max(2, round(height * target_ratio))
                left = round(center_x * width - crop_width / 2)
                left = min(max(0, left), width - crop_width)
                cropped = frame[:, left : left + crop_width]
            else:
                crop_width = width
                crop_height = max(2, round(width / target_ratio))
                top = max(0, (height - crop_height) // 2)
                cropped = frame[top : top + crop_height, :]
            writer.write(cv2.resize(cropped, (1080, 1920), interpolation=cv2.INTER_AREA))

            frame_number += 1
            percent = round((frame_number - start_frame) / (end_frame - start_frame) * 100)
            if progress and percent != last_progress and percent % 2 == 0:
                progress(percent)
                last_progress = percent
    finally:
        close_detector()
        capture.release()
        writer.release()

    if not output.exists() or output.stat().st_size == 0:
        raise MediaProcessingError("No frames were produced for the selected trim range")


def render_vertical(
    *,
    source: Path,
    output: Path,
    temp_dir: Path,
    layout: str,
    start_ms: int,
    end_ms: int,
    crop_center_x: float,
    frame_zoom: float = 1.0,
    frame_center_x: float = 50.0,
    frame_center_y: float = 50.0,
    caption_segments: list,
    captions_enabled: bool,
    caption_style: str,
    caption_position: str,
    image_overlays: list,
    sequence_images: list[tuple] | None = None,
    titles: list[tuple] | None = None,
    progress: Callable[[int], None] | None = None,
) -> None:
    duration_seconds = (end_ms - start_ms) / 1000
    captions_path = temp_dir / "captions.ass"
    has_captions = captions_enabled and create_ass_captions(
        segments=caption_segments,
        trim_start_ms=start_ms,
        trim_end_ms=end_ms,
        style_name=caption_style,
        position=caption_position,
        output=captions_path,
    )
    # Already sliced to this stretch and rebased onto it by `titles_in_span`;
    # a Title is timed against the Sequence and knows nothing of a Shot's trim.
    titles_path = temp_dir / "titles.ass"
    has_titles = bool(titles) and create_ass_titles(titles=titles, output=titles_path)

    common_output = [
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-r",
        "30",
        "-movflags",
        "+faststart",
        "-t",
        f"{duration_seconds:.3f}",
        "-shortest",
        str(output),
    ]

    # Clip overlays use Source Video time; Sequence images have already been
    # sliced and rebased to this segment, just like Titles. Normalize both to
    # local milliseconds before building one ffmpeg overlay chain.
    active_overlays: list[tuple[object, Path, int, int]] = []
    for overlay in image_overlays:
        path = Path(overlay.artifact.path)
        if overlay.end_ms > start_ms and overlay.start_ms < end_ms and path.is_file():
            active_overlays.append(
                (
                    overlay,
                    path,
                    max(0, overlay.start_ms - start_ms),
                    min(end_ms, overlay.end_ms) - start_ms,
                )
            )
    for overlay, local_start_ms, local_end_ms in sequence_images or []:
        path = Path(overlay.path)
        if local_end_ms > local_start_ms and path.is_file():
            active_overlays.append((overlay, path, local_start_ms, local_end_ms))

    def add_overlay_inputs(command: list[str]) -> None:
        for _overlay, path, _starts_at, _ends_at in active_overlays:
            command.extend(["-loop", "1", "-i", str(path)])

    def add_overlay_filters(
        filters: list[str], base_label: str, first_input: int
    ) -> str:
        current = base_label
        for sequence, (overlay, _path, local_start_ms, local_end_ms) in enumerate(active_overlays):
            image_label = f"image{sequence}"
            output_label = f"overlay{sequence}"
            width = max(2, round(1080 * overlay.width_percent / 100))
            if width % 2:
                width += 1
            starts_at = local_start_ms / 1000
            ends_at = local_end_ms / 1000
            x = f"W*{overlay.center_x / 100:.4f}-w/2"
            y = f"H*{overlay.center_y / 100:.4f}-h/2"
            filters.append(
                f"[{first_input + sequence}:v]scale={width}:-2,format=rgba,"
                f"colorchannelmixer=aa={overlay.opacity:.3f},"
                f"rotate={overlay.rotation_deg:.3f}*PI/180:ow=rotw(iw):oh=roth(ih):c=none"
                f"[{image_label}]"
            )
            filters.append(
                f"[{current}][{image_label}]overlay=x='{x}':y='{y}':"
                f"enable='between(t,{starts_at:.3f},{ends_at:.3f})':eof_action=pass[{output_label}]"
            )
            current = output_label
        return current

    def add_text_filters(filters: list[str], base_label: str) -> str:
        """Burn in Subtitles, then Titles over them.

        Titles go last because they are placed deliberately and Subtitles land
        wherever the transcript falls; where the two collide, the one the
        operator positioned by hand is the one that should win.

        `fontsdir` is what points libass at the vendored faces. Without it a
        Title would fall back to whatever the host has installed — the export
        quietly disagreeing with the stage, which is the failure the vendored
        fonts exist to prevent (ADR 0008).
        """
        current = base_label
        if has_captions:
            filters.append(f"[{current}]ass={captions_path}[captioned]")
            current = "captioned"
        if has_titles:
            filters.append(
                f"[{current}]ass={titles_path}:fontsdir={fonts.FONTS_DIR}[titled]"
            )
            current = "titled"
        return current

    if layout == "smart_crop":
        intermediate = temp_dir / "smart-crop-intermediate.mp4"
        create_smart_crop_video(
            source=source,
            output=intermediate,
            start_ms=start_ms,
            end_ms=end_ms,
            fallback_center_x=crop_center_x,
            progress=progress,
        )
        command = [
            "ffmpeg",
            "-y",
            "-i",
            str(intermediate),
            "-ss",
            f"{start_ms / 1000:.3f}",
            "-t",
            f"{duration_seconds:.3f}",
            "-i",
            str(source),
        ]
        add_overlay_inputs(command)
        zoom_width = max(1080, round(1080 * frame_zoom))
        zoom_height = max(1920, round(1920 * frame_zoom))
        zoom_width += zoom_width % 2
        zoom_height += zoom_height % 2
        filters = [
            f"[0:v]scale={zoom_width}:{zoom_height},"
            f"crop=1080:1920:x='(iw-ow)*{frame_center_x / 100:.4f}':"
            f"y='(ih-oh)*{frame_center_y / 100:.4f}'[base]"
        ]
        map_label = add_text_filters(filters, add_overlay_filters(filters, "base", 2))
        command.extend([
            "-filter_complex",
            ";".join(filters),
            "-map",
            f"[{map_label}]",
            "-map",
            "1:a?",
        ])
        command.extend(common_output)
    else:
        # At 1× the sharp picture uses the full Format box. A landscape Clip
        # therefore touches both side edges; only the unused height is filled
        # by the blurred backdrop. Framing zoom grows from those clean bounds.
        foreground_width = max(1080, round(1080 * frame_zoom))
        foreground_height = max(1920, round(1920 * frame_zoom))
        foreground_width += foreground_width % 2
        foreground_height += foreground_height % 2
        filters = [
            "[0:v]split=2[bg][fg];"
            "[bg]scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,gblur=sigma=38[bgv];"
            f"[fg]scale={foreground_width}:{foreground_height}:"
            "force_original_aspect_ratio=decrease[fgv];"
            f"[bgv][fgv]overlay=x='(W-w)*{frame_center_x / 100:.4f}':"
            f"y='(H-h)*{frame_center_y / 100:.4f}'[composed]"
        ]
        command = [
            "ffmpeg",
            "-y",
            "-ss",
            f"{start_ms / 1000:.3f}",
            "-t",
            f"{duration_seconds:.3f}",
            "-i",
            str(source),
        ]
        add_overlay_inputs(command)
        # The composed base filter above contains its own separators, so append
        # timed overlays as additional filter-chain entries.
        map_label = add_text_filters(filters, add_overlay_filters(filters, "composed", 1))
        command.extend([
            "-filter_complex",
            ";".join(filters),
            "-map",
            f"[{map_label}]",
            "-map",
            "0:a?",
        ])
        command.extend(common_output)
    run_command(command)


"""Joining Shots into a Sequence.

Every Shot is already 1080x1920 at 30 fps, so the video needs no re-encoding.
The audio does need care: see ADR 0003. Stream-copying AAC accumulates about
27 ms of excess per join, because encoded AAC comes in whole 1024-sample
frames — measured at +250 ms of drift by the ninth join, with ffmpeg exiting 0
throughout. Remuxing each Shot to PCM first removes the padding, so a Shot's
audio is exactly as long as its video.
"""

JOIN_SAMPLE_RATE = "48000"
JOIN_CHANNELS = "2"


def replace_audio(
    *,
    video: Path,
    audio_source: Path,
    audio_start_ms: int,
    audio_end_ms: int,
    output: Path,
) -> None:
    """Put a Cutaway's picture over its Base Shot's sound.

    The picture is copied, never re-encoded — the Cutaway has already been
    rendered to the Sequence's format, and this only swaps which audio stream
    travels with it (ADR 0005). `render_vertical` maps the Source Video's audio
    straight through under `-ss`/`-t`, so taking the Base Shot's audio from its
    source at the same offsets is the same sound its own render would carry.

    A Base Shot with no audio leaves the stretch silent rather than failing;
    `normalize_for_join` generates the silence exactly as it does for any Shot
    that has none.
    """
    duration_seconds = max(0, audio_end_ms - audio_start_ms) / 1000
    if not inspect_media(audio_source)["has_audio"]:
        shutil.copyfile(video, output)
        return

    run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(video),
            "-ss",
            f"{audio_start_ms / 1000:.3f}",
            "-t",
            f"{duration_seconds:.3f}",
            "-i",
            str(audio_source),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ar",
            "48000",
            "-shortest",
            "-movflags",
            "+faststart",
            str(output),
        ]
    )


def normalize_for_join(source: Path, output: Path, *, has_audio: bool) -> None:
    """Rewrite one finished Shot into the form the join expects.

    Video is copied untouched. Audio becomes PCM at a fixed rate and channel
    count: a Shot with no audio would otherwise truncate the Sequence's audio
    track, and a mono Shot would be copied into a stream declared stereo.
    """
    command = ["ffmpeg", "-y", "-i", str(source)]
    if has_audio:
        audio_input = "0:a:0"
    else:
        command.extend(
            [
                "-f",
                "lavfi",
                "-i",
                f"anullsrc=channel_layout=stereo:sample_rate={JOIN_SAMPLE_RATE}",
            ]
        )
        audio_input = "1:a:0"
    command.extend(
        [
            "-map",
            "0:v:0",
            "-map",
            audio_input,
            "-c:v",
            "copy",
            "-c:a",
            "pcm_s16le",
            "-ar",
            JOIN_SAMPLE_RATE,
            "-ac",
            JOIN_CHANNELS,
        ]
    )
    if not has_audio:
        # anullsrc never ends on its own.
        command.append("-shortest")
    command.append(str(output))
    run_command(command)


def _concat_list(sources: list[Path], output: Path) -> None:
    lines = []
    for source in sources:
        # The concat demuxer reads single-quoted paths and has no escape of its
        # own; a literal quote is closed, escaped, and reopened.
        escaped = str(source.resolve()).replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")


def join_shots(
    *,
    shots: list[Path],
    output: Path,
    temp_dir: Path,
    progress: Callable[[int], None] | None = None,
) -> None:
    """Join finished Shots, in order, into one video.

    `shots` are per-Shot renders that already share the Sequence's format.
    """
    if not shots:
        raise MediaProcessingError("A sequence needs at least one shot to render")

    normalized = []
    for index, shot in enumerate(shots):
        if not shot.is_file():
            raise MediaProcessingError(f"Shot {index + 1} is missing its rendered video")
        target = temp_dir / f"join-{index:03d}.mkv"
        normalize_for_join(shot, target, has_audio=inspect_media(shot)["has_audio"])
        normalized.append(target)
        if progress:
            progress(round((index + 1) / len(shots) * 100))

    list_file = temp_dir / "shots.txt"
    _concat_list(normalized, list_file)
    run_command(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ar",
            JOIN_SAMPLE_RATE,
            "-ac",
            JOIN_CHANNELS,
            "-movflags",
            "+faststart",
            str(output),
        ]
    )
    for target in normalized:
        target.unlink(missing_ok=True)
    list_file.unlink(missing_ok=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
