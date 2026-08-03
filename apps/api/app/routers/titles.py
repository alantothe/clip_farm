"""A Batch's Titles, the Styles they are made from, and the vendored fonts.

Title edits return the whole Batch, as Sequence edits do: one response
re-renders the Title Track, the stage and everything else that reads the Batch,
and the web's optimistic cache has a single shape to roll back to.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Batch, Phrase, Title, TitleStyle
from app.schemas import (
    BatchOut,
    DeletionOut,
    FontCatalogOut,
    FontFaceOut,
    FontFamilyOut,
    PhraseOut,
    PhraseWrite,
    TitleCreate,
    TitleStyleOut,
    TitleStyleWrite,
    TitleUpdate,
)
from app.services import fonts
from app.services.titles import BUILTIN_STYLES, apply_style, builtin_style, is_builtin, look_of

from app.routers._helpers import batch_titles, get_batch_or_404, serialize_batch


settings = get_settings()

router = APIRouter()

# A Sequence nobody would sit through is still a Sequence, but a Batch carrying
# thousands of Titles would build an ASS file per segment large enough to slow
# every export. This is a sanity bound, not a design limit.
MAX_TITLES_PER_BATCH = 200

# Three independent text rows are visible in the editor. Titles can overlap,
# but a fourth Title at the same instant would have no row of its own and would
# hide another edit on the Timeline.
MAX_SIMULTANEOUS_TITLES = 3

# Every Phrase is drawn in its own face on the panel, so the list is a download
# as well as a list. Past this many it stops being something an operator picks
# from by eye, which is the only thing it is for.
MAX_PHRASES = 60


def _touch(session: Session, batch: Batch) -> BatchOut:
    batch.updated_at = datetime.now(timezone.utc)
    session.commit()
    return serialize_batch(session, batch)


def _get_title_or_404(session: Session, batch: Batch, title_id: str) -> Title:
    title = session.get(Title, title_id)
    if not title or title.batch_id != batch.id:
        raise HTTPException(status_code=404, detail="Title not found")
    return title


def _reject_title_slot_overflow(
    titles: list[Title], start_ms: int, end_ms: int, *, replacing_id: str | None = None
) -> None:
    """Reject a span that would need a fourth simultaneous text row.

    Endpoints are half-open, as they are in the renderer: one Title ending at
    3s and another starting at 3s reuse the same slot. Existing Titles are
    clipped to the proposed span so unrelated legacy data cannot block an edit.
    """
    events = [(start_ms, 1), (end_ms, -1)]
    for title in titles:
        if title.id == replacing_id or title.start_ms >= end_ms or title.end_ms <= start_ms:
            continue
        events.extend(
            (
                (max(start_ms, title.start_ms), 1),
                (min(end_ms, title.end_ms), -1),
            )
        )

    active = 0
    for _at_ms, change in sorted(events, key=lambda event: (event[0], event[1])):
        active += change
        if active > MAX_SIMULTANEOUS_TITLES:
            raise HTTPException(
                status_code=409,
                detail=f"Up to {MAX_SIMULTANEOUS_TITLES} text slots can play at once",
            )


def _resolve_style(session: Session, style_id: str) -> TitleStyle | dict:
    """The Style behind an id, whether it is one of Clip Farm's or the operator's."""
    if is_builtin(style_id):
        style = builtin_style(style_id)
        if not style:
            raise HTTPException(status_code=404, detail="Title style not found")
        return style
    style = session.get(TitleStyle, style_id)
    if not style:
        raise HTTPException(status_code=404, detail="Title style not found")
    return style


@router.post(
    f"{settings.api_prefix}/batches/{{batch_id}}/titles",
    response_model=BatchOut,
    status_code=201,
)
def add_title(
    batch_id: str, payload: TitleCreate, session: Session = Depends(get_db)
) -> BatchOut:
    """Write a Title onto the Batch's Sequence, at a span of Sequence time.

    A Style is applied first and anything sent alongside it wins, so the same
    request can start from a Style and depart from it.
    """
    batch = get_batch_or_404(session, batch_id)
    titles = batch_titles(session, batch.id)
    if len(titles) >= MAX_TITLES_PER_BATCH:
        raise HTTPException(
            status_code=409,
            detail=f"A batch holds up to {MAX_TITLES_PER_BATCH} titles",
        )
    _reject_title_slot_overflow(titles, payload.start_ms, payload.end_ms)

    title = Title(
        batch_id=batch.id,
        text=payload.text,
        start_ms=payload.start_ms,
        end_ms=payload.end_ms,
    )
    if payload.style_id is not None:
        apply_style(title, _resolve_style(session, payload.style_id))
        title.style_id = None if is_builtin(payload.style_id) else payload.style_id
    for field, value in payload.look().items():
        setattr(title, field, value)
    session.add(title)
    return _touch(session, batch)


@router.patch(
    f"{settings.api_prefix}/batches/{{batch_id}}/titles/{{title_id}}",
    response_model=BatchOut,
)
def update_title(
    batch_id: str, title_id: str, payload: TitleUpdate, session: Session = Depends(get_db)
) -> BatchOut:
    """Retime a Title, rewrite it, restyle it, or move it on the stage."""
    batch = get_batch_or_404(session, batch_id)
    title = _get_title_or_404(session, batch, title_id)

    if payload.style_id is not None:
        apply_style(title, _resolve_style(session, payload.style_id))
        title.style_id = None if is_builtin(payload.style_id) else payload.style_id

    sent = payload.model_fields_set
    start = payload.start_ms if payload.start_ms is not None else title.start_ms
    end = payload.end_ms if payload.end_ms is not None else title.end_ms
    if ("start_ms" in sent or "end_ms" in sent) and end <= start:
        # Caught here rather than at export, where the Title would silently
        # render as nothing after every other segment had been rebuilt.
        raise HTTPException(status_code=422, detail="A title has to end after it starts")
    if "start_ms" in sent or "end_ms" in sent:
        _reject_title_slot_overflow(
            batch_titles(session, batch.id), start, end, replacing_id=title.id
        )
    title.start_ms, title.end_ms = start, end
    if payload.text is not None:
        title.text = payload.text

    for field, value in payload.look().items():
        setattr(title, field, value)
    return _touch(session, batch)


@router.delete(
    f"{settings.api_prefix}/batches/{{batch_id}}/titles/{{title_id}}",
    response_model=BatchOut,
)
def remove_title(batch_id: str, title_id: str, session: Session = Depends(get_db)) -> BatchOut:
    batch = get_batch_or_404(session, batch_id)
    session.delete(_get_title_or_404(session, batch, title_id))
    return _touch(session, batch)


def _serialize_style(style: TitleStyle | dict) -> TitleStyleOut:
    if isinstance(style, dict):
        return TitleStyleOut(id=style["id"], name=style["name"], builtin=True, **look_of(style))
    return TitleStyleOut(id=style.id, name=style.name, builtin=False, **look_of(style))


@router.get(f"{settings.api_prefix}/title-styles", response_model=list[TitleStyleOut])
def list_title_styles(session: Session = Depends(get_db)) -> list[TitleStyleOut]:
    """Clip Farm's Styles first, then the operator's, newest last.

    Styles are global rather than per-Batch: saving one is how a look is reused
    on the next Batch, which is the whole point of saving it.
    """
    saved = session.scalars(select(TitleStyle).order_by(TitleStyle.created_at)).all()
    return [_serialize_style(style) for style in (*BUILTIN_STYLES, *saved)]


@router.post(f"{settings.api_prefix}/title-styles", response_model=TitleStyleOut, status_code=201)
def create_title_style(
    payload: TitleStyleWrite, session: Session = Depends(get_db)
) -> TitleStyleOut:
    style = TitleStyle(name=payload.name, **payload.look())
    session.add(style)
    session.commit()
    return _serialize_style(style)


@router.patch(
    f"{settings.api_prefix}/title-styles/{{style_id}}", response_model=TitleStyleOut
)
def update_title_style(
    style_id: str, payload: TitleStyleWrite, session: Session = Depends(get_db)
) -> TitleStyleOut:
    """Rename a saved Style, or overwrite the look it stores.

    Titles already made from it are untouched, because applying a Style copies
    it rather than binding it (ADR 0008).
    """
    if is_builtin(style_id):
        raise HTTPException(status_code=422, detail="Clip Farm's own styles cannot be edited")
    style = session.get(TitleStyle, style_id)
    if not style:
        raise HTTPException(status_code=404, detail="Title style not found")
    style.name = payload.name
    for field, value in payload.look().items():
        setattr(style, field, value)
    session.commit()
    return _serialize_style(style)


@router.delete(f"{settings.api_prefix}/title-styles/{{style_id}}", response_model=DeletionOut)
def delete_title_style(style_id: str, session: Session = Depends(get_db)) -> DeletionOut:
    if is_builtin(style_id):
        raise HTTPException(status_code=422, detail="Clip Farm's own styles cannot be deleted")
    style = session.get(TitleStyle, style_id)
    if not style:
        raise HTTPException(status_code=404, detail="Title style not found")
    # Every Title made from this keeps its look — that was copied when the Style
    # was applied — and loses only the label. The foreign key says the same
    # thing with ON DELETE SET NULL, but that is enforced by SQLite rather than
    # by the ORM, so it is done here too: a Title holding a dangling style id
    # would report a Style that no longer exists.
    for title in session.scalars(select(Title).where(Title.style_id == style.id)).all():
        title.style_id = None
    session.delete(style)
    session.commit()
    return DeletionOut(deleted=1)


@router.get(f"{settings.api_prefix}/phrases", response_model=list[PhraseOut])
def list_phrases(session: Session = Depends(get_db)) -> list[PhraseOut]:
    """Every saved Phrase, newest first.

    Newest first because the most recently added are the ones most likely
    wanted again, and a list only ever appended to would push them out of
    sight. Ordered by when each was added rather than when it was last touched,
    so re-saving a nudged Phrase leaves the panel where the eye left it.

    Global rather than per-Batch, for the same reason Styles are: writing the
    same words on the next Batch is the whole point of saving them.
    """
    phrases = session.scalars(select(Phrase).order_by(Phrase.created_at.desc())).all()
    return [PhraseOut.model_validate(phrase) for phrase in phrases]


@router.post(f"{settings.api_prefix}/phrases", response_model=PhraseOut, status_code=201)
def create_phrase(payload: PhraseWrite, session: Session = Depends(get_db)) -> PhraseOut:
    """Save words whole, with the look and the place they were written in.

    Saving the same words twice replaces the first rather than adding a second.
    An operator who nudges a Phrase and saves it again means "like this now",
    and two entries reading identically on the panel could not be told apart —
    the words are the label.
    """
    phrase = session.scalars(select(Phrase).where(Phrase.text == payload.text)).first()
    if not phrase:
        if len(session.scalars(select(Phrase)).all()) >= MAX_PHRASES:
            raise HTTPException(
                status_code=409, detail=f"Up to {MAX_PHRASES} phrases can be saved"
            )
        phrase = Phrase(text=payload.text)
        session.add(phrase)
    for field, value in payload.look().items():
        setattr(phrase, field, value)
    session.commit()
    return PhraseOut.model_validate(phrase)


@router.delete(f"{settings.api_prefix}/phrases/{{phrase_id}}", response_model=DeletionOut)
def delete_phrase(phrase_id: str, session: Session = Depends(get_db)) -> DeletionOut:
    """Forget a Phrase.

    Every Title written from it is untouched: applying a Phrase copies its
    words and its look onto the Title, exactly as applying a Style copies a
    look, so there is nothing here for a Title to lose (ADR 0008).
    """
    phrase = session.get(Phrase, phrase_id)
    if not phrase:
        raise HTTPException(status_code=404, detail="Phrase not found")
    session.delete(phrase)
    session.commit()
    return DeletionOut(deleted=1)


@router.get(f"{settings.api_prefix}/fonts", response_model=FontCatalogOut)
def get_font_catalog() -> FontCatalogOut:
    """Every vendored face, and where the browser can fetch it.

    The browser loads the same files the renderer opens, so a Title looks on
    the stage the way it will be burned in (ADR 0008).
    """
    data = fonts.catalog()
    return FontCatalogOut(
        families=[FontFamilyOut(**family) for family in data["families"]],
        faces=[
            FontFaceOut(
                id=face["id"],
                family=face["family"],
                weight=face["weight"],
                weight_label=face["weight_label"],
                file=face["file"],
                url=f"{settings.api_prefix}/fonts/{face['file']}",
            )
            for face in data["faces"]
        ],
    )


@router.get(f"{settings.api_prefix}/fonts/{{file_name}}")
def get_font_file(file_name: str) -> FileResponse:
    """Serve one vendored face.

    The name is checked against the catalog rather than sanitised as a path.
    Only files this build actually vendored can be named, so there is no
    traversal to reason about — a rule about what exists rather than a rule
    about what the string looks like.
    """
    if file_name not in {face["file"] for face in fonts.catalog()["faces"]}:
        raise HTTPException(status_code=404, detail="Font not found")
    return FileResponse(
        fonts.FONTS_DIR / file_name,
        media_type="font/ttf",
        # The faces are immutable: a change to one is a new file from the
        # vendoring script, never an edit in place.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
