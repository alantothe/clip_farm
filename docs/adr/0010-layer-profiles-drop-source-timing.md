# Layer Profiles drop source timing and own their image copies

A **Layer Profile** saves the Titles and Sequence images visible at the Player's
current playhead so the same arrangement can be reused on another Batch. The
operator may keep all of those layers or choose only the text or image part.

## Timing belongs to the target Sequence

A profile stores no `start_ms` or `end_ms`. Applying it creates every saved
layer at `0` and binds its back edge to the target Sequence's calculated
duration. Adding, removing, or trimming Shots moves that edge so the layers
continue to fill the video. Explicitly retiming a layer's end breaks the binding
and turns it back into an ordinary fixed span. A short Batch and a long Batch
therefore get the same full-video arrangement without scaling or retaining a
stale end time from the Batch where it was saved.

This is deliberately different from a Phrase. Applying a Phrase edits one
existing Title and leaves that Title's timing alone (ADR 0008); applying a Layer
Profile creates new layers and defines their timing as the target's full span.

## Saving captures what the Player currently shows

"Current image and text" means Sequence images and Titles whose half-open spans
contain the playhead. It does not mean every timed layer anywhere in the Batch:
a hook at the beginning and a sign-off at the end are different compositions,
even if both happen to belong to the same Sequence.

The three simultaneous Title limit still applies. Applying a profile is rejected
atomically if its full-span Titles would require a fourth slot alongside Titles
already in the target Batch.

## Images are copies, not links

Each profile owns a copy of every image file it saves. Applying the profile makes
another independent copy inside the target Batch. Deleting the source Batch,
the profile, or an image from Storage cannot silently change the other two,
matching the copy semantics Storage already uses for placed images.
