import hashlib
import json
import math
import subprocess
from collections.abc import Callable
from pathlib import Path

import cv2
import numpy as np
import pysubs2


class MediaProcessingError(RuntimeError):
    pass


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
        "marginv": 250,
    },
    "classic": {
        "fontname": "DejaVu Sans",
        "fontsize": 60,
        "primarycolor": pysubs2.Color(255, 255, 255),
        "outlinecolor": pysubs2.Color(0, 0, 0),
        "outline": 4,
        "shadow": 2,
        "bold": False,
        "marginv": 220,
    },
    "minimal": {
        "fontname": "DejaVu Sans",
        "fontsize": 56,
        "primarycolor": pysubs2.Color(245, 246, 240),
        "outlinecolor": pysubs2.Color(18, 22, 24),
        "outline": 2,
        "shadow": 0,
        "bold": True,
        "marginv": 190,
    },
}


def create_ass_captions(
    *, segments: list, trim_start_ms: int, trim_end_ms: int, style_name: str, output: Path
) -> bool:
    subtitles = pysubs2.SSAFile()
    style_values = CAPTION_STYLES.get(style_name, CAPTION_STYLES["bold"])
    style = pysubs2.SSAStyle(**style_values)
    style.alignment = pysubs2.Alignment.BOTTOM_CENTER
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
    caption_segments: list,
    captions_enabled: bool,
    caption_style: str,
    progress: Callable[[int], None] | None = None,
) -> None:
    duration_seconds = (end_ms - start_ms) / 1000
    captions_path = temp_dir / "captions.ass"
    has_captions = captions_enabled and create_ass_captions(
        segments=caption_segments,
        trim_start_ms=start_ms,
        trim_end_ms=end_ms,
        style_name=caption_style,
        output=captions_path,
    )

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
        "192k",
        "-movflags",
        "+faststart",
        "-shortest",
        str(output),
    ]

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
            "-map",
            "0:v:0",
            "-map",
            "1:a?",
        ]
        if has_captions:
            command.extend(["-vf", f"ass={captions_path}"])
        command.extend(common_output)
    else:
        filter_graph = (
            "[0:v]split=2[bg][fg];"
            "[bg]scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,gblur=sigma=38[bgv];"
            "[fg]scale=1000:1780:force_original_aspect_ratio=decrease[fgv];"
            "[bgv][fgv]overlay=(W-w)/2:(H-h)/2[composed]"
        )
        map_label = "composed"
        if has_captions:
            filter_graph += f";[composed]ass={captions_path}[outv]"
            map_label = "outv"
        command = [
            "ffmpeg",
            "-y",
            "-ss",
            f"{start_ms / 1000:.3f}",
            "-t",
            f"{duration_seconds:.3f}",
            "-i",
            str(source),
            "-filter_complex",
            filter_graph,
            "-map",
            f"[{map_label}]",
            "-map",
            "0:a?",
        ] + common_output
    run_command(command)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

