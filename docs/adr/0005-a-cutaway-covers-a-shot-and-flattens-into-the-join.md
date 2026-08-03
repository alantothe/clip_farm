# A Cutaway covers a Shot, and flattens into the join

Builds on [ADR 0004](0004-a-sequence-is-edited-on-a-proportional-timeline.md).
Leaves [ADR 0003](0003-a-sequence-renders-a-batch-into-one-video.md)'s render pipeline standing,
which is the whole point of the shape chosen here.

A Sequence could only cut between Clips. The edit it could not express is the most ordinary one
in the craft: covering a stretch of someone talking with something else, while they keep talking.
A **Cutaway** is a Shot that covers another for a span, showing its picture while the covered
Shot — its **Base Shot** — keeps supplying the sound.

## A Cutaway is a Shot with a parent, not a second table

`shots` gains `parent_shot_id` and `offset_ms`, both nullable. A Shot with a parent is a Cutaway;
a Shot without one is in the Sequence. That is the whole model change.

The alternative was a `cutaways` table of its own, which would have left `shots` untouched. It
was not worth two near-identical tables and two sets of endpoints for rows that share every
field that matters — a Clip, a Trim, and a place. `Shot.span()` already answers "what does this
play" for both, and a Cutaway needed nothing added to it.

Both columns are additive, so `init_db`'s `ALTER TABLE ADD COLUMN` path carries an existing
database across. SQLite only accepts a `REFERENCES` column through `ADD COLUMN` when it defaults
to NULL, which a Shot that is not a Cutaway does anyway — the same constraint ADR 0002 worked
within for `projects.batch_id`.

**This consumes a property ADR 0004 relied on.** That ADR justified rebuilding `shots` in place
partly because nothing declared a foreign key to `shots.id`. `parent_shot_id` now does, pointing
at the same table. The rebuild has already run, so nothing is retroactively unsafe, but a future
non-additive change to `shots` no longer has that argument available and would have to handle
the self-reference.

## A Cutaway is anchored to its Base Shot, not to the clock

`offset_ms` is measured into the Base Shot, not from the start of the Sequence. Reordering the
Sequence therefore carries a Cutaway along with the moment it was placed over, which is what
"cover this bit of this sentence" means. Absolute time would leave it sitting over whatever
happened to land at that clock position after a reorder — the surprise real editors solve with
linked clips.

The anchor is also what lets base positions stay ordinal. A second track normally forces every
Shot onto a start time, which would have deleted `position`, `renumber_shots`, and the ordering
API that ADR 0004 deliberately left untouched. Anchoring keeps all of it.

Two rules fall out and are enforced when a Cutaway is placed or moved: a Cutaway cannot cover a
Cutaway, and two Cutaways cannot overlap on the same Base Shot. Both would make "what is on
screen here" ambiguous, and the second would make the flattening below ill-defined.

A Base Shot trimmed shorter than the Cutaway sitting on it is **not** an error. Trimming happens
on a different part of the screen from the Cutaway that it shortens, and refusing the trim would
be the wrong end to complain at. The Cutaway is clipped to whatever of the Base Shot remains,
and one left entirely past the end simply does not render.

## Covering flattens back into a concatenation

ADR 0003 measured the join carefully: PCM intermediates, `-c:v copy`, and video never encoded
twice. Compositing two tracks with a filter graph would have thrown that away and re-encoded
every covered span.

It is not needed. A Cutaway covers the *whole* frame, so a Base Shot with a Cutaway on it is
just three shorter stretches in a row — base, cutaway, base — and the Sequence is still a
concatenation. `plan_segments` does that flattening, walking a Base Shot's span and cutting it
at each Cutaway's edges. `join_shots` and everything ADR 0003 established are untouched.

The covered stretch is the only piece that needs more than `render_vertical`: its picture comes
from the Cutaway and its sound from the Base Shot. Since `render_vertical` maps the Source
Video's audio straight through under `-ss`/`-t`, the Base Shot's audio for that stretch is just
its Source Video at the same offsets — so the segment is the Cutaway's render muxed against it
with `-c:v copy`. No compositing, no second video encode.

A Base Shot with no audio at all leaves the covered stretch silent rather than failing, and
`normalize_for_join` generates the silence, exactly as it already does for a Shot with no audio.

## A Cutaway does not burn in its own Subtitles

A Clip's Subtitles are transcribed from its own audio. Under a Cutaway that audio is not playing
— the Base Shot's is. Burning them in would put text on screen for words nobody can hear, timed
to a soundtrack that was replaced.

So a Cutaway renders with Subtitles off, whatever its Clip's own setting says. Overlays are kept:
an image placed on a Clip is a visual decision and does not claim to transcribe anything. This is
the first time a Clip's own edit settings are overridden by where it sits, which is worth naming
— ADR 0002's "a Batch holds no edit settings of its own" is about the Batch, and this is about
one Shot's context, but it is the same principle bending and should not bend further without a
reason as concrete as this one.
