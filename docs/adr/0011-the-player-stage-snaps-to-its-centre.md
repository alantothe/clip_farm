# The Player stage snaps to its centre

Everything an operator drags on the Player's stage is stored as a percent of the
frame: a Title's and a Sequence image's centre, and a Shot's framing centres
(ADR 0008, ADR 0009). Dead centre is the placement asked for most often and the
one a pointer is least able to hit, because 50% of 1080 is a single pixel of a
stage that is a few hundred pixels wide. So a drag that comes near the centre of
the frame is taken to it exactly, and a magenta line is drawn on the axis it
landed on for as long as the gesture holds it there.

## The reach is a distance on the screen, not a share of the frame

A reach written in percent would pull harder on a small stage than a large one,
harder down the 1920-tall axis than across the 1080-wide one, and — for a Shot's
framing, where a dragged pixel moves the picture by an amount that depends on
the zoom and the Layout — harder at 3× than at 2×. The same gesture would then
land differently in a fullscreen Player than in a windowed one.

So the reach is stated once in stage pixels, and each gesture converts it
through what one dragged pixel is worth in the units it is moving. The magnet is
felt as the same few pixels of picture travel everywhere on the stage, and an
axis with nowhere to travel — a smart crop at 1×, an unmeasured stage — is never
snapped, because there is no movement for a magnet to act on.

## Alt suppresses it, and nothing else does

There is no snapping toggle. A placement deliberately a hair off centre is rare
enough to be a held modifier rather than a mode to remember, and the sliders in
the inspectors remain the exact, keyboard-accessible path to any number at all.
The hint on the stage says so while the magnet has hold of a drag, which is the
only sign that the exact figure was taken out of the operator's hands.

## Only the frame's own centre

Not thirds, not the edges, and not the other layers. A Title snapping to a
Sequence image would need a rule for which of them was authoritative and would
fire constantly on a stage this small, and neither the safe area nor the rule of
thirds is a placement the renderer treats as special. The centre is the one line
the finished video is composed against, so it is the only one that pulls.
