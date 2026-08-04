# A Batch publishes through a second target

Extends [ADR 0003](0003-a-sequence-renders-a-batch-into-one-video.md), which named this gap and
left it open: "`publications.render_id` points at `renders`, so a Sequence Render cannot be posted
through the existing Publisher seam without a second path. Nobody asked to publish a Batch."

Somebody asked. Exporting a Batch produced a file and stopped there, but the file is not the
deliverable — a Reel is a video *and* the Caption beside it. The stage after export is where that
gets written and sent.

## The Sequence Render gets its own publication table

The obvious move is one `publications` table with a nullable `render_id` and a new
`sequence_render_id`. In SQLite, relaxing `NOT NULL` means rebuilding the table, and nothing here
runs Alembic against a live database — `init_db`'s additive `ALTER TABLE` list is the only upgrade
path a real database sees (ADR 0002). That is the same wall ADR 0003 hit, and the answer is the
same: `sequence_publications` is a new table, `create_all` makes it on next boot, and no existing
column changes.

It carries its own `status`, `progress`, and `message` rather than borrowing a Job, because a Job
needs a Clip and a Batch has none. This is the third time that constraint has decided a table's
shape, which is the strongest argument yet for eventually rebuilding `jobs` — but not during this
change, and not on startup.

## One row per Platform, posted separately

Instagram is the only destination today; TikTok and YouTube are next. Picking three destinations
could have been one request writing one row with three states. It is three requests writing three
rows instead, because the failure modes are not shared: TikTok rejecting a video does not un-post
the Reel that already went out, and a retry is per-Platform or it is a lie. The unique constraint
is `(sequence_render_id, platform)` — a given Render reaches a given Platform once.

## Publishers stop taking a Render

`Publisher.check_render(render)` and `PublishContext.render` typed the seam to one of the two
tables. Both now take a `PostableVideo` — an id, a path, a duration, and the API path serving the
bytes — built by `publishers/targets.py`, the one module that knows both tables. Without this, a
Batch's post would have meant a second copy of `InstagramPublisher`, and the seam's whole purpose
was that adding a destination is a module plus a registry entry.

`prepare_post(caption, options)` joins it, for the same reason in the other direction. Instagram's
caption limits are 2,200 characters, 30 hashtags, and 20 @mentions; its options are a cover frame
and whether the Reel also goes to the feed. None of that is true of YouTube. The route validates
the one field every Platform shares — the Caption exists everywhere — and the publisher narrows the
rest. A Clip's post goes through the same call, so the two paths cannot drift into different rules
for the same API.

## Platform options are JSON, not columns

`share_to_feed` is a column on `publications` because Instagram was the only destination when it
was added. `sequence_publications.options` is JSON instead. Three destinations with four settings
each is twelve columns, eleven of which are NULL on any given row, and every new setting is a
migration. What the operator picks in the dialog is a bag whose shape the Platform defines, and
storing it as one is honest about that.

The Caption stays a column. Every Platform posts text beside the video, and burying the field the
operator actually writes in inside a JSON blob would make the one universal thing the hardest to
query.

## What Instagram accepts that Clip Farm still does not send

Checked against the Reels container API at the time of writing. Sent: `video_url`, `caption`,
`share_to_feed`, `thumb_offset`. Available and deliberately not built yet: `cover_url` (needs a
second signed route serving an image), `collaborators` (up to 3 usernames), `audio_name` (settable
exactly once, ever), `is_ai_generated`, `user_tags` (usernames plus x/y coordinates, which needs a
click-to-place interaction on the preview and is Instagram-only). Not available at all:
`alt_text`, which Reels do not take, and the branded-content fields, which require Facebook Login
where this app connects through Instagram Login.

The publishing account is also capped at 100 API posts per rolling 24 hours, which nothing enforces
locally yet — Instagram refuses the 101st, and the failure surfaces as that post's error.
