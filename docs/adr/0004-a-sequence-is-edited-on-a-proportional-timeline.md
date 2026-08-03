# A Sequence is edited on a proportional timeline

Revises two clauses of [ADR 0003](0003-a-sequence-renders-a-batch-into-one-video.md).

What shipped in PRs #9–#13 was an ordering list: an "Add to timeline" button per grid card,
then move-earlier / move-later / remove buttons per row. Every Shot was the same size, so
nothing on screen said how long anything was, and the only edit available was order. The
operator asked for "a real video editor with basic tools that let me edit and move them
shuffle them"; that request was read as *minimal UI* when it meant *a real timeline editor,
just not a fancy one*.

The Timeline becomes duration-proportional: a pixels-per-second scale with a zoom control, a
time ruler, and a Shot drawn as wide as it is long. That one change is what makes the rest
coherent — a Shot's edges become grabbable, a playhead has something to travel across, and
the length of the finished video is visible rather than arithmetic.

ADR 0003 said "a Shot plays the span its Clip's own Trim defines" and "a Clip has at most one
Shot for now". Both are superseded here, and 0003 anticipated both — "the Shot row exists so
[per-Shot trim] can be added without reshaping anything."

## A Shot's Trim is a nullable override, not a copy

`shots` gains `trim_start_ms` and `trim_end_ms`, both nullable. Null means the Shot plays its
Clip's Trim; set means the Shot was trimmed on the Timeline and its Clip no longer moves it.
`Shot.span()` is the single place that rule lives, so the API and the worker cannot drift.

The alternative was copying the Clip's Trim onto the Shot at placement and letting them
diverge from then on. Nullable wins on two counts. It is additive, so `init_db`'s
`ALTER TABLE ADD COLUMN` path carries an existing database across unchanged. And a Shot that
is never trimmed on the Timeline keeps behaving exactly as it does today, which means the
change cannot regress a Sequence built before it.

The cost is that two controls now decide how long a Shot is. The per-Clip Trim control stays
— it owns the frame-accurate scrubber, and it is still the right place to trim a Clip that is
only ever used once. So each Shot says which one is winning, "follows Clip" or "trimmed
here", and offers a reset back to null. Editing a Clip's Trim moves its un-overridden Shots
and leaves its overridden ones alone.

## Dropping `uq_shots_project` is a table rebuild, and this time that is cheap

Per-Shot trim is what makes repeating a Clip useful: the same source at two different in/out
points is an ordinary edit, and until now `uq_shots_project` made it impossible.

Removing a UNIQUE constraint in SQLite means rebuilding the table, and per ADR 0002 nothing
runs Alembic — `init_db`'s additive `ALTER TABLE` list is the only upgrade path a real
database sees. ADR 0002 declined exactly this operation on `projects`, and ADR 0003 declined
it on `renders`. The reason both times was inbound foreign keys: rebuilding `projects` meant
dropping it while every Artifact, Render, and Job pointed at it under
`PRAGMA foreign_keys=ON`, on startup.

**Nothing points at `shots.id`.** No table in the schema declares a foreign key to it, so the
rebuild has no references to break — the risk that made the earlier rebuilds unacceptable is
absent here. `init_db` detects the old shape by looking for `uq_shots_project` in the table's
DDL in `sqlite_master`, then runs SQLite's documented rebuild recipe: `PRAGMA
foreign_keys=OFF`, create the new shape, copy the rows, drop, rename, recreate the two
indexes, `PRAGMA foreign_keys=ON`. A database created after this change never has the old
shape and is never touched.

This is deliberately a rebuild of one named table rather than general machinery for
reconciling any table against its model. There is one non-additive change to make, and a
generic version would be more code and more ways to be wrong for a second caller that does
not exist.

`Project.shot` becomes `Project.shots`.

## Positions stay ordinal, and Shots stay gapless

A proportional Timeline invites dragging a Shot into empty space, so it is worth being
explicit that it cannot: Shots always butt against each other, and dragging one inserts it
between others while everything after slides. `position` remains `0..n-1` and
`renumber_shots` is unchanged, which is why this ADR changes no ordering code at all.

A gap would have to render as black with silence, which means synthesizing filler segments in
`join_shots` for something nobody asked for in a vertical reel.

## The preview is an honest rough cut, not the finished video

There is no way to watch a Sequence without exporting it, and a playhead you cannot play is
not much of an editor. Playback chains `<video>` elements over the Clips' existing `preview`
Artifacts, switching source at Shot boundaries and seeking to each Shot's in-point.

Those previews are what `create_preview` produces: `scale='min(960,iw)':-2` of the Source
Video. They are **landscape, uncropped, and unsubtitled**. So the preview shows order,
timing, and where the cuts fall, and it is labelled as a rough cut, because it does not show
framing or Subtitles.

The accurate alternative is a low-resolution proxy render of the whole Sequence, and it is
not worth it. `smart_crop` is OpenCV reading frames one at a time through a face detector, so
a proxy costs minutes per build (ADR 0003 measures the same problem for exports), and it is
stale the moment a Shot moves. That makes it the export button with extra steps, and it
cannot be live while you drag — which is the entire point of a playhead.

Playing a Clip's most recent completed `Render` instead, where its settings still match,
would give real vertical framing and burned-in Subtitles. That is blocked by the same thing
ADR 0003 named: `Render` does not freeze Overlay geometry or edited Subtitle text, so
matching on the frozen fields alone serves a stale Shot. It becomes available when caching
does.

## Pointer events, not a drag-and-drop library

Four gestures move things: reorder a Shot, drag its edges to trim, scrub the playhead, and
drop a Clip from the grid onto the Timeline. Three of the four are continuous geometry that a
sortable library does not do, and a library's sortable assumes uniform swap semantics rather
than "insert at this time position", which is what a proportional track needs. Adding one
would buy reorder and leave two interaction systems in one component.

There is prior art to follow rather than invent: `ClipEditor` already drags, trims, and
scrubs image Overlays on a proportional strip — `beginTimelineInteraction(event, overlay,
'move' | 'trim-start' | 'trim-end')`, `setPointerCapture`, a pixel delta converted to
milliseconds and snapped to 100 ms, and a `timelineDragged` ref to tell a click from a drag.
`styles.css` already carries `.edit-timeline__ruler`, `.timeline-clip-handle--start/--end`,
and `.timeline-playhead`. The Sequence Timeline reuses that shape and that vocabulary. The
one real difference is that `ClipEditor`'s strip is fit-to-width over a single Clip and
converts with `/ width * duration`, while a zoomable, scrollable Sequence converts through a
pixels-per-second scale.

Gesture state is local for the duration of the gesture and committed on release, with an
optimistic cache update and a rollback on error. Nothing is sent while a finger is down. The
server stays the authority on order, as it is today.

Dragging is not reachable by keyboard, so the controls it replaces do not go away. "Add to
timeline" stays as an append shortcut, and selecting a Shot opens an inspector carrying
numeric in/out fields, move-earlier, move-later, reset, and remove. That is the keyboard
path, the way to edit a Shot too narrow to grab at low zoom, and the only way to type an
exact in-point — dragging cannot do the last of those at any zoom.

Removing a Shot is the one lossy gesture, since it discards a trim override that a re-drag
would not restore, so it offers an undo. A bad drag is visibly wrong and re-draggable, and a
bad trim has its reset, so neither needs one.
