import pytest

from app.services.x_download import normalize_x_post_url


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

