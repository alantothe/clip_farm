import pytest
from pydantic import ValidationError

from app.schemas import ImageOverlayUpdate, ProjectUpdate


def test_project_update_rejects_inverted_trim() -> None:
    with pytest.raises(ValidationError):
        ProjectUpdate(trim_start_ms=5000, trim_end_ms=4000)


def test_project_update_rejects_invalid_layout() -> None:
    with pytest.raises(ValidationError):
        ProjectUpdate(layout="square")


def test_project_update_rejects_invalid_caption_position() -> None:
    with pytest.raises(ValidationError):
        ProjectUpdate(caption_position="left")


def test_image_overlay_update_rejects_invalid_time_or_size() -> None:
    with pytest.raises(ValidationError):
        ImageOverlayUpdate(start_ms=2000, end_ms=1500)
    with pytest.raises(ValidationError):
        ImageOverlayUpdate(width_percent=5)
    with pytest.raises(ValidationError):
        ImageOverlayUpdate(opacity=0)
    with pytest.raises(ValidationError):
        ImageOverlayUpdate(rotation_deg=181)
