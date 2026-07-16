import re
from pathlib import Path
from urllib.parse import urlparse

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from app.config import Settings


X_POST_RE = re.compile(
    r"^https?://(?:www\.)?(?:x\.com|twitter\.com)/[^/]+/status/(\d+)(?:[/?#].*)?$",
    re.IGNORECASE,
)


class SourceDownloadError(RuntimeError):
    pass


def normalize_x_post_url(url: str) -> tuple[str, str]:
    value = url.strip()
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("The X post URL must use HTTPS")
    match = X_POST_RE.match(value)
    if not match:
        raise ValueError("Enter an individual x.com post URL containing /status/")
    post_id = match.group(1)
    return f"https://x.com/i/status/{post_id}", post_id


def download_x_video(
    *, url: str, output_dir: Path, settings: Settings
) -> tuple[Path, dict]:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_template = str(output_dir / "source.%(ext)s")
    options = {
        "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "outtmpl": output_template,
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": True,
        "overwrites": True,
        "max_filesize": settings.max_source_bytes,
    }
    if settings.ytdlp_cookies_file:
        cookie_path = settings.ytdlp_cookies_file.expanduser()
        if not cookie_path.is_file():
            raise SourceDownloadError(
                f"YTDLP_COOKIES_FILE must point to a readable cookie file; got {cookie_path}"
            )
        options["cookiefile"] = str(cookie_path)

    try:
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=True)
    except DownloadError as exc:
        raise SourceDownloadError(str(exc).splitlines()[-1]) from exc

    duration = float(info.get("duration") or 0)
    if duration <= 0:
        raise SourceDownloadError("The post did not expose a playable video")
    if duration > settings.max_source_duration_seconds:
        raise SourceDownloadError(
            f"The source video exceeds the {settings.max_source_duration_seconds // 60}-minute limit"
        )

    candidates = sorted(
        path
        for path in output_dir.glob("source.*")
        if path.suffix not in {".part", ".ytdl"} and path.is_file()
    )
    if not candidates:
        raise SourceDownloadError("The video download completed without an output file")
    path = next((item for item in candidates if item.suffix.lower() == ".mp4"), candidates[0])
    if path.stat().st_size > settings.max_source_bytes:
        path.unlink(missing_ok=True)
        raise SourceDownloadError("The downloaded video exceeds the configured file-size limit")
    return path, info
