from dataclasses import dataclass
from pathlib import Path

import google.auth
from google.cloud import speech_v2, storage
from google.cloud.speech_v2.types import cloud_speech

from app.config import Settings


@dataclass
class TranscriptWord:
    text: str
    start_ms: int
    end_ms: int


class TranscriptionError(RuntimeError):
    pass


def _project_id(settings: Settings) -> str:
    if settings.google_cloud_project:
        return settings.google_cloud_project
    _credentials, project = google.auth.default()
    if not project:
        raise TranscriptionError("GOOGLE_CLOUD_PROJECT is not configured")
    return project


def _duration_ms(value) -> int:
    if value is None:
        return 0
    return round(value.total_seconds() * 1000)


def _words_from_results(results) -> list[TranscriptWord]:
    words: list[TranscriptWord] = []
    prior_end = 0
    for result in results:
        if not result.alternatives:
            continue
        alternative = result.alternatives[0]
        if alternative.words:
            for word in alternative.words:
                start_ms = _duration_ms(word.start_offset)
                end_ms = max(start_ms + 1, _duration_ms(word.end_offset))
                words.append(TranscriptWord(word.word.strip(), start_ms, end_ms))
                prior_end = end_ms
        elif alternative.transcript.strip():
            end_ms = max(prior_end + 1000, _duration_ms(result.result_end_offset))
            tokens = alternative.transcript.strip().split()
            step = max(1, (end_ms - prior_end) // max(1, len(tokens)))
            for index, token in enumerate(tokens):
                start = prior_end + index * step
                words.append(TranscriptWord(token, start, min(end_ms, start + step)))
            prior_end = end_ms
    return words


def segment_words(words: list[TranscriptWord]) -> list[dict]:
    segments: list[dict] = []
    current: list[TranscriptWord] = []
    for word in words:
        current.append(word)
        duration = current[-1].end_ms - current[0].start_ms
        terminal = word.text.endswith((".", "!", "?", ","))
        if len(current) >= 7 or duration >= 2800 or (terminal and len(current) >= 3):
            segments.append(
                {
                    "start_ms": current[0].start_ms,
                    "end_ms": current[-1].end_ms,
                    "text": " ".join(item.text for item in current),
                }
            )
            current = []
    if current:
        segments.append(
            {
                "start_ms": current[0].start_ms,
                "end_ms": current[-1].end_ms,
                "text": " ".join(item.text for item in current),
            }
        )
    return segments


def transcribe_audio(*, audio: Path, duration_ms: int, settings: Settings) -> list[dict]:
    project = _project_id(settings)
    client = speech_v2.SpeechClient()
    features = cloud_speech.RecognitionFeatures(
        enable_word_time_offsets=True,
        enable_automatic_punctuation=True,
    )
    config = cloud_speech.RecognitionConfig(
        auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
        language_codes=[settings.speech_language],
        model=settings.speech_model,
        features=features,
    )
    recognizer = f"projects/{project}/locations/{settings.google_cloud_location}/recognizers/_"

    try:
        if duration_ms < 60_000 and audio.stat().st_size < 10_000_000:
            response = client.recognize(
                request=cloud_speech.RecognizeRequest(
                    recognizer=recognizer,
                    config=config,
                    content=audio.read_bytes(),
                )
            )
            words = _words_from_results(response.results)
        else:
            if not settings.gcs_bucket:
                raise TranscriptionError(
                    "GCS_BUCKET is required to transcribe videos of 60 seconds or longer"
                )
            storage_client = storage.Client(project=project)
            bucket = storage_client.bucket(settings.gcs_bucket)
            object_name = f"clip-farm/transcription/{audio.parent.name}/{audio.name}"
            blob = bucket.blob(object_name)
            blob.upload_from_filename(audio)
            uri = f"gs://{settings.gcs_bucket}/{object_name}"
            try:
                operation = client.batch_recognize(
                    request=cloud_speech.BatchRecognizeRequest(
                        recognizer=recognizer,
                        config=config,
                        files=[cloud_speech.BatchRecognizeFileMetadata(uri=uri)],
                        recognition_output_config=cloud_speech.RecognitionOutputConfig(
                            inline_response_config=cloud_speech.InlineOutputConfig()
                        ),
                    )
                )
                response = operation.result(timeout=900)
                words = _words_from_results(response.results[uri].transcript.results)
            finally:
                blob.delete()
    except TranscriptionError:
        raise
    except Exception as exc:
        raise TranscriptionError(f"Google Speech-to-Text failed: {exc}") from exc

    return segment_words(words)

