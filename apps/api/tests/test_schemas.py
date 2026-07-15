import pytest
from pydantic import ValidationError

from app.schemas import ProjectUpdate


def test_project_update_rejects_inverted_trim() -> None:
    with pytest.raises(ValidationError):
        ProjectUpdate(trim_start_ms=5000, trim_end_ms=4000)


def test_project_update_rejects_invalid_layout() -> None:
    with pytest.raises(ValidationError):
        ProjectUpdate(layout="square")

