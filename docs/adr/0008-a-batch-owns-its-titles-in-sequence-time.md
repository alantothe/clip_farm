# A Batch owns its Titles, in Sequence time

Adds a **Title** — authored text burned over the picture — a **Title Style**, the saved
look a Title is made from, and a **Phrase**, the same saving with the words kept. Amends the sentence in `CONTEXT.md`, and in
[ADR 0002](0002-batches-group-clips-for-parallel-work.md), saying a Batch holds no edit
settings of its own. [ADR 0006](0006-a-batch-carries-the-format-it-renders-to.md) already bent
that line for Format on the grounds that a Format is an output target rather than an edit.
This does not have that defence. A Title is an edit, it is burned into the picture, and it
belongs to the Batch anyway.

## Why the Batch and not the Clip

The text is about the finished video, not about any one Clip in it. "Wait for it" over the
first three seconds is a claim about the reel's opening, and the reel's opening is a property
of the Sequence — whichever Shot happens to be sitting there.

Hanging it off a Clip breaks in both directions. A Clip can be placed twice (ADR 0004), so a
Title on the Clip would render twice, at both placements, when the operator wrote it once for
one moment. And a Clip can sit in a Batch without being in its Sequence, so a Title could
exist on nothing — text with no time, waiting for a Shot that may never be placed.

Subtitles are the counter-example that proves the split: they transcribe a particular Clip's
audio, so they belong to that Clip and follow it wherever it is placed, twice included. A
Title transcribes nothing.

## Sequence time, not anchored to a Shot

A Cutaway is anchored to the Shot it covers, at an offset into it, so reordering carries it
along (ADR 0005). A Title deliberately is not: it sits at an absolute span of the finished
video and stays there when Shots move under it.

The two are not inconsistent, because they are about different things. A Cutaway replaces a
specific moment's *picture* — it is a statement about that Shot's content, and would be
meaningless a cut away from it. A Title is a statement about the video's pacing: the hook goes
at the top, the call to action goes at the end, and neither cares which Shot is underneath.
Anchoring it to a Shot would mean reordering the Sequence silently moved the hook into the
middle.

The cost is real and is accepted: reorder the Sequence and the Shots slide under a Title while
the Title stays put. That is what a text track does in every editor an operator will have used
before this one, and it is the behaviour that was asked for.

## A Title crossing a cut is sliced, not composited

`plan_sequence` flattens a Sequence into segments that are rendered separately and
concatenated (ADR 0003, ADR 0005). A Title in Sequence time does not respect those boundaries
— a four-second hook over one-second Shots crosses three cuts.

So `Segment` gains `sequence_start_ms`, and each Title is sliced into the segments it crosses,
with its times rebased onto each one. Nothing about the join changes, and no compositing pass
over the finished video is added.

The seam is invisible because every piece is drawn by the same libass, at the same
`PlayResX`/`PlayResY`, with the same absolute `\pos` in the same units. Both sides of a cut
put identical glyphs on identical pixels; only the video behind them changes. A second pass
that drew Titles over the joined file would be the obvious alternative, and would cost a full
re-encode of the whole Sequence to avoid a problem that arithmetic already solves.

## A Phrase is the same saving, with the words kept

A Title Style deliberately drops the words, which is right when the next Title
says something else and wrong when it says the same thing. A sign-off, a
location card, a call to action — these get typed, sized and placed once and
then wanted verbatim on every Batch after. So a **Phrase** is a Title saved
whole: its words together with the same look and placement a Style stores.

It is a separate table rather than an optional `text` column on `title_styles`,
because the two are applied by different gestures. A Style restyles the Title in
front of you; a Phrase rewrites it. Sharing a row would put both behind the same
swatch grid, where clicking a look would sometimes overwrite the sentence just
typed — a control whose effect depends on which entry it is is not one control.

A Phrase has no name. The words are the label, and a name that was not the words
would be a second thing to keep in step with the first. Saving words that are
already saved therefore rewrites that Phrase rather than adding a second reading
identically, which is also what an operator who nudged one and saved it again
meant.

It has no timing either. A Style leaves a Title's span alone and so does a
Phrase: where text sits in a Sequence and how long it runs are facts about that
Sequence, and the block was dragged there on purpose. What is saved is what
survives being carried to a Batch that does not exist yet.

Applying one copies, exactly as applying a Style does, for the same reason and
with the same consequence: forgetting a Phrase leaves every Title written from
it untouched. Unlike a Style it does not even leave a label behind — nothing
records which Phrase a Title came from, because the words already say.

## The fonts are vendored, and each face is named uniquely

`tools/vendor_fonts.py` commits 60 static faces across 27 families into `apps/api/fonts/`,
and `ass=...:fontsdir=` points libass at them. They are committed rather than fetched because
the worker renders offline, and because a webfont that fails to load falls back silently — the
operator would see their font on the stage and get DejaVu Sans in the export, with nothing in
the logs to say so.

Every vendored face is renamed at vendoring time to a name unique to its file: `Lato Black`,
not `Lato` at weight 900. libass matches faces by name and has a bold boolean, not a weight
axis, so a family name shared across weights is a family name that cannot address them.
Upstream cannot be relied on here: `Lato-Black.ttf` and `Lato-Regular.ttf` both declare the
family "Lato" with subfamily "Regular", keeping the real weight only in the typographic name
records libass does not read. Left as they came, asking for Black would have returned whichever
file was indexed first. `catalog.json` records the name that is actually inside each file, so
the renderer never infers it.

The browser registers the same files under `FontFace` names derived from the same catalog, so
the stage and the export load the same bytes.

## What is exact, and what is not

Position, size, rotation, colour, outline, shadow and letter spacing are exact: both sides
work in percentages of the same 1080x1920 canvas, and the arithmetic is shared.

Line wrapping is not. The stage wraps with the browser's line breaker inside a box of the
Title's width; the export wraps with libass's inside the same box, set through the event's
left and right margins. The same font at the same size in the same box agrees almost always
and can differ by a word at the edge. A Title carries its own explicit line breaks, which is
the escape hatch when it matters, and pre-measuring the wrap server-side with the vendored
metrics is the fix if it turns out to matter often.

Italic is synthesised on both sides rather than vendored — libass obliques a face when no
italic file exists, and so does every browser — which keeps 27 more files out of the repo at
the cost of the two synthesised slants not being pixel-identical.

## A Title Style is a template, not a link

Applying a Title Style copies its values onto the Title. It does not bind them. Editing a
Style afterwards leaves every Title already made from it alone.

The alternative — a live link, so fixing a Style fixes every Title using it — is the more
powerful feature and the wrong default here. Styles are shared across every Batch, so a live
link means adjusting a colour while working on today's reel silently restyles a Batch from
last month that the operator considered finished. A Title records the Style it came from for
its label, and nothing more.

The built-in Styles are code, not seeded rows. They can then be improved in a release without
a data migration, and there is no bootstrap path that has to write to the database on startup
— which matters because `create_all`, not Alembic, is what actually builds a database here
(ADR 0002).
