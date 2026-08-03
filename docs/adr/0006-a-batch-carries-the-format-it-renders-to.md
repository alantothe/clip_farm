# A Batch carries the Format it renders to

Finishes the half of [ADR 0001](0001-origin-kind-and-format-replace-mode.md) that was never
built, and moves what it built it on: Format lands on the **Batch**, not the Clip.

ADR 0001 said a Clip "carries Origin Kind and Format independently". Only `origin_kind`
shipped. There was no `format` column anywhere, and `1080x1920` was written by hand in eight
places across `media.py` and `tasks.py`. Nothing was choosing an output shape, because there
was nothing to choose it with.

## The Format belongs to the Batch

A Sequence joins its Shots into one file. Two Clips of different shapes in one Sequence has no
answer that is not an invention — reject the export, letterbox one of them, or let the Batch
override the Clips anyway. The last of those is the honest one, so the Batch holds the Format
outright and the question never arises.

This contradicts ADR 0001's placement, and the sentence in `CONTEXT.md` saying a Batch holds
no edit settings of its own. Both are amended rather than worked around. The defence is that a
Format is not an edit: a Trim, a Layout and a Subtitle change what a Clip *looks like*, and
each Clip still owns all three. A Format is the shape of the file that comes out the far end,
and only the thing that produces the file can own that.

`projects` is left alone. A Clip outside any Batch — everything Mode 01 makes — still has no
Format, and still renders 1080x1920 because that is all the renderer does. Adding a column
that is always `'vertical'`, that nothing writes and nothing reads, would buy a tick against
ADR 0001 and nothing else.

## A Format names a shape, not a platform

The stored value is `'vertical'`. It is not `'instagram_vertical'`.

Instagram is a **Platform**, and there is already a `platform_accounts` table and a
`publications` table where a Platform lives. Folding it into the Format would mean a second
Format the day TikTok wants an identical 1080x1920 file, and a third for YouTube Shorts, and
the renderer stripping the platform back off to find the shape — which is `x-to-vertical`, the
compound name ADR 0001 deleted, rebuilt in a new column.

The creation dialog still *reads* "Instagram · Reels", because that is what the operator is
actually thinking about. `apps/web/src/formats/registry.ts` holds that copy. It is a signpost,
kept firmly out of the stored value.

## It is chosen once, in a dialog, and never changed

`New batch` was one click that created a Batch immediately. It now opens a dialog with a name
field and a card per Format.

There is one card. That is deliberate: the choice is real and it is permanent, and a Batch
that turns out to be the wrong shape after an import costs more than a click. The Mode Library
already asks this way — a card you pick before you start — and this is the same question one
level down.

`BatchUpdate` has no `format` field, so the API cannot change one. With a single Format there
is nothing to change it *to*, and any code path for doing so would be unexercised and rot. It
becomes a real question when a second Format exists, together with what should happen to a
Sequence Render frozen under the old one — and that is the ADR that should answer it.

## The column is additive, so `shots` keeps its exception

`batches.format VARCHAR NOT NULL DEFAULT 'vertical'`, added through the `init_db` patch list
in `database.py` exactly as `origin_kind` was.

This matters because [ADR 0005](0005-a-cutaway-covers-a-shot-and-flattens-into-the-join.md)
noted that ADR 0004 had spent the argument for rebuilding a table. Nothing here needs
rebuilding: SQLite takes `ADD COLUMN` with `NOT NULL DEFAULT` directly, and every Batch that
predates this rendered 1080x1920, so `'vertical'` is a true backfill rather than a guess.

`migrations/versions/0014_batch_format.py` is written for correctness alongside the others,
and like the others it never runs.
