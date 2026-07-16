import pytest

from app.config import Settings
from app.services.caption_rewrite import (
    CaptionRewriteError,
    _protect_direct_quotes,
    _restore_direct_quotes,
    censor_profanity,
    rewrite_social_caption,
)


def test_censor_profanity_preserves_direct_quotes() -> None:
    assert (
        censor_profanity('This shit is wild, but she said “what the fuck?”')
        == 'This sh*t is wild, but she said “what the fuck?”'
    )


def test_quote_placeholders_round_trip_exactly() -> None:
    protected, quotes = _protect_direct_quotes('He said "Keep THIS!" and “that too.”')
    assert protected == "He said [[[DIRECT_QUOTE_0]]] and [[[DIRECT_QUOTE_1]]]"
    assert _restore_direct_quotes(protected, quotes) == 'He said "Keep THIS!" and “that too.”'


def test_missing_quote_placeholder_is_rejected() -> None:
    with pytest.raises(CaptionRewriteError, match="preserve a direct quote"):
        _restore_direct_quotes("The model dropped it", ['"verbatim"'])


def test_rewrite_requires_google_cloud_project(tmp_path) -> None:
    settings = Settings(_env_file=None, data_dir=tmp_path / "data", google_cloud_project=None)

    with pytest.raises(CaptionRewriteError, match="GOOGLE_CLOUD_PROJECT"):
        rewrite_social_caption(caption="Rewrite me", settings=settings)


def test_rewrite_restores_quotes_and_censors_generated_text(tmp_path, monkeypatch) -> None:
    from google import genai

    class FakeModels:
        def generate_content(self, **_kwargs):
            return type("Response", (), {"text": "This shit is surprising. [[[DIRECT_QUOTE_0]]]"})()

    class FakeClient:
        models = FakeModels()

        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

    monkeypatch.setattr(genai, "Client", FakeClient)
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path / "data",
        google_cloud_project="test-project",
    )

    result = rewrite_social_caption(
        caption='This is wild. "Do not change this shit."',
        settings=settings,
    )

    assert result == 'This sh*t is surprising. "Do not change this shit."'
