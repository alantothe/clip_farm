# Clip Farm

Clip Farm turns a landscape video you own into a vertical, subtitled video ready to publish to Instagram Reels. One operator, working on their own material.

## Language

### The work

**Clip**:
One source video together with the edit decisions applied to it. The unit you open, edit, render, and publish.
_Avoid_: project, video, item

**Batch**:
A named set of Clips imported and worked on together, which renders as one video through its Sequence. A Clip belongs to at most one Batch. Almost every edit setting belongs to the Clip rather than the Batch — each Clip in it is trimmed, cropped, and subtitled on its own. What the Batch holds is what belongs to the finished video as a whole: the Format its Sequence renders to, chosen when the Batch is made and fixed thereafter, and its Titles. Several Batches run at once; that is the point of them.
_Avoid_: project, group, folder, run

**Sequence**:
The ordered arrangement of Clips in a Batch that renders as one video. One per Batch. A Clip can sit in a Batch without being in its Sequence, and can appear in it more than once.
_Avoid_: timeline, edit, montage

**Shot**:
One Clip's placement in a Sequence, at a position. The span that plays is the Shot's own Trim, or its Clip's Trim when the Shot has none of its own. Its framing zoom and position also belong to this placement, so the same Clip can be wide once and tight later. One Clip can have several Shots.
_Avoid_: item, entry, segment, clip instance

**Cutaway**:
A Shot that covers another for a span, showing its picture while the covered Shot's audio keeps playing. It sits at an offset into the Shot it covers, and travels with it. A Cutaway's own Subtitles are not burned in — nobody hears the words they transcribe.
_Avoid_: b-roll, overlay, insert, PiP

**Base Shot**:
The Shot a Cutaway covers. Only a Shot in the Sequence can be one; a Cutaway cannot cover a Cutaway.
_Avoid_: parent, host, underlying clip

**Timeline**:
The strip that presents a Sequence for editing — reordering Shots, trimming them, and scrubbing the Sequence. Horizontal space is time: a Shot is as wide as it is long. UI, not a model — as Mode Library is to Mode.
_Avoid_: track, storyboard, editor

**Player**:
The screen that plays a Sequence as one video, with its transport and guides. It shares the Timeline's playhead rather than keeping one of its own. Titles are placed and sized on its stage. UI, not a model — as Timeline is.
_Avoid_: preview, monitor, viewer, rough cut

**Title Track**:
The three-row lane on the Timeline that holds a Batch's Titles, above the Shots and the Cutaways. UI, not a model — as Timeline is.
_Avoid_: text track, text layer, caption track, title lane

**Review Range**:
A marked span of a Sequence to play or loop while editing. It changes nothing and renders as nothing — it is not a Trim. There is one per Player; looping a single Shot sets its edges to that Shot's.
_Avoid_: in/out, selection, trim, loop points

**Origin**:
Where a Clip came from — an X post, or a file uploaded from disk. Some Origins have a URL; uploads do not.
_Avoid_: source, source post, provenance

**Origin Kind**:
Which way a Clip entered Clip Farm: `x` or `upload`.
_Avoid_: mode, source type, ingest type

**Source Video**:
The unmodified video file a Clip is built from, exactly as downloaded or uploaded.
_Avoid_: source, original, raw, master

**Format**:
The shape of the finished video. Vertical today. It belongs to a Batch, is picked when the Batch is created, and never changes — a Sequence joins its Shots into one file, so the shape has to hold for all of them. It names a shape and nothing else: Instagram is a Platform, not part of a Format.
_Avoid_: mode, aspect, output type, instagram vertical

**Mode**:
A signposted way in on the home page, pairing an Origin Kind with a Format. A Mode is a door, not a property of a Clip — a Clip has an Origin Kind and a Format.
_Avoid_: workflow, flow

**Mode Library**:
The full set of Modes, and the home page that presents them.
_Avoid_: modes page, gallery, tool picker

### Editing

**Subtitle**:
Timed text burned into the video image.
_Avoid_: caption, subs, CC, transcript

**Caption**:
The text posted alongside a Render on the Platform.
_Avoid_: description, post text, social caption, blurb

**Overlay**:
An image placed on top of the video for a defined span of the Clip. Always an image: text drawn over the picture is a Title, and belongs to a Batch rather than a Clip.
_Avoid_: sticker, watermark, image

**Storage**:
The operator's reusable image collection, available from every image picker. Uploading an image through a picker saves it here before placing an independent copy in a Clip or Sequence. Deleting an image from Storage cleans the collection without changing copies already used in edits.
_Avoid_: bank, library, assets, media

**Title**:
Text an operator writes, drawn over the picture for a span of a Sequence and burned into the Sequence Render. It belongs to the Batch, not to any Clip, and holds its own time, place, size and look. A Batch has as many as it likes, and up to three may overlap at one instant. A Title transcribes nothing — that is a Subtitle — and is not posted beside the video — that is a Caption.
_Avoid_: text overlay, text, lower third, sticker, graphic, headline

**Title Style**:
A saved, named look a Title can be made from — its font, colour, size, placement and the rest, without its words or its timing. Reusable across every Batch. Applying one copies its values onto the Title; it does not bind them, so editing a Style later leaves Titles already made from it alone (ADR 0008). Some are built into Clip Farm and cannot be edited; the rest are saved by the operator. A saved look that carries the words too is a Phrase.
_Avoid_: profile, preset, template, theme, style

**Phrase**:
Words an operator saves whole — the text together with its look and its place — to write again on another Batch. A Title Style saves the look without the words; a Phrase saves both. It has no name, because the words are its name, and no timing, because where it lands in a Sequence is a fact about that Sequence. Applying one copies its words and its look onto a Title and leaves that Title's timing alone (ADR 0008).
_Avoid_: snippet, preset, saved text, template, favourite

**Layer Profile**:
A named, reusable arrangement of the Titles and Sequence images visible at one point in a Batch. It saves independent copies of their words, image bytes, look, size and placement, but no timing. Applying one to another Batch creates new layers that all run from the Sequence beginning to its actual end, whatever that duration becomes (ADR 0010). Applying it over a Batch that already wears one either swaps that arrangement out or stacks beside it, and the operator is asked which; either way the layers made by hand stay (ADR 0013). A Layer Profile is broader than a Title Style or Phrase because it may carry text and images together.
_Avoid_: layout (already means how a source frame fits the Format), template, composition preset

**Trim**:
The span of the Source Video that survives into the Render.
_Avoid_: cut, range, in/out

**Layout**:
How the source frame is first fitted into the Format — cropped to fill, or fitted whole against a background. A Shot's framing can then zoom and position that picture without changing the Layout.
_Avoid_: crop mode, fit, framing

### Output

**Render**:
A finished video file, frozen together with the exact edit settings that produced it. A Clip's settings can change afterwards; a Render's cannot.
_Avoid_: rendition, export, output, version

**Sequence Render**:
The finished video a Sequence produces — every Shot in order, joined into one file. Frozen like a Render, but belonging to a Batch rather than a Clip.
_Avoid_: batch render, master, final cut

**Artifact**:
A supporting file belonging to a Clip — its Source Video, preview, thumbnail, extracted audio, or an Overlay image. A Render is not an Artifact.
_Avoid_: asset, file, media

### Publishing

**Platform**:
An external service a Render is published to. Instagram today.
_Avoid_: destination, channel, network

**Platform Account**:
The account Clip Farm publishes through on a Platform. One per Platform.
_Avoid_: account, connection, integration

**Publication**:
One attempt to publish one Render to one Platform. A given Render reaches a given Platform once.
Publishing a Batch's Sequence Render is a **Sequence Publication** — a separate row for the same
reason a Sequence Render is not a Render (ADR 0012). Choosing several Platforms makes one per
Platform, each posting, failing, and retrying on its own.
_Avoid_: post, upload, publish

**Publish Options**:
What one Platform is told beyond the Caption — Instagram's cover frame and whether the Reel also
reaches the feed. They belong to a Publication rather than to the Batch, because they are what a
Platform asks for rather than anything about the edit, and no two Platforms ask the same.
_Avoid_: settings, metadata, post config

**Cover Frame**:
The moment in a Sequence Render that a Platform shows as the video's still image. Chosen as a time,
not an uploaded picture, so it always comes from the video being posted.
_Avoid_: thumbnail, poster, preview image

### Process

**Import**:
Bringing a Source Video onto disk and preparing its Clip for editing — inspecting it, building the preview and thumbnail, and generating Subtitles.
_Avoid_: ingest, download, fetch

**Job**:
The visible progress of one background task — its status, percentage, and current step.
_Avoid_: task, queue item, worker
