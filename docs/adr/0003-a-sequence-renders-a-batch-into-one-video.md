# A Sequence renders a Batch into one video

Supersedes one clause of [ADR 0002](0002-batches-group-clips-for-parallel-work.md).

A Batch was a set of Clips that each rendered and published on its own. That is not what the
operator wants a Batch for: the Clips in one are parts of a single finished video, not a queue of
separate deliverables. A Batch now owns a **Sequence** — the ordered arrangement of its Clips that
renders as one video — and each Clip's placement in that Sequence is a **Shot**.

ADR 0002 said a Batch has "no shared trim, layout, or Subtitle settings, and no batch-level
render." The first half stands and is load-bearing: each Clip is still trimmed, cropped, and
subtitled on its own, which is what lets the whole per-Clip editor be reused unchanged. Only "no
batch-level render" is superseded, and 0002 anticipated it — "anything that renders a Batch as a
unit can be added later on top of this."

A Clip can sit in a Batch without being in its Sequence. Uploading is not the same act as deciding
what makes the cut, and separating them costs one table and one button. A Clip has at most one
Shot for now; a Shot plays the span its Clip's own Trim defines, so a second placement of the same
Clip would play identically twice. Per-Shot trim is the change that would make repeats useful, and
the Shot row exists so it can be added without reshaping anything.

## Stream-copying the Shots together drifts the audio

Every Clip renders through the same encoder settings, so the obvious join is the concat demuxer
with `-c copy` — no re-encode, near-instant. Measured across ten 2-second Shots with alternating
tones, the audio boundary lands progressively later than its video boundary: +50 ms after the
first join, +250 ms by the ninth. The cause is AAC frame quantization. Each intermediate's audio
runs about 27 ms longer than its video, because encoded AAC comes in whole 1024-sample frames, and
concatenation accumulates that excess once per join.

Nothing reports this. ffmpeg exits 0 and writes a playable file.

| Join strategy | Worst A/V offset | Time (20 s out) | Re-encodes video |
|---|---|---|---|
| `-c copy` | +250 ms, growing per join | 0.3 s | no |
| copy video, re-encode audio | +70 ms, still growing | 1.4 s | no |
| concat filter, full re-encode | +50 ms, flat | 7.3 s | yes |
| **PCM intermediates, copy video** | **+50 ms, flat** | **1.4 s** | **no** |

So each Shot's finished MP4 is remuxed to PCM audio in Matroska first — `-c:v copy -c:a pcm_s16le`,
which costs almost nothing — and the Sequence is joined from those with `-c:v copy -c:a aac`. PCM
has no frame padding, so each Shot's audio is exactly as long as its video. This matches a full
re-encode for accuracy at a fifth of the cost, and the video is never encoded twice.

The residual ~50 ms in the bottom two rows is flat rather than accumulating, and sits within the
measurement's own resolution plus the AAC encoder's constant delay. The distinction that matters
is per-join growth, which only `-c copy` shows.

Two failures fall out of the same step. A Clip with no audio produces a Shot with no audio stream,
and joining it truncates the Sequence's audio — a three-Shot test gave 6.0 s of video against
4.0 s of audio, again exiting 0. And a mono Shot is copied into a stream declared stereo without
complaint. The remux normalizes both: silence is generated for a Shot that has none, and every
Shot is forced to stereo at 48 kHz.

## A Sequence Render is its own table, not a Render

`renders.project_id` and `jobs.project_id` are both `NOT NULL`. A Sequence Render belongs to a
Batch and has no single Clip to name there.

Relaxing `NOT NULL` in SQLite means rebuilding the table, and per ADR 0002 nothing runs Alembic —
`init_db`'s additive `ALTER TABLE` list is the only upgrade path a real database sees. Rebuilding
`renders` would mean dropping and recreating it while `jobs.render_id` and `publications.render_id`
point at it under `PRAGMA foreign_keys=ON`, on startup. That is the risk 0002 already declined to
take.

So `shots` and `sequence_renders` are new tables. `create_all` makes them on next boot exactly as
it made `batches`, and no existing column changes. A Sequence Render carries its own status,
progress, and message rather than borrowing a Job, for the same reason: a Job needs a Clip.

The cost is that publishing does not come free — `publications.render_id` points at `renders`, so a
Sequence Render cannot be posted through the existing Publisher seam without a second path. Nobody
asked to publish a Batch; downloading the finished MP4 is the whole delivery today.

## Rendering every Shot on every export is slow

A Sequence Render re-renders each Shot from its Source Video, and `smart_crop` is OpenCV reading
frames one at a time through a face detector. A ten-Shot Sequence is minutes of work repeated
whenever anything changes.

The fix is to reuse a Clip's most recent completed Render when its settings still match, which
`Render` already makes cheap — it freezes the exact layout, trim, and Subtitle settings that
produced it. It is not done here because `Render` does not freeze Overlay geometry or edited
Subtitle text, so matching on those fields alone would serve a stale Shot. Caching is worth doing
against a settings digest that covers them; correctness first.
