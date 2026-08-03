# The Player shows the Format, and says where it is lying

Supersedes the "The preview is an honest rough cut, not the finished video" section of
[ADR 0004](0004-a-sequence-is-edited-on-a-proportional-timeline.md). Everything else in that
ADR stands. Depends on [ADR 0006](0006-a-batch-carries-the-format-it-renders-to.md), which is
what lets a Player know the shape it is meant to be showing.

ADR 0004 accepted a cheap preview and labelled it. That was the right trade at the time: a
proxy render costs minutes and is stale the moment a Shot moves. But the label was doing
heavy lifting, because the preview was a 132px square holding a landscape frame — about
132x74 of actual picture — and "framing and subtitles apply on export" was covering for the
fact that it showed almost nothing.

## Everything the caveat apologised for is already on the wire

`serialize_batch` sends each Clip's `captions`, `image_overlays`, `layout`, `crop_center_x`,
`caption_style`, `caption_position` and `fps`. The rough cut was not missing framing and
Subtitles because they were expensive. It was missing them because nothing drew them.

So they are drawn, with no API change and no render:

- **Framing** — the stage is the Batch's Format, and each Shot is fitted into it the way its
  Layout will fit it. `object-fit: cover` at the Clip's `crop_center_x` for a smart crop,
  `contain` over a blurred backdrop for a fit.
- **Subtitles** — the Clip's own CaptionSegments, in its `caption_style` at its
  `caption_position`, suppressed when `captions_enabled` is false.
- **Overlays** — at their stored centre, width, rotation and opacity, read-only. They are
  moved in the Clip's own editor, not on the Sequence.

## What is still not true, and is said where it applies

A **fit** is exact: the stage builds the same letterbox the export does.

A **smart crop** is not. `create_smart_crop_video` runs a face detector every few frames and
eases the crop centre toward what it finds, so the real crop moves through the Shot.
`crop_center_x` is only where that drift starts. CSS can hold a fixed centre and nothing more.

So the caveat survives, narrowed to the case it describes, and shown only while such a Shot
is on screen. A Sequence of fitted Shots now says nothing, because there is nothing to say.
A warning displayed unconditionally is a warning that stops being read, which is the failure
mode the old blanket line was heading for.

The Source view is the other half of the answer. It draws the whole frame at its own ratio
with the surviving slice outlined, so what the crop discards is visible rather than described.
A fitted Shot gets no outline: it discards nothing, and an outline would claim a loss that
does not happen.

## A Cutaway shows no Subtitles at all

Not the Cutaway's, and not the Base Shot's either.

`CONTEXT.md` says a Cutaway's own Subtitles are not burned in, because nobody hears the words
they transcribe. The reason the Base Shot's are not burned in either is less obvious, and
lives in `tasks.py`: a covered span renders as the *Cutaway's* picture with
`captions_enabled=clip.captions_enabled and not segment.is_covered`. The Clip supplying the
picture is the Cutaway's, and its captions are switched off — so the segment carries none.

Reasoning from the glossary alone gives the wrong answer here, and "subtitles follow the
sound" is a rule this codebase does not implement. Image Overlays have no such guard, so the
Cutaway's Clip's Overlays *do* burn in, and are shown.

## The Player is a Player, and there is one loop

`SequencePreview` became the **Player**, a UI term beside Timeline in `CONTEXT.md`, because
the name said "don't trust this" exactly as it became trustworthy.

Sequence loop, Shot loop and range loop are one mechanism: a **Review Range** and a loop
toggle. Looping a single Shot sets the Range's edges to that Shot's. A Review Range renders as
nothing and is explicitly not a Trim.

## What the tests can and cannot reach

jsdom implements no media element, so `setup.ts` stubs one — paused state, working play and
pause, and a writable `duration`. That is what makes the element swap, the Cutaway's muting,
speed surviving a cut, and the short-preview regression testable at all. Before it, the code
that held the one bug that reached a browser had no coverage.

Pointer dragging on the scrub bar still has none, for the reason ADR 0004 gave about the
Timeline: jsdom implements neither pointer capture nor layout, so `getBoundingClientRect`
returns zeroes. The keyboard path is covered instead, and the arithmetic is covered directly.

Fullscreen has none either — jsdom has no Fullscreen API. It expands the stage container and
not the `<video>`, because a bare `<video>` full-screened shows the raw landscape media with
none of the framing, Subtitles, Overlays, guides or badge that make this a preview.
