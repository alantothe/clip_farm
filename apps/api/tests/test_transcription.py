from datetime import timedelta
from types import SimpleNamespace

import pytest
from google.auth.exceptions import DefaultCredentialsError

from app.config import Settings
from app.services import transcription
from app.services.transcription import TranscriptWord, TranscriptionError, segment_words


def test_segment_words_respects_word_and_sentence_boundaries() -> None:
    words = [
        TranscriptWord("This", 0, 300),
        TranscriptWord("is", 310, 500),
        TranscriptWord("the", 510, 700),
        TranscriptWord("hook.", 710, 1100),
        TranscriptWord("Now", 1300, 1600),
        TranscriptWord("the", 1610, 1800),
        TranscriptWord("payoff", 1810, 2200),
        TranscriptWord("lands.", 2210, 2700),
    ]

    segments = segment_words(words)

    assert segments == [
        {"start_ms": 0, "end_ms": 1100, "text": "This is the hook."},
        {"start_ms": 1300, "end_ms": 2700, "text": "Now the payoff lands."},
    ]


def test_segment_words_caps_caption_length() -> None:
    words = [TranscriptWord(f"w{index}", index * 200, index * 200 + 150) for index in range(9)]
    segments = segment_words(words)
    assert len(segments[0]["text"].split()) == 7
    assert len(segments[1]["text"].split()) == 2


def test_result_words_can_be_offset_to_the_source_timeline() -> None:
    word = SimpleNamespace(
        word="continued",
        start_offset=timedelta(milliseconds=100),
        end_offset=timedelta(milliseconds=450),
    )
    result = SimpleNamespace(
        alternatives=[SimpleNamespace(words=[word], transcript="continued")],
        result_end_offset=timedelta(milliseconds=450),
    )

    words = transcription._words_from_results([result], offset_ms=55_000)

    assert words == [TranscriptWord("continued", 55_100, 55_450)]


def test_long_audio_is_chunked_without_a_gcs_bucket(monkeypatch, tmp_path) -> None:
    audio = tmp_path / "audio.flac"
    audio.write_bytes(b"source audio")
    chunk_requests: list[tuple[int, int]] = []

    def fake_extract(*, audio, output, start_ms, duration_ms):
        chunk_requests.append((start_ms, duration_ms))
        output.write_bytes(b"chunk audio")

    result = SimpleNamespace(
        alternatives=[
            SimpleNamespace(
                words=[
                    SimpleNamespace(
                        word="word",
                        start_offset=timedelta(milliseconds=100),
                        end_offset=timedelta(milliseconds=300),
                    )
                ],
                transcript="word",
            )
        ],
        result_end_offset=timedelta(milliseconds=300),
    )
    client = SimpleNamespace(
        recognize=lambda **_kwargs: SimpleNamespace(results=[result]),
    )
    monkeypatch.setattr(transcription, "_extract_audio_chunk", fake_extract)

    words = transcription._transcribe_audio_chunks(
        client=client,
        recognizer="projects/example/locations/global/recognizers/_",
        config=transcription.cloud_speech.RecognitionConfig(),
        audio=audio,
        duration_ms=120_000,
    )

    assert chunk_requests == [(0, 55_000), (55_000, 55_000), (110_000, 10_000)]
    assert [word.start_ms for word in words] == [100, 55_100, 110_100]


def test_missing_credentials_is_reported_as_a_transcription_error(
    monkeypatch, tmp_path
) -> None:
    audio = tmp_path / "audio.flac"
    audio.write_bytes(b"audio")
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path / "data",
        google_cloud_project="test-project",
    )

    def missing_credentials(**_kwargs):
        raise DefaultCredentialsError("credentials unavailable")

    monkeypatch.setattr(transcription.speech_v2, "SpeechClient", missing_credentials)

    with pytest.raises(TranscriptionError, match="credentials unavailable"):
        transcription.transcribe_audio(
            audio=audio,
            duration_ms=1_000,
            settings=settings,
        )
