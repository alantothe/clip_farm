"""Reusable arrangements of Titles and Sequence images."""

from datetime import datetime, timezone
from pathlib import Path
import shutil

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import (
    TITLE_LOOK_FIELDS,
    BatchMedia,
    LayerProfile,
    LayerProfileMedia,
    LayerProfileTitle,
    Title,
)
from app.schemas import (
    BatchOut,
    DeletionOut,
    LayerProfileCreate,
    LayerProfileMediaOut,
    LayerProfileOut,
    LayerProfileTitleOut,
)
from app.routers._helpers import (
    batch_media,
    batch_titles,
    get_batch_or_404,
    serialize_batch,
)
from app.routers.titles import _reject_title_slot_overflow
from app.services.sequence_layers import sequence_duration_ms


settings = get_settings()
router = APIRouter()

MAX_LAYER_PROFILES = 50


def _profile_or_404(session: Session, profile_id: str) -> LayerProfile:
    profile = session.get(LayerProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Layer profile not found")
    return profile


def _profile_media_or_404(
    session: Session, profile_id: str, media_id: str
) -> LayerProfileMedia:
    item = session.get(LayerProfileMedia, media_id)
    if not item or item.profile_id != profile_id:
        raise HTTPException(status_code=404, detail="Profile image not found")
    return item


def _look_of(source: Title | LayerProfileTitle) -> dict:
    return {field: getattr(source, field) for field in TITLE_LOOK_FIELDS}


def _serialize_profile(profile: LayerProfile) -> LayerProfileOut:
    titles = [LayerProfileTitleOut.model_validate(item) for item in profile.titles]
    media: list[LayerProfileMediaOut] = []
    for item in profile.media:
        output = LayerProfileMediaOut.model_validate(item)
        output.url = f"{settings.api_prefix}/layer-profiles/{profile.id}/media/{item.id}/file"
        media.append(output)
    return LayerProfileOut(
        id=profile.id,
        name=profile.name,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
        titles=titles,
        media=media,
    )


@router.get(f"{settings.api_prefix}/layer-profiles", response_model=list[LayerProfileOut])
def list_layer_profiles(session: Session = Depends(get_db)) -> list[LayerProfileOut]:
    """Saved arrangements, newest first, available from every Batch."""
    profiles = session.scalars(
        select(LayerProfile).order_by(LayerProfile.created_at.desc())
    ).all()
    return [_serialize_profile(profile) for profile in profiles]


@router.post(
    f"{settings.api_prefix}/batches/{{batch_id}}/layer-profiles",
    response_model=LayerProfileOut,
    status_code=201,
)
def create_layer_profile(
    batch_id: str, payload: LayerProfileCreate, session: Session = Depends(get_db)
) -> LayerProfileOut:
    """Copy chosen layers into a timing-free profile.

    Image bytes are copied too. A profile therefore survives deletion of both
    the Batch it came from and an image in global Storage.
    """
    batch = get_batch_or_404(session, batch_id)
    if session.scalar(
        select(LayerProfile).where(func.lower(LayerProfile.name) == payload.name.lower())
    ):
        raise HTTPException(status_code=409, detail="A layer profile already has that name")
    if len(session.scalars(select(LayerProfile)).all()) >= MAX_LAYER_PROFILES:
        raise HTTPException(
            status_code=409, detail=f"Up to {MAX_LAYER_PROFILES} layer profiles can be saved"
        )

    titles_by_id = {item.id: item for item in batch_titles(session, batch.id)}
    media_by_id = {item.id: item for item in batch_media(session, batch.id)}
    if any(item_id not in titles_by_id for item_id in payload.title_ids):
        raise HTTPException(status_code=404, detail="One of those Titles is not in this Batch")
    if any(item_id not in media_by_id for item_id in payload.media_ids):
        raise HTTPException(status_code=404, detail="One of those images is not in this Batch")

    profile = LayerProfile(name=payload.name)
    session.add(profile)
    session.flush()
    profile_dir = settings.layer_profiles_dir / profile.id
    copied_paths: list[Path] = []
    try:
        for position, title_id in enumerate(payload.title_ids):
            source = titles_by_id[title_id]
            session.add(
                LayerProfileTitle(
                    profile_id=profile.id,
                    position=position,
                    text=source.text,
                    **_look_of(source),
                )
            )

        for position, media_id in enumerate(payload.media_ids):
            source = media_by_id[media_id]
            source_path = Path(source.path)
            if not source_path.is_file():
                raise HTTPException(status_code=404, detail=f"Image file for {source.name} not found")
            item = LayerProfileMedia(
                profile_id=profile.id,
                position=position,
                name=source.name,
                path="",
                mime_type=source.mime_type,
                size_bytes=source.size_bytes,
                center_x=source.center_x,
                center_y=source.center_y,
                width_percent=source.width_percent,
                rotation_deg=source.rotation_deg,
                opacity=source.opacity,
            )
            session.add(item)
            session.flush()
            profile_dir.mkdir(parents=True, exist_ok=True)
            target = profile_dir / f"{item.id}{source_path.suffix}"
            shutil.copy2(source_path, target)
            copied_paths.append(target)
            item.path = str(target)

        session.commit()
        session.refresh(profile)
        return _serialize_profile(profile)
    except Exception:
        session.rollback()
        for path in copied_paths:
            path.unlink(missing_ok=True)
        if profile_dir.exists():
            shutil.rmtree(profile_dir, ignore_errors=True)
        raise


@router.post(
    f"{settings.api_prefix}/batches/{{batch_id}}/layer-profiles/{{profile_id}}/apply",
    response_model=BatchOut,
    status_code=201,
)
def apply_layer_profile(
    batch_id: str, profile_id: str, session: Session = Depends(get_db)
) -> BatchOut:
    """Copy a profile onto a Batch, stretching every layer to its Sequence end."""
    batch = get_batch_or_404(session, batch_id)
    profile = _profile_or_404(session, profile_id)
    duration = sequence_duration_ms(session, batch.id)
    if duration < 400:
        raise HTTPException(status_code=409, detail="Add a video before applying a layer profile")

    existing_titles = batch_titles(session, batch.id)
    new_titles: list[Title] = []
    for saved in profile.titles:
        _reject_title_slot_overflow(existing_titles + new_titles, 0, duration)
        new_titles.append(
            Title(
                batch_id=batch.id,
                text=saved.text,
                start_ms=0,
                end_ms=duration,
                end_at_sequence_end=True,
                **_look_of(saved),
            )
        )

    copied_paths: list[Path] = []
    try:
        session.add_all(new_titles)
        for saved in profile.media:
            source_path = Path(saved.path)
            if not source_path.is_file():
                raise HTTPException(
                    status_code=404, detail=f"Profile image file for {saved.name} not found"
                )
            item = BatchMedia(
                batch_id=batch.id,
                name=saved.name,
                path="",
                mime_type=saved.mime_type,
                size_bytes=saved.size_bytes,
                start_ms=0,
                end_ms=duration,
                end_at_sequence_end=True,
                center_x=saved.center_x,
                center_y=saved.center_y,
                width_percent=saved.width_percent,
                rotation_deg=saved.rotation_deg,
                opacity=saved.opacity,
            )
            session.add(item)
            session.flush()
            media_dir = settings.batches_dir / batch.id / "media"
            media_dir.mkdir(parents=True, exist_ok=True)
            target = media_dir / f"{item.id}{source_path.suffix}"
            shutil.copy2(source_path, target)
            copied_paths.append(target)
            item.path = str(target)

        batch.updated_at = datetime.now(timezone.utc)
        session.commit()
        return serialize_batch(session, batch)
    except Exception:
        session.rollback()
        for path in copied_paths:
            path.unlink(missing_ok=True)
        raise


@router.delete(
    f"{settings.api_prefix}/layer-profiles/{{profile_id}}", response_model=DeletionOut
)
def delete_layer_profile(
    profile_id: str, session: Session = Depends(get_db)
) -> DeletionOut:
    profile = _profile_or_404(session, profile_id)
    profile_dir = settings.layer_profiles_dir / profile.id
    session.delete(profile)
    session.commit()
    shutil.rmtree(profile_dir, ignore_errors=True)
    return DeletionOut(deleted=1)


@router.get(f"{settings.api_prefix}/layer-profiles/{{profile_id}}/media/{{media_id}}/file")
def get_layer_profile_media_file(
    profile_id: str, media_id: str, session: Session = Depends(get_db)
) -> FileResponse:
    item = _profile_media_or_404(session, profile_id, media_id)
    path = Path(item.path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Profile image file not found")
    return FileResponse(path, media_type=item.mime_type, filename=item.name)
