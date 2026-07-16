import logging
import mimetypes
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete

from app.config import get_settings
from app.database import SessionLocal
from app.models import Artifact, CaptionSegment, Job, Project, Render
from app.queue import huey
from app.services.media import (
    create_preview,
    create_thumbnail,
    extract_audio,
    inspect_media,
    render_vertical,
    sha256_file,
)
from app.services.transcription import TranscriptionError, transcribe_audio
from app.services.x_download import download_x_video, extract_post_caption


settings = get_settings()
logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _update_job(job: Job, *, status: str | None = None, progress: int | None = None, message: str | None = None) -> None:
    if status is not None:
        job.status = status
    if progress is not None:
        job.progress = max(0, min(100, progress))
    if message is not None:
        job.message = message


def _add_artifact(session, project_id: str, kind: str, path: Path, mime_type: str | None = None) -> Artifact:
    artifact = Artifact(
        project_id=project_id,
        kind=kind,
        path=str(path),
        mime_type=mime_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream",
        size_bytes=path.stat().st_size,
    )
    session.add(artifact)
    return artifact


def _source_artifact(project: Project) -> Artifact:
    artifact = next((item for item in project.artifacts if item.kind == "source"), None)
    if not artifact:
        raise RuntimeError("The project source video is missing")
    return artifact


def _replace_captions(session, project: Project, segments: list[dict]) -> None:
    session.execute(delete(CaptionSegment).where(CaptionSegment.project_id == project.id))
    for sequence, segment in enumerate(segments):
        session.add(
            CaptionSegment(
                project_id=project.id,
                sequence=sequence,
                start_ms=segment["start_ms"],
                end_ms=segment["end_ms"],
                text=segment["text"],
            )
        )
    project.updated_at = _now()


def _transcribe_project(session, project: Project, audio: Path, job: Job) -> None:
    project.transcription_status = "processing"
    _update_job(job, progress=68, message="Creating captions")
    session.commit()
    try:
        segments = transcribe_audio(
            audio=audio,
            duration_ms=project.duration_ms or 0,
            settings=settings,
        )
        _replace_captions(session, project, segments)
        project.transcription_status = "complete" if segments else "empty"
    except TranscriptionError as exc:
        project.transcription_status = "failed"
        job.message = "Video ready; automatic captions unavailable"
        job.error_message = str(exc)
    session.commit()


@huey.task(retries=1, retry_delay=15)
def import_project_task(project_id: str, job_id: str) -> None:
    with SessionLocal() as session:
        project = session.get(Project, project_id)
        job = session.get(Job, job_id)
        if not project or not job:
            return
        try:
            job.started_at = _now()
            job.attempts += 1
            job.error_message = None
            project.status = "processing"
            project.error_message = None
            _update_job(job, status="running", progress=4, message="Reading X post")
            session.commit()

            project_dir = settings.projects_dir / project.id
            source, info = download_x_video(
                url=project.source_url,
                output_dir=project_dir,
                settings=settings,
            )
            _update_job(job, progress=32, message="Inspecting source video")
            session.commit()

            metadata = inspect_media(source)
            source_caption = extract_post_caption(info)
            project.source_caption = source_caption
            project.social_caption = source_caption
            project.title = str(info.get("title") or source_caption or "Imported X clip")[:160]
            project.duration_ms = metadata["duration_ms"]
            project.trim_end_ms = metadata["duration_ms"]
            project.width = metadata["width"]
            project.height = metadata["height"]
            project.fps = metadata["fps"]

            session.execute(delete(Artifact).where(Artifact.project_id == project.id))
            _add_artifact(session, project.id, "source", source)
            session.commit()

            preview = project_dir / "preview.mp4"
            thumbnail = project_dir / "thumbnail.jpg"
            _update_job(job, progress=40, message="Building editor preview")
            session.commit()
            create_preview(source, preview)
            create_thumbnail(source, thumbnail)
            _add_artifact(session, project.id, "preview", preview, "video/mp4")
            _add_artifact(session, project.id, "thumbnail", thumbnail, "image/jpeg")

            if metadata["has_audio"]:
                audio = project_dir / "speech.flac"
                _update_job(job, progress=58, message="Extracting speech")
                session.commit()
                extract_audio(source, audio)
                _add_artifact(session, project.id, "audio", audio, "audio/flac")
                session.commit()
                _transcribe_project(session, project, audio, job)
            else:
                project.transcription_status = "no_audio"

            project.status = "ready"
            job.completed_at = _now()
            final_message = (
                "Ready to edit"
                if project.transcription_status in {"complete", "empty", "no_audio"}
                else "Ready to edit; captions need attention"
            )
            _update_job(job, status="complete", progress=100, message=final_message)
            session.commit()
        except Exception as exc:
            failed_stage = job.message
            error_detail = (
                f"Stage: {failed_stage}\n"
                f"Error type: {type(exc).__name__}\n"
                f"Message: {exc or 'No error message was provided'}"
            )
            project.status = "failed"
            project.error_message = error_detail
            job.error_message = error_detail
            job.completed_at = _now()
            _update_job(
                job,
                status="failed",
                message=f"Import failed while {failed_stage.lower()}",
            )
            session.commit()
            logger.exception(
                "Project import failed during %s (project=%s, job=%s)",
                failed_stage,
                project_id,
                job_id,
            )
            raise


@huey.task(retries=1, retry_delay=15)
def transcribe_project_task(project_id: str, job_id: str) -> None:
    with SessionLocal() as session:
        project = session.get(Project, project_id)
        job = session.get(Job, job_id)
        if not project or not job:
            return
        audio_artifact = next((item for item in project.artifacts if item.kind == "audio"), None)
        if not audio_artifact:
            _update_job(job, status="failed", message="No audio track")
            job.error_message = "The source video has no extracted audio"
            session.commit()
            return
        try:
            job.started_at = _now()
            job.attempts += 1
            _update_job(job, status="running", progress=10, message="Creating captions")
            session.commit()
            _transcribe_project(session, project, Path(audio_artifact.path), job)
            job.completed_at = _now()
            if project.transcription_status == "failed":
                _update_job(job, status="failed", message="Captioning failed")
            else:
                _update_job(job, status="complete", progress=100, message="Captions ready")
            session.commit()
        except Exception as exc:
            project.transcription_status = "failed"
            job.error_message = str(exc)
            job.completed_at = _now()
            _update_job(job, status="failed", message="Captioning failed")
            session.commit()
            raise


@huey.task(retries=0)
def render_project_task(project_id: str, render_id: str, job_id: str) -> None:
    with SessionLocal() as session:
        project = session.get(Project, project_id)
        render = session.get(Render, render_id)
        job = session.get(Job, job_id)
        if not project or not render or not job:
            return
        try:
            job.started_at = _now()
            job.attempts += 1
            render.status = "running"
            _update_job(job, status="running", progress=3, message="Preparing vertical render")
            session.commit()

            source = Path(_source_artifact(project).path)
            project_dir = settings.projects_dir / project.id
            render_dir = project_dir / "renders" / render.id
            render_dir.mkdir(parents=True, exist_ok=True)
            output = render_dir / "clip-farm-vertical.mp4"

            def report_crop(percent: int) -> None:
                with SessionLocal() as update_session:
                    active_job = update_session.get(Job, job.id)
                    if active_job:
                        _update_job(
                            active_job,
                            progress=10 + round(percent * 0.7),
                            message="Tracking subject and reframing",
                        )
                        update_session.commit()

            render_vertical(
                source=source,
                output=output,
                temp_dir=render_dir,
                layout=render.layout,
                start_ms=render.trim_start_ms,
                end_ms=render.trim_end_ms,
                crop_center_x=project.crop_center_x,
                caption_segments=project.captions,
                captions_enabled=render.captions_enabled,
                caption_style=render.caption_style,
                caption_position=render.caption_position,
                image_overlays=project.image_overlays,
                progress=report_crop if render.layout == "smart_crop" else None,
            )

            _update_job(job, progress=92, message="Validating MP4")
            session.commit()
            metadata = inspect_media(output)
            if metadata["width"] != 1080 or metadata["height"] != 1920:
                raise RuntimeError("The render did not produce a 1080x1920 output")
            render.path = str(output)
            render.checksum = sha256_file(output)
            render.size_bytes = output.stat().st_size
            render.duration_ms = metadata["duration_ms"]
            render.status = "complete"
            render.completed_at = _now()
            job.completed_at = _now()
            _update_job(job, status="complete", progress=100, message="Vertical clip ready")
            session.commit()
        except Exception as exc:
            render.status = "failed"
            render.error_message = str(exc)
            job.error_message = str(exc)
            job.completed_at = _now()
            _update_job(job, status="failed", message="Render failed")
            session.commit()
            raise
