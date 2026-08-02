"""Accepting a Source Video that the operator uploads from disk.

The X importer downloads its Source Video inside the worker, where a slow fetch
costs nobody anything. An upload arrives on the request thread instead, so this
module streams it straight to the Clip's media directory and enforces the size
ceiling while writing rather than trusting a Content-Length header.
"""

from pathlib import Path

from fastapi import UploadFile


class UploadRejected(ValueError):
    """The uploaded file cannot become a Source Video."""


# Extension is what ffmpeg keys off, so an unknown content type with a known
# extension is still worth accepting; browsers disagree about container types.
ALLOWED_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
ALLOWED_CONTENT_TYPES = {
    "video/mp4",
    "video/quicktime",
    "video/x-m4v",
    "video/webm",
    "video/x-matroska",
    "video/x-msvideo",
    "application/octet-stream",
}


def source_suffix(filename: str | None) -> str:
    """Return the Source Video suffix to store, rejecting anything unplayable."""
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise UploadRejected(
            f"{Path(filename or 'This file').name} is not a video Clip Farm can read. "
            f"Use {', '.join(sorted(ALLOWED_SUFFIXES))}."
        )
    return suffix


def clip_title(filename: str | None) -> str:
    """A Clip's opening title is the uploaded file's name without its suffix."""
    stem = Path(filename or "").stem.strip()
    return (stem or "Uploaded clip")[:160]


def ensure_accepted_content_type(upload: UploadFile) -> None:
    content_type = (upload.content_type or "").split(";")[0].strip().lower()
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise UploadRejected(
            f"{Path(upload.filename or 'This file').name} is a {content_type} file, not a video."
        )


async def store_source_video(upload: UploadFile, destination: Path, *, max_bytes: int) -> int:
    """Stream `upload` to `destination`, returning its size in bytes.

    The partial file is removed on any failure so a rejected upload never leaves
    a half-written Source Video behind for the importer to find.
    """
    ensure_accepted_content_type(upload)
    destination.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        with destination.open("wb") as output:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise UploadRejected(
                        f"{Path(upload.filename or 'This file').name} is larger than the "
                        f"{max_bytes // 1_000_000} MB limit."
                    )
                output.write(chunk)
        if size == 0:
            raise UploadRejected(f"{Path(upload.filename or 'This file').name} is empty.")
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return size
