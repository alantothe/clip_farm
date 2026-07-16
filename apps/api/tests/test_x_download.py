import pytest

from app.config import Settings
from app.services.x_download import (
    SourceDownloadError,
    download_x_video,
    extract_post_caption,
    normalize_x_post_url,
)


@pytest.mark.parametrize(
    ("url", "post_id"),
    [
        ("https://x.com/example/status/123456789", "123456789"),
        ("https://www.x.com/example/status/42?s=20", "42"),
        ("https://twitter.com/example/status/999#fragment", "999"),
    ],
)
def test_normalize_x_post_url(url: str, post_id: str) -> None:
    normalized, actual_id = normalize_x_post_url(url)
    assert normalized == f"https://x.com/i/status/{post_id}"
    assert actual_id == post_id


@pytest.mark.parametrize(
    "url",
    [
        "https://x.com/example",
        "https://example.com/example/status/123",
        "file:///tmp/video.mp4",
        "javascript:alert(1)",
    ],
)
def test_normalize_rejects_non_post_urls(url: str) -> None:
    with pytest.raises(ValueError):
        normalize_x_post_url(url)


def test_blank_cookie_file_setting_is_treated_as_unset(tmp_path) -> None:
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path / "data",
        ytdlp_cookies_file="",
    )

    assert settings.ytdlp_cookies_file is None


def test_cookie_file_setting_rejects_a_directory(tmp_path) -> None:
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path / "data",
        ytdlp_cookies_file=tmp_path,
    )

    with pytest.raises(SourceDownloadError, match="must point to a readable cookie file"):
        download_x_video(
            url="https://x.com/i/status/123",
            output_dir=tmp_path / "output",
            settings=settings,
        )


def test_extract_post_caption_prefers_description() -> None:
    assert extract_post_caption({"description": "  Post text  ", "title": "Fallback"}) == "Post text"
    assert extract_post_caption({"description": "", "title": "Fallback"}) == "Fallback"
    assert extract_post_caption({}) is None
