import logging
import mimetypes
import shutil
from datetime import datetime, timezone
from pathlib import Path

from huey import crontab
from sqlalchemy import delete

from app.config import get_settings
from app.database import SessionLocal
from app.models import (
    Artifact,
    Batch,
    CaptionSegment,
    Job,
    PlatformAccount,
    Project,
    Publication,
    Render,
    SequencePublication,
    SequenceRender,
)
from app.queue import huey
from app.services.media import (
    create_preview,
    create_thumbnail,
    extract_audio,
    inspect_media,
    join_shots,
    render_vertical,
    replace_audio,
    sha256_file,
)
from app.services.sequence import plan_sequence
from app.services.sequence_layers import sync_sequence_end_layers
from app.services.batch_media import media_in_span
from app.services.titles import titles_in_span
from app.services.transcription import TranscriptionError, transcribe_audio
from app.services.x_download import download_x_video, extract_post_caption
from app.publishers import (
    PublishContext,
    PublishError,
    check_account,
    get_publisher,
)
from app.publishers.targets import video_for_render, video_for_sequence_render
from app.services.instagram import InstagramConnectionError


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


def _prepare_clip(session, project: Project, job: Job, source: Path) -> None:
    """Turn a Source Video already on disk into a Clip that can be edited.

    Shared by both Origin Kinds: an `x` Clip reaches this point by downloading
    its Source Video, an `upload` Clip by having it written during the request.
    Everything downstream — inspection, preview, thumbnail, Subtitles — is the
    same work, so it lives here rather than in each importer.
    """
    project_dir = settings.projects_dir / project.id
    _update_job(job, progress=32, message="Inspecting source video")
    session.commit()

    metadata = inspect_media(source)
    project.duration_ms = metadata["duration_ms"]
    project.trim_end_ms = metadata["duration_ms"]
    project.width = metadata["width"]
    project.height = metadata["height"]
    project.fps = metadata["fps"]
    if project.batch_id:
        sync_sequence_end_layers(session, project.batch_id)

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


def _fail_import(session, project: Project, job: Job, exc: Exception) -> None:
    """Record why an import stopped, naming the stage that was running."""
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
    _update_job(job, status="failed", message=f"Import failed while {failed_stage.lower()}")
    session.commit()
    logger.exception(
        "Clip import failed during %s (project=%s, job=%s)",
        failed_stage,
        project.id,
        job.id,
    )


def _start_import(session, project: Project, job: Job, message: str) -> None:
    job.started_at = _now()
    job.attempts += 1
    job.error_message = None
    project.status = "processing"
    project.error_message = None
    _update_job(job, status="running", progress=4, message=message)
    session.commit()


@huey.task(retries=1, retry_delay=15)
def import_project_task(project_id: str, job_id: str) -> None:
    with SessionLocal() as session:
        project = session.get(Project, project_id)
        job = session.get(Job, job_id)
        if not project or not job:
            return
        try:
            _start_import(session, project, job, "Reading X post")
            source, info = download_x_video(
                url=project.source_url,
                output_dir=settings.projects_dir / project.id,
                settings=settings,
            )
            source_caption = extract_post_caption(info)
            project.source_caption = source_caption
            project.social_caption = source_caption
            project.title = str(info.get("title") or source_caption or "Imported X clip")[:160]
            _prepare_clip(session, project, job, source)
        except Exception as exc:
            _fail_import(session, project, job, exc)
            raise


@huey.task(retries=1, retry_delay=15)
def import_upload_task(project_id: str, job_id: str) -> None:
    """Prepare an uploaded Clip. Its Source Video is already on disk.

    Unlike the X importer, a retry here cannot fetch the Source Video again —
    the only copy is the one the upload route wrote. So the file is located by
    name as well as by Artifact: a first attempt that failed midway may have
    cleared the Artifact rows, and re-uploading gigabytes because of a
    transient ffmpeg error would be a poor trade.
    """
    with SessionLocal() as session:
        project = session.get(Project, project_id)
        job = session.get(Job, job_id)
        if not project or not job:
            return
        try:
            _start_import(session, project, job, "Reading uploaded video")
            source = next(
                (
                    Path(item.path)
                    for item in project.artifacts
                    if item.kind == "source" and Path(item.path).is_file()
                ),
                None,
            )
            if not source:
                source = next(
                    (settings.projects_dir / project.id).glob("source.*"), None
                )
            if not source or not source.is_file():
                raise RuntimeError("The uploaded source video is missing from disk")
            _prepare_clip(session, project, job, source)
        except Exception as exc:
            _fail_import(session, project, job, exc)
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


def _update_sequence(
    sequence_render: SequenceRender,
    *,
    status: str | None = None,
    progress: int | None = None,
    message: str | None = None,
) -> None:
    if status is not None:
        sequence_render.status = status
    if progress is not None:
        sequence_render.progress = max(0, min(100, progress))
    if message is not None:
        sequence_render.message = message


@huey.task(retries=0)
def render_sequence_task(batch_id: str, sequence_render_id: str) -> None:
    """Render every Shot in a Batch's Sequence, then join them into one video.

    Each Shot renders through the same `render_vertical` a lone Clip uses, with
    that Clip's layout, Subtitles, and Overlays — a Batch holds no edit settings
    of its own (ADR 0002). The trim is the exception: a Shot can carry its own,
    which is what lets one Clip appear twice at different in/out points (ADR
    0004). Joining is where the Sequence exists.
    """
    with SessionLocal() as session:
        batch = session.get(Batch, batch_id)
        sequence_render = session.get(SequenceRender, sequence_render_id)
        if not batch or not sequence_render:
            return

        render_dir = settings.batches_dir / batch.id / "sequences" / sequence_render.id
        try:
            # The relationship holds Cutaways too. They are rendered as part of
            # the Base Shot they cover, never as entries in the running order.
            shots = sorted(
                (shot for shot in batch.shots if not shot.is_cutaway),
                key=lambda shot: shot.position,
            )
            if not shots:
                raise RuntimeError("This batch has no clips in its sequence")

            _update_sequence(
                sequence_render, status="running", progress=2, message="Preparing sequence"
            )
            session.commit()

            render_dir.mkdir(parents=True, exist_ok=True)
            # A Cutaway covers the whole frame, so a covered Shot is just
            # shorter stretches in a row and the Sequence stays a concatenation
            # (ADR 0005).
            segments = plan_sequence(shots)
            if not segments:
                unusable = next((shot.clip.title for shot in shots), "A clip")
                raise RuntimeError(f"“{unusable}” has no usable trim range")

            rendered: list[Path] = []
            # Segments are the bulk of the work; the join is comparatively quick.
            for index, segment in enumerate(segments):
                clip = segment.picture.clip
                _update_sequence(
                    sequence_render,
                    progress=5 + round(index / len(segments) * 80),
                    message=f"Rendering clip {index + 1} of {len(segments)}",
                )
                session.commit()

                shot_output = render_dir / f"shot-{index:03d}.mp4"
                render_vertical(
                    source=Path(_source_artifact(clip).path),
                    output=shot_output,
                    temp_dir=render_dir,
                    layout=clip.layout,
                    start_ms=segment.picture_start_ms,
                    end_ms=segment.picture_end_ms,
                    crop_center_x=clip.crop_center_x,
                    frame_zoom=segment.picture.frame_zoom,
                    frame_center_x=segment.picture.frame_center_x,
                    frame_center_y=segment.picture.frame_center_y,
                    caption_segments=clip.captions,
                    # A Cutaway's Subtitles transcribe audio that is not
                    # playing under it, so they are not burned in (ADR 0005).
                    captions_enabled=clip.captions_enabled and not segment.is_covered,
                    caption_style=clip.caption_style,
                    caption_position=clip.caption_position,
                    image_overlays=clip.image_overlays,
                    sequence_images=media_in_span(
                        batch.media, segment.sequence_start_ms, segment.duration_ms
                    ),
                    # Titles belong to the Batch and are timed against the
                    # Sequence, so each segment takes the slice of them that
                    # plays while it does — including over a Cutaway, which a
                    # Title covers like any other picture (ADR 0008).
                    titles=titles_in_span(
                        batch.titles, segment.sequence_start_ms, segment.duration_ms
                    ),
                )

                if segment.audio is not None:
                    covered = render_dir / f"shot-{index:03d}-covered.mp4"
                    replace_audio(
                        video=shot_output,
                        audio_source=Path(_source_artifact(segment.audio.clip).path),
                        audio_start_ms=segment.audio_start_ms,
                        audio_end_ms=segment.audio_end_ms,
                        output=covered,
                    )
                    shot_output.unlink(missing_ok=True)
                    shot_output = covered

                rendered.append(shot_output)

            _update_sequence(sequence_render, progress=88, message="Joining clips")
            session.commit()
            output = render_dir / "clip-farm-sequence.mp4"
            join_shots(shots=rendered, output=output, temp_dir=render_dir)

            _update_sequence(sequence_render, progress=95, message="Validating MP4")
            session.commit()
            metadata = inspect_media(output)
            if metadata["width"] != 1080 or metadata["height"] != 1920:
                raise RuntimeError("The sequence did not produce a 1080x1920 output")

            # The per-Shot renders were only ever inputs to the join.
            for shot_output in rendered:
                shot_output.unlink(missing_ok=True)

            sequence_render.path = str(output)
            sequence_render.checksum = sha256_file(output)
            sequence_render.size_bytes = output.stat().st_size
            sequence_render.duration_ms = metadata["duration_ms"]
            sequence_render.completed_at = _now()
            _update_sequence(
                sequence_render, status="complete", progress=100, message="Sequence ready"
            )
            session.commit()
        except Exception as exc:
            failed_stage = sequence_render.message
            sequence_render.error_message = (
                f"Stage: {failed_stage}\n"
                f"Error type: {type(exc).__name__}\n"
                f"Message: {exc or 'No error message was provided'}"
            )
            sequence_render.completed_at = _now()
            _update_sequence(
                sequence_render, status="failed", message=f"Export failed while {failed_stage.lower()}"
            )
            session.commit()
            shutil.rmtree(render_dir, ignore_errors=True)
            logger.exception(
                "Sequence render failed during %s (batch=%s, sequence_render=%s)",
                failed_stage,
                batch_id,
                sequence_render_id,
            )
            raise


@huey.task(retries=0)
def publish_task(publication_id: str, job_id: str) -> None:
    """Post a finished render to whichever platform the publication names.

    The platform-specific work lives behind the Publisher protocol; this task
    owns the shared bookkeeping — job progress, publication status, and turning
    any failure into a message the UI can show.
    """
    with SessionLocal() as session:
        publication = session.get(Publication, publication_id)
        job = session.get(Job, job_id)
        if not publication or not job:
            return
        render = publication.render
        account = session.get(PlatformAccount, publication.account_id)
        label = publication.platform.title()
        try:
            publisher = get_publisher(publication.platform)
            check_account(publisher, account)
            video = video_for_render(render)
            publisher.check_video(video)

            publication.started_at = _now()
            publication.status = "processing"
            publication.error_message = None
            job.started_at = _now()
            job.attempts += 1
            job.error_message = None
            _update_job(job, status="running", progress=5, message=f"Preparing {label} upload")
            session.commit()

            def report(progress: int, message: str) -> None:
                _update_job(job, progress=progress, message=message)
                session.commit()

            result = publisher.publish(
                PublishContext(
                    publication=publication,
                    account=account,
                    video=video,
                    access_token=publisher.access_token(session, account),
                    report=report,
                )
            )

            publication.remote_media_id = result.remote_media_id
            publication.permalink = result.permalink
            publication.status = "complete"
            publication.completed_at = _now()
            job.completed_at = _now()
            _update_job(job, status="complete", progress=100, message=f"Posted to {label}")
            session.commit()
        except Exception as exc:
            publication.status = "failed"
            publication.error_message = str(exc)
            publication.completed_at = _now()
            job.error_message = str(exc)
            job.completed_at = _now()
            _update_job(job, status="failed", message=f"{label} post failed")
            session.commit()
            logger.exception(
                "Publication failed (platform=%s, publication=%s, render=%s, job=%s)",
                publication.platform,
                publication_id,
                render.id,
                job_id,
            )


@huey.task(retries=0)
def publish_instagram_task(publication_id: str, job_id: str) -> None:
    """Kept so publications enqueued under the old task name still resolve."""
    publish_task.call_local(publication_id, job_id)


@huey.task(retries=0)
def publish_sequence_task(publication_id: str) -> None:
    """Post a Batch's Sequence Render to the Platform its publication names.

    The same shape as `publish_task`, against the row a Batch can actually
    have: progress lands on the publication rather than a Job, because a Job
    needs a Clip and a Sequence has none (ADR 0003, ADR 0012).
    """
    with SessionLocal() as session:
        publication = session.get(SequencePublication, publication_id)
        if not publication:
            return
        sequence_render = publication.sequence_render
        account = session.get(PlatformAccount, publication.account_id)
        label = publication.platform.title()
        try:
            publisher = get_publisher(publication.platform)
            check_account(publisher, account)
            video = video_for_sequence_render(sequence_render)
            publisher.check_video(video)

            publication.started_at = _now()
            publication.status = "processing"
            publication.progress = 5
            publication.message = f"Preparing {label} upload"
            publication.error_message = None
            session.commit()

            def report(progress: int, message: str) -> None:
                publication.progress = max(0, min(100, progress))
                publication.message = message
                session.commit()

            result = publisher.publish(
                PublishContext(
                    publication=publication,
                    account=account,
                    video=video,
                    access_token=publisher.access_token(session, account),
                    report=report,
                )
            )

            publication.remote_media_id = result.remote_media_id
            publication.permalink = result.permalink
            publication.status = "complete"
            publication.progress = 100
            publication.message = f"Posted to {label}"
            publication.completed_at = _now()
            session.commit()
        except Exception as exc:
            publication.status = "failed"
            publication.error_message = str(exc)
            publication.message = f"{label} post failed"
            publication.completed_at = _now()
            session.commit()
            logger.exception(
                "Sequence publication failed (platform=%s, publication=%s, batch=%s)",
                publication.platform,
                publication_id,
                publication.batch_id,
            )


@huey.periodic_task(crontab(hour="3", minute="15"))
def refresh_instagram_token_task() -> None:
    with SessionLocal() as session:
        account = session.query(PlatformAccount).filter_by(platform="instagram").first()
        if not account or account.status != "connected":
            return
        try:
            get_publisher("instagram").access_token(session, account)
        except (PublishError, InstagramConnectionError):
            logger.warning("Scheduled Instagram token refresh failed", exc_info=True)
