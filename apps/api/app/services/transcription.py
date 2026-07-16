import subprocess
import tempfile
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


INLINE_RECOGNITION_LIMIT_MS = 55_000
INLINE_CONTENT_LIMIT_BYTES = 10_000_000


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


def _words_from_results(results, *, offset_ms: int = 0) -> list[TranscriptWord]:
    words: list[TranscriptWord] = []
    prior_end = offset_ms
    for result in results:
        if not result.alternatives:
            continue
        alternative = result.alternatives[0]
        if alternative.words:
            for word in alternative.words:
                start_ms = offset_ms + _duration_ms(word.start_offset)
                end_ms = max(start_ms + 1, offset_ms + _duration_ms(word.end_offset))
                words.append(TranscriptWord(word.word.strip(), start_ms, end_ms))
                prior_end = end_ms
        elif alternative.transcript.strip():
            end_ms = max(
                prior_end + 1000,
                offset_ms + _duration_ms(result.result_end_offset),
            )
            tokens = alternative.transcript.strip().split()
            step = max(1, (end_ms - prior_end) // max(1, len(tokens)))
            for index, token in enumerate(tokens):
                start = prior_end + index * step
                words.append(TranscriptWord(token, start, min(end_ms, start + step)))
            prior_end = end_ms
    return words


def _extract_audio_chunk(*, audio: Path, output: Path, start_ms: int, duration_ms: int) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_ms / 1000:.3f}",
        "-i",
        str(audio),
        "-t",
        f"{duration_ms / 1000:.3f}",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "flac",
        str(output),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except FileNotFoundError as exc:
        raise TranscriptionError("FFmpeg is required to caption long videos") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "FFmpeg could not split the audio").strip().splitlines()
        raise TranscriptionError(detail[-1] if detail else "FFmpeg could not split the audio") from exc


def _transcribe_audio_chunks(
    *, client, recognizer: str, config, audio: Path, duration_ms: int
) -> list[TranscriptWord]:
    if duration_ms <= 0:
        raise TranscriptionError("The video duration is unavailable for captioning")

    words: list[TranscriptWord] = []
    with tempfile.TemporaryDirectory(prefix="caption-chunks-", dir=audio.parent) as temp_dir:
        chunk_dir = Path(temp_dir)
        for start_ms in range(0, duration_ms, INLINE_RECOGNITION_LIMIT_MS):
            chunk_duration_ms = min(INLINE_RECOGNITION_LIMIT_MS, duration_ms - start_ms)
            chunk = chunk_dir / f"chunk-{start_ms:010d}.flac"
            _extract_audio_chunk(
                audio=audio,
                output=chunk,
                start_ms=start_ms,
                duration_ms=chunk_duration_ms,
            )
            response = client.recognize(
                request=cloud_speech.RecognizeRequest(
                    recognizer=recognizer,
                    config=config,
                    content=chunk.read_bytes(),
                )
            )
            words.extend(_words_from_results(response.results, offset_ms=start_ms))
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
        if (
            duration_ms <= INLINE_RECOGNITION_LIMIT_MS
            and audio.stat().st_size < INLINE_CONTENT_LIMIT_BYTES
        ):
            response = client.recognize(
                request=cloud_speech.RecognizeRequest(
                    recognizer=recognizer,
                    config=config,
                    content=audio.read_bytes(),
                )
            )
            words = _words_from_results(response.results)
        elif settings.gcs_bucket:
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
        else:
            words = _transcribe_audio_chunks(
                client=client,
                recognizer=recognizer,
                config=config,
                audio=audio,
                duration_ms=duration_ms,
            )
    except TranscriptionError:
        raise
    except Exception as exc:
        raise TranscriptionError(f"Google Speech-to-Text failed: {exc}") from exc

    return segment_words(words)
