# A Shot owns its framing

The Batch editor needs a direct way to zoom and reposition the picture while
judging it in the Player. The Clip's Layout remains the first fit into the
Format: either a face-following smart crop or the whole frame over a blurred
background. Framing is the second step, applied to that result.

Framing belongs to the Shot, not the Clip. A Clip may appear several times in
one Sequence, and a wide establishing placement followed by a tight detail is
an ordinary edit. Cutaways are Shots too and use the same fields. Each Shot
stores `frame_zoom` from 1× to 3× and horizontal and vertical centres from 0%
to 100%. At 1× a fitted picture uses the full Format bounds: landscape reaches
both side edges and portrait reaches top and bottom, with blur only on the axis
the source cannot fill. This removes the old unexplained 1000×1780 inner
gutter.

The centres describe which part of an enlarged picture survives. At 0% the
left or top edge is held; at 100% the right or bottom edge is held. The Player
uses the same geometry while a control is moving: pulling a corner changes the
zoom, and dragging a border changes one centre — the side borders pan across,
the top and bottom borders pan up and down. A border is a handle on its own
axis, so a drag that wanders diagonally cannot disturb the centre the operator
was not aiming at. The API saves only when the gesture ends. Sliders remain the
exact, keyboard-accessible path to the same numbers, one axis each. Existing
databases receive the three fields additively.

Framing moves only the Shot's video. Overlays belong to the Clip's finished
canvas and Titles belong to the Batch, so both stay where the operator placed
them. For a smart crop the zoom and position are applied after face tracking;
for a fitted Layout they move the sharp foreground while its blurred backdrop
continues to fill the Format.
