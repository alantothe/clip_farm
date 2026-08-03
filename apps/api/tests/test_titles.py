"""Titles: text a Batch draws over its Sequence, and what they are saved as.

A Title is timed against the Sequence rather than against any Shot, so the
interesting cases are the ones where those two disagree — a Title that crosses a
cut, one that starts before the segment playing it, one written past the end
(ADR 0008).

The two savings are here as well: a Style, which keeps the look and drops the
words, and a Phrase, which keeps both. Neither binds — applying one copies.
"""

from types import SimpleNamespace

import pysubs2
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Batch, Phrase, Project, Shot, Title, TitleStyle
from app.routers import titles as titles_router
from app.schemas import PhraseWrite, TitleCreate, TitleStyleWrite, TitleUpdate
from app.services import fonts
from app.services.media import create_ass_titles
from app.services.sequence import plan_sequence
from app.services.titles import BUILTIN_STYLES, apply_style, look_of, titles_in_span


def make_session(tmp_path) -> Session:
    """A session built the way the app builds its own.

    `expire_on_commit=False` is the part that matters, and is easy to leave off:
    with the default, every commit expires the identity map and a stale
    relationship reloads by accident, hiding a response that was serialized from
    one. The app does not do that, so neither does this.
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    return Session(engine, expire_on_commit=False)


def make_batch(session: Session) -> Batch:
    batch = Batch(name="Monday")
    session.add(batch)
    session.commit()
    return batch


def make_title(**overrides) -> SimpleNamespace:
    """A Title's fields without a database, for the drawing tests."""
    values = {
        "text": "HELLO",
        "start_ms": 0,
        "end_ms": 2000,
        "font_family": "anton",
        "font_weight": 400,
        "italic": False,
        "uppercase": False,
        "font_size_percent": 6.0,
        "letter_spacing": 0.0,
        "color": "#FFFFFF",
        "opacity": 1.0,
        "align": "center",
        "outline_color": "#000000",
        "outline_width": 0.08,
        "shadow_color": "#000000",
        "shadow_offset": 0.0,
        "background": "none",
        "background_color": "#000000",
        "background_opacity": 0.7,
        "background_padding": 0.25,
        "center_x": 50.0,
        "center_y": 30.0,
        "width_percent": 80.0,
        "rotation_deg": 0.0,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


# --- Writing Titles onto a Batch ----------------------------------------


def test_a_title_is_written_at_a_span_of_sequence_time(tmp_path):
    session = make_session(tmp_path)
    batch = make_batch(session)

    out = titles_router.add_title(
        batch.id, TitleCreate(text="WAIT FOR IT", start_ms=500, end_ms=3500), session
    )

    assert [(title.text, title.start_ms, title.end_ms) for title in out.titles] == [
        ("WAIT FOR IT", 500, 3500)
    ]


def test_the_response_that_confirms_a_title_contains_it(tmp_path):
    """The Batch is serialized after the write, and must have seen it.

    `SessionLocal` keeps objects alive across a commit, so a relationship read
    before the insert stays read after it. Serializing from one returned a Batch
    with no Titles in it, and the web then drew an empty track over a Title that
    existed.
    """
    session = make_session(tmp_path)
    batch = make_batch(session)
    # Load the collection first, exactly as the cap check used to.
    assert batch.titles == []

    out = titles_router.add_title(batch.id, TitleCreate(text="fresh"), session)

    assert [title.text for title in out.titles] == ["fresh"]


def test_removing_a_title_leaves_it_out_of_the_response(tmp_path):
    session = make_session(tmp_path)
    batch = make_batch(session)
    first = titles_router.add_title(batch.id, TitleCreate(text="one"), session).titles[0]
    titles_router.add_title(batch.id, TitleCreate(text="two"), session)

    out = titles_router.remove_title(batch.id, first.id, session)

    assert [title.text for title in out.titles] == ["two"]


def test_a_batch_holds_three_titles_at_once(tmp_path):
    session = make_session(tmp_path)
    batch = make_batch(session)

    titles_router.add_title(batch.id, TitleCreate(text="one", start_ms=0, end_ms=4000), session)
    titles_router.add_title(
        batch.id, TitleCreate(text="two", start_ms=2000, end_ms=6000), session
    )
    out = titles_router.add_title(
        batch.id, TitleCreate(text="three", start_ms=3000, end_ms=5000), session
    )

    assert [title.text for title in out.titles] == ["one", "two", "three"]


def test_a_fourth_simultaneous_title_is_rejected(tmp_path):
    session = make_session(tmp_path)
    batch = make_batch(session)
    for text in ("one", "two", "three"):
        titles_router.add_title(
            batch.id, TitleCreate(text=text, start_ms=0, end_ms=4000), session
        )

    with pytest.raises(HTTPException) as caught:
        titles_router.add_title(
            batch.id, TitleCreate(text="four", start_ms=1000, end_ms=2000), session
        )

    assert caught.value.status_code == 409
    assert caught.value.detail == "Up to 3 text slots can play at once"


def test_touching_titles_reuse_a_text_slot(tmp_path):
    session = make_session(tmp_path)
    batch = make_batch(session)
    for text in ("one", "two", "three"):
        titles_router.add_title(
            batch.id, TitleCreate(text=text, start_ms=0, end_ms=1000), session
        )

    out = titles_router.add_title(
        batch.id, TitleCreate(text="next", start_ms=1000, end_ms=2000), session
    )

    assert [title.text for title in out.titles] == ["one", "two", "three", "next"]


def test_retiming_cannot_create_a_fourth_simultaneous_title(tmp_path):
    session = make_session(tmp_path)
    batch = make_batch(session)
    for text in ("one", "two", "three"):
        titles_router.add_title(
            batch.id, TitleCreate(text=text, start_ms=0, end_ms=4000), session
        )
    later = titles_router.add_title(
        batch.id, TitleCreate(text="later", start_ms=4000, end_ms=6000), session
    ).titles[-1]

    with pytest.raises(HTTPException) as caught:
        titles_router.update_title(
            batch.id, later.id, TitleUpdate(start_ms=1000, end_ms=2000), session
        )

    assert caught.value.status_code == 409


def test_a_title_cannot_end_before_it_starts(tmp_path):
    session = make_session(tmp_path)
    batch = make_batch(session)
    out = titles_router.add_title(batch.id, TitleCreate(start_ms=0, end_ms=1000), session)
    title_id = out.titles[0].id

    with pytest.raises(HTTPException) as caught:
        titles_router.update_title(
            batch.id, title_id, TitleUpdate(start_ms=5000, end_ms=6000).model_copy(
                update={"end_ms": 100}
            ), session
        )
    assert caught.value.status_code == 422


def test_a_title_belongs_to_its_batch(tmp_path):
    session = make_session(tmp_path)
    mine, theirs = make_batch(session), make_batch(session)
    out = titles_router.add_title(mine.id, TitleCreate(text="mine"), session)

    with pytest.raises(HTTPException) as caught:
        titles_router.update_title(theirs.id, out.titles[0].id, TitleUpdate(text="x"), session)
    assert caught.value.status_code == 404


def test_deleting_a_batch_takes_its_titles(tmp_path):
    session = make_session(tmp_path)
    batch = make_batch(session)
    titles_router.add_title(batch.id, TitleCreate(text="gone"), session)

    session.delete(batch)
    session.commit()

    assert session.query(Title).count() == 0


# --- Styles are copied, never linked (ADR 0008) --------------------------


def test_applying_a_style_copies_its_look(tmp_path):
    session = make_session(tmp_path)
    batch = make_batch(session)

    out = titles_router.add_title(
        batch.id, TitleCreate(text="hook", style_id="builtin:hook"), session
    )

    title = out.titles[0]
    assert title.font_family == "anton"
    assert title.uppercase is True
    # A built-in leaves no id behind: there is no row for it to point at.
    assert title.style_id is None


def test_a_field_sent_beside_a_style_wins_over_it(tmp_path):
    session = make_session(tmp_path)
    batch = make_batch(session)

    out = titles_router.add_title(
        batch.id,
        TitleCreate(text="hook", style_id="builtin:hook", font_family="pacifico"),
        session,
    )

    assert out.titles[0].font_family == "pacifico"
    # Everything the Style set and the request did not still lands.
    assert out.titles[0].uppercase is True


def test_editing_a_style_leaves_titles_already_made_from_it_alone(tmp_path):
    session = make_session(tmp_path)
    batch = make_batch(session)
    saved = titles_router.create_title_style(
        TitleStyleWrite(name="Mine", color="#FFE500"), session
    )
    out = titles_router.add_title(batch.id, TitleCreate(text="a", style_id=saved.id), session)
    assert out.titles[0].color == "#FFE500"

    titles_router.update_title_style(
        saved.id, TitleStyleWrite(name="Mine", color="#FF0000"), session
    )

    # The look was copied when it was applied, so the Title is untouched.
    session.expire_all()
    assert session.get(Title, out.titles[0].id).color == "#FFE500"


def test_deleting_a_style_leaves_the_title_looking_the_same(tmp_path):
    session = make_session(tmp_path)
    batch = make_batch(session)
    saved = titles_router.create_title_style(
        TitleStyleWrite(name="Mine", color="#FFE500"), session
    )
    out = titles_router.add_title(batch.id, TitleCreate(text="a", style_id=saved.id), session)

    titles_router.delete_title_style(saved.id, session)

    session.expire_all()
    title = session.get(Title, out.titles[0].id)
    assert title.color == "#FFE500"
    # Only the label it carried is gone.
    assert title.style_id is None


def test_clip_farms_own_styles_cannot_be_edited_or_deleted(tmp_path):
    session = make_session(tmp_path)

    for call in (
        lambda: titles_router.update_title_style(
            "builtin:hook", TitleStyleWrite(name="x"), session
        ),
        lambda: titles_router.delete_title_style("builtin:hook", session),
    ):
        with pytest.raises(HTTPException) as caught:
            call()
        assert caught.value.status_code == 422


def test_the_style_list_offers_the_builtins_and_the_saved_ones(tmp_path):
    session = make_session(tmp_path)
    titles_router.create_title_style(TitleStyleWrite(name="Mine"), session)

    listed = titles_router.list_title_styles(session)

    assert [style.builtin for style in listed] == [True] * len(BUILTIN_STYLES) + [False]
    assert listed[-1].name == "Mine"


def test_a_builtin_style_names_only_what_it_changes(tmp_path):
    """The gaps come from the column defaults, not a second copy of them."""
    look = look_of(BUILTIN_STYLES[0])

    assert look["font_family"] == "anton"
    # Never named by the Hook style, so it is the model's own default.
    assert look["center_x"] == 50.0
    assert set(look) == set(look_of(TitleStyle(name="empty")))


def test_apply_style_copies_every_look_field(tmp_path):
    session = make_session(tmp_path)
    source = TitleStyle(name="Loud", font_family="bangers", rotation_deg=12.0, opacity=0.5)
    title = Title(batch_id="b")

    apply_style(title, source)

    assert (title.font_family, title.rotation_deg, title.opacity) == ("bangers", 12.0, 0.5)


# --- Phrases: the same saving, with the words kept -----------------------


def test_a_phrase_saves_the_words_along_with_the_look(tmp_path):
    session = make_session(tmp_path)

    saved = titles_router.create_phrase(
        PhraseWrite(text="Lima Peru — The North Side", font_size_percent=7.5, center_y=26.0),
        session,
    )

    assert saved.text == "Lima Peru — The North Side"
    assert (saved.font_size_percent, saved.center_y) == (7.5, 26.0)
    # A Phrase has no timing: where it lands is a fact about the Sequence.
    assert not hasattr(saved, "start_ms")


def test_saving_the_same_words_twice_rewrites_the_first(tmp_path):
    """The words are the label, so two reading the same could not be told apart."""
    session = make_session(tmp_path)
    first = titles_router.create_phrase(PhraseWrite(text="Wait for it", center_y=20.0), session)

    second = titles_router.create_phrase(PhraseWrite(text="Wait for it", center_y=80.0), session)

    assert second.id == first.id
    assert second.center_y == 80.0
    assert len(titles_router.list_phrases(session)) == 1


def test_phrases_are_listed_newest_first(tmp_path):
    session = make_session(tmp_path)
    for words in ("first", "second", "third"):
        titles_router.create_phrase(PhraseWrite(text=words), session)

    assert [phrase.text for phrase in titles_router.list_phrases(session)] == [
        "third",
        "second",
        "first",
    ]


def test_forgetting_a_phrase_leaves_the_title_written_from_it_alone(tmp_path):
    """Applying a Phrase copies it, exactly as applying a Style does."""
    session = make_session(tmp_path)
    batch = make_batch(session)
    saved = titles_router.create_phrase(PhraseWrite(text="Sign off", color="#FFE500"), session)
    out = titles_router.add_title(
        batch.id, TitleCreate(text=saved.text, color=saved.color), session
    )

    titles_router.delete_phrase(saved.id, session)

    session.expire_all()
    title = session.get(Title, out.titles[0].id)
    assert (title.text, title.color) == ("Sign off", "#FFE500")


def test_a_phrase_cannot_be_saved_without_words(tmp_path):
    with pytest.raises(ValidationError):
        PhraseWrite(text="   ")


def test_forgetting_a_phrase_that_is_not_there_is_a_404(tmp_path):
    session = make_session(tmp_path)

    with pytest.raises(HTTPException) as caught:
        titles_router.delete_phrase("nope", session)
    assert caught.value.status_code == 404


def test_a_phrase_carries_every_look_field_a_style_does(tmp_path):
    """Anything a Style can describe, a Phrase can too — the mixin is shared."""
    assert set(look_of(Phrase(text="x"))) == set(look_of(TitleStyle(name="x")))


# --- Slicing a Title into the segments it crosses ------------------------


def test_a_segment_knows_where_it_starts_in_the_sequence(tmp_path):
    session = make_session(tmp_path)
    batch = make_batch(session)
    for index in range(3):
        clip = Project(id=f"clip-{index}", trim_start_ms=0, trim_end_ms=2000, duration_ms=2000)
        session.add(clip)
        session.add(Shot(batch_id=batch.id, project_id=clip.id, position=index))
    session.commit()

    segments = plan_sequence(sorted(batch.shots, key=lambda shot: shot.position))

    assert [segment.sequence_start_ms for segment in segments] == [0, 2000, 4000]


def test_a_title_crossing_a_cut_is_sliced_into_both_segments():
    title = make_title(start_ms=1500, end_ms=4500)

    first = titles_in_span([title], 0, 2000)
    second = titles_in_span([title], 2000, 2000)
    third = titles_in_span([title], 4000, 2000)

    # Rebased onto each segment, and clamped to it.
    assert [(start, end) for _, start, end in first] == [(1500, 2000)]
    assert [(start, end) for _, start, end in second] == [(0, 2000)]
    assert [(start, end) for _, start, end in third] == [(0, 500)]


def test_a_title_outside_a_segment_is_not_in_it():
    title = make_title(start_ms=5000, end_ms=6000)

    assert titles_in_span([title], 0, 2000) == []


def test_a_title_ending_exactly_where_a_segment_begins_is_not_in_it():
    """Touching is not overlapping, the rule Cutaways already follow."""
    assert titles_in_span([make_title(start_ms=0, end_ms=2000)], 2000, 2000) == []


def test_a_title_with_no_words_draws_nothing():
    assert titles_in_span([make_title(text="   ")], 0, 5000) == []


# --- Drawing a Title -----------------------------------------------------


def read_ass(path):
    return pysubs2.load(str(path))


def test_a_title_is_drawn_at_its_place_on_the_canvas(tmp_path):
    output = tmp_path / "titles.ass"

    assert create_ass_titles(
        titles=[(make_title(center_x=25.0, center_y=80.0), 0, 2000)], output=output
    )

    subtitles = read_ass(output)
    assert subtitles.info["PlayResX"] == "1080"
    assert subtitles.info["PlayResY"] == "1920"
    # 25% of 1080 and 80% of 1920, anchored at the text's middle.
    assert r"\an5\pos(270,1536)" in subtitles.events[0].text


def test_the_wrap_box_becomes_the_events_margins(tmp_path):
    """`width_percent` is what libass wraps inside, as the stage's box is."""
    output = tmp_path / "titles.ass"
    create_ass_titles(
        titles=[(make_title(center_x=50.0, width_percent=50.0), 0, 1000)], output=output
    )

    event = read_ass(output).events[0]
    assert (event.marginl, event.marginr) == (270, 270)


def test_alignment_moves_the_anchor_so_the_box_stays_put(tmp_path):
    output = tmp_path / "titles.ass"
    create_ass_titles(
        titles=[
            (make_title(align="left", center_x=50.0, width_percent=80.0), 0, 1000),
            (make_title(align="right", center_x=50.0, width_percent=80.0), 0, 1000),
        ],
        output=output,
    )

    events = read_ass(output).events
    # Pinned to the box's left edge, then to its right, rather than its middle.
    assert r"\an4\pos(108," in events[0].text
    assert r"\an6\pos(972," in events[1].text


def test_rotation_is_negated_because_ass_turns_the_other_way(tmp_path):
    output = tmp_path / "titles.ass"
    create_ass_titles(titles=[(make_title(rotation_deg=12.0), 0, 1000)], output=output)

    assert r"\frz-12.00" in read_ass(output).events[0].text


def test_braces_in_the_text_are_escaped_rather_than_parsed(tmp_path):
    """`{...}` opens an override block, so an unescaped Title would vanish."""
    output = tmp_path / "titles.ass"
    create_ass_titles(titles=[(make_title(text="{sponsored}"), 0, 1000)], output=output)

    text = read_ass(output).events[0].text
    assert r"\{sponsored\}" in text


def test_uppercase_is_applied_to_the_words_themselves(tmp_path):
    output = tmp_path / "titles.ass"
    create_ass_titles(titles=[(make_title(text="quiet", uppercase=True), 0, 1000)], output=output)

    assert read_ass(output).events[0].text.endswith("QUIET")


def test_line_breaks_survive_into_the_render(tmp_path):
    output = tmp_path / "titles.ass"
    create_ass_titles(titles=[(make_title(text="two\nlines"), 0, 1000)], output=output)

    assert read_ass(output).events[0].text.endswith(r"two\Nlines")


def test_sizes_that_scale_with_the_type_are_fractions_of_it(tmp_path):
    output = tmp_path / "titles.ass"
    create_ass_titles(
        titles=[
            (
                make_title(
                    font_size_percent=10.0, outline_width=0.1, shadow_offset=0.05,
                    letter_spacing=0.02,
                ),
                0,
                1000,
            )
        ],
        output=output,
    )

    style = read_ass(output).styles["Title0"]
    assert style.fontsize == pytest.approx(192.0)  # 10% of 1920
    assert style.outline == pytest.approx(19.2)  # a tenth of the font size
    assert style.shadow == pytest.approx(9.6)
    assert style.spacing == pytest.approx(3.84)


def test_a_panel_replaces_the_outline_rather_than_joining_it(tmp_path):
    """libass's BorderStyle is one control: an outline, or a box, never both."""
    output = tmp_path / "titles.ass"
    create_ass_titles(
        titles=[
            (
                make_title(
                    background="box", background_color="#FFE500", background_opacity=1.0,
                    background_padding=0.5, font_size_percent=10.0,
                ),
                0,
                1000,
            )
        ],
        output=output,
    )

    style = read_ass(output).styles["Title0"]
    assert style.borderstyle == 3
    assert (style.outlinecolor.r, style.outlinecolor.g, style.outlinecolor.b) == (255, 229, 0)
    # The padding, not an outline width.
    assert style.outline == pytest.approx(96.0)


def test_opacity_becomes_ass_transparency(tmp_path):
    """ASS stores transparency, inverted: 0 is opaque, not invisible."""
    output = tmp_path / "titles.ass"
    create_ass_titles(titles=[(make_title(opacity=0.5), 0, 1000)], output=output)

    assert read_ass(output).styles["Title0"].primarycolor.a == 128


def test_each_title_gets_a_style_of_its_own(tmp_path):
    output = tmp_path / "titles.ass"
    create_ass_titles(
        titles=[
            (make_title(font_family="anton", color="#FF0000"), 0, 1000),
            (make_title(font_family="pacifico", color="#00FF00"), 0, 1000),
        ],
        output=output,
    )

    # pysubs2 always carries a Default style of its own; only the Title ones
    # are this function's output.
    subtitles = read_ass(output)
    drawn = [style.fontname for name, style in subtitles.styles.items() if name.startswith("Title")]
    assert drawn == ["Anton", "Pacifico"]


def test_nothing_is_written_when_no_title_plays(tmp_path):
    output = tmp_path / "titles.ass"

    assert create_ass_titles(titles=[], output=output) is False
    assert not output.exists()


def test_the_worker_slices_a_title_across_the_cut_it_crosses(tmp_path, monkeypatch):
    """The whole point of Sequence time, seen from the export.

    Two Shots of two seconds each, and one Title running from 1.5s to 4.5s. It
    has to reach both segments, rebased onto each, or the text would blink out
    at the cut (ADR 0008).
    """
    from pathlib import Path

    from sqlalchemy.orm import sessionmaker

    from app import tasks
    from app.models import Artifact, SequenceRender

    engine = create_engine(f"sqlite:///{tmp_path / 'worker.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    source = tmp_path / "source.mp4"
    source.write_bytes(b"not really a video")
    with factory() as session:
        batch = Batch(name="Monday")
        session.add(batch)
        session.flush()
        for index in range(2):
            clip = Project(
                batch_id=batch.id, title=f"Clip {index}", status="ready",
                trim_start_ms=0, trim_end_ms=2000,
            )
            session.add(clip)
            session.flush()
            session.add(
                Artifact(
                    project_id=clip.id, kind="source", path=str(source), mime_type="video/mp4"
                )
            )
            session.add(Shot(batch_id=batch.id, project_id=clip.id, position=index))
        session.add(Title(batch_id=batch.id, text="CROSSES", start_ms=1500, end_ms=4500))
        sequence_render = SequenceRender(batch_id=batch.id, shot_count=2)
        session.add(sequence_render)
        session.commit()
        batch_id, render_id = batch.id, sequence_render.id

    drawn: list[list[tuple[str, int, int]]] = []

    def fake_render_vertical(**kwargs):
        drawn.append(
            [(title.text, start, end) for title, start, end in kwargs["titles"]]
        )
        Path(kwargs["output"]).write_bytes(b"rendered")

    monkeypatch.setattr(tasks, "SessionLocal", factory)
    monkeypatch.setattr(tasks, "settings", SimpleNamespace(batches_dir=tmp_path / "batches"))
    monkeypatch.setattr(tasks, "render_vertical", fake_render_vertical)
    monkeypatch.setattr(
        tasks, "join_shots", lambda **kwargs: Path(kwargs["output"]).write_bytes(b"joined")
    )
    monkeypatch.setattr(
        tasks, "inspect_media", lambda _path: {"width": 1080, "height": 1920, "duration_ms": 4000}
    )
    monkeypatch.setattr(tasks, "sha256_file", lambda _path: "checksum")

    tasks.render_sequence_task.call_local(batch_id, render_id)

    # The first segment carries its last half second, the second its first
    # two-and-a-half — each timed from its own start.
    assert drawn == [[("CROSSES", 1500, 2000)], [("CROSSES", 0, 2000)]]


# --- Reaching a font file ------------------------------------------------


def test_a_weight_resolves_to_the_one_file_that_is_it():
    """libass matches on a name and has no weight axis, so each file has its own."""
    regular = fonts.resolve_face("lato", 400)
    black = fonts.resolve_face("lato", 900)

    assert regular["face_name"] != black["face_name"]
    assert regular["file"] != black["file"]
    assert not regular["face_bold"] and not black["face_bold"]


def test_a_weight_a_family_lacks_falls_back_to_its_nearest():
    """Bebas Neue is a single face, and asking for Black must still draw."""
    assert fonts.resolve_face("bebas-neue", 900)["file"] == "BebasNeue-Regular.ttf"


def test_an_unknown_family_still_draws_something():
    """A Title written against a family later dropped should not fail an export."""
    assert fonts.resolve_face("gone-from-the-catalog", 700)["family"] == "inter"


def test_every_vendored_face_has_a_name_no_other_face_shares():
    """The collision this naming exists to prevent, guarded against a re-vendor."""
    faces = fonts.catalog()["faces"]
    names = [(face["face_name"], face["face_bold"]) for face in faces]

    assert len(set(names)) == len(names)


def test_every_face_in_the_catalog_is_on_disk():
    for face in fonts.catalog()["faces"]:
        assert fonts.face_path(face).is_file(), face["file"]


def test_a_font_file_outside_the_catalog_cannot_be_named():
    with pytest.raises(HTTPException) as caught:
        titles_router.get_font_file("../app/main.py")
    assert caught.value.status_code == 404
