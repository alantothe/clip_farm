# A Layer Profile can be swapped for another

Extends [ADR 0010](0010-layer-profiles-drop-source-timing.md), which settled what a Layer Profile
saves and how its timing lands, and said nothing about applying a second one.

Applying a profile created ordinary Titles and images and kept no record of where they came from.
That was enough while a Batch wore one arrangement. It is not enough for the thing operators
actually do: reaching for a profile, deciding against it, and reaching for another. There was no
swap, only a stack — the first profile's layers stayed, the second's landed on top, and the two
fought for the same frame.

The Title side at least failed loudly, because a fourth simultaneous Title is refused (ADR 0008).
The image side failed silently: two copies of the same picture at the same place and opacity look
exactly like one, so the only visible symptom was a slower render.

## Applied layers name the profile that made them

`titles.applied_profile_id` and `batch_media.applied_profile_id`. Without them the endpoint cannot
answer "which of these did a profile put here", and every safeguard downstream — swapping, the
badge on the card, the count in the warning — is a question about exactly that.

It is not the same field as `titles.style_id`. A Style id is kept for a label; this one is kept to
decide what a later apply may remove.

## Only tagged layers are cleared, never hand-made ones

The tempting shortcut is to clear every layer running `0` to the Sequence end, since that is what a
profile creates. It is wrong: the editor makes full-Sequence layers too, so a watermark the operator
placed by hand is indistinguishable from a profile's by span alone. Deleting one is the kind of
mistake that is discovered after the export.

So a Replace clears exactly the rows carrying an `applied_profile_id` and leaves everything else,
including hand-made full-Sequence layers. Because Replace removes the old profile's Titles before
testing the new profile's against the three-slot rule, swapping three Titles for three succeeds
where adding them would be refused.

Layers that predate this decision are untagged and stay untagged. Backfilling by guessing at
full-span layers would make the first swap after the upgrade delete the very hand-written layers
this rule exists to protect; clearing them once by hand costs the operator less than that.

## Stacking stays available, behind a question

`mode` is `add` or `replace`, and `add` remains the default at the API — deliberately, so anything
calling the old endpoint keeps its old behaviour. The dialog picks the mode from an answer instead
of a default: applying onto a Batch already wearing profile layers asks, names the profiles coming
off and how many layers go with them, and offers Swap, Add on top, or Cancel. Applying onto a Batch
wearing nothing asks nothing, because there is nothing to lose.

Two profiles at once is a real thing to want — a corner logo and a lower third are separate
arrangements. It stops being a trap once it is chosen rather than stumbled into.

## Deleting a profile does not delete what it applied

Both foreign keys are `ON DELETE SET NULL`. A profile's words, bytes, and look were copied onto the
Batch at apply time (ADR 0010) and are the operator's edit now; losing the profile should cost the
name it came from and nothing else. The layers go untagged, which means a later Replace has no
claim on them — correct, since no profile that still exists made them.

The image files a Replace removes are unlinked after the transaction commits, not before. An
orphaned file wastes disk. A layer still on the Timeline whose bytes are gone is a broken export.

## What this does not fix

Saving is still create-only: a name collision is refused with no offer to update the profile in
place, so re-saving means deleting and recreating, which destroys the profile's image copies and
mints a new id. There is no rename. The save dialog still does not say that layers outside the
playhead were left out of the capture (ADR 0010 makes that exclusion deliberate; it is not yet
made visible). `MAX_LAYER_PROFILES` and the name-uniqueness check are read-then-write with no
database constraint under them.
