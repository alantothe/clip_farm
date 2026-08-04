/**
 * The magnet that takes a drag on the Player's stage to the centre of the frame.
 *
 * Everything placed on the stage is stored as a percent of the frame, because
 * that is what the API keeps and the renderer burns in (ADR 0008) — but the
 * magnet has to be felt in pixels. A reach written in percent would pull harder
 * on a small stage than a large one, and harder down the 1920-tall axis than
 * across the 1080-wide one, so the same gesture would land differently in a
 * fullscreen Player than in a windowed one.
 *
 * So the reach is stated in stage pixels once, and each gesture says what one
 * dragged pixel is worth in the units it is moving. For a Title or a Sequence
 * image that is simply the stage's own size; for a Shot's framing it is the
 * geometry in `movedFrameCenter`, where a pixel of pointer travel moves the
 * picture by an amount that depends on the zoom and the Layout.
 *
 * Holding Alt suppresses the magnet, for the placement that is deliberately a
 * hair off centre (ADR 0011).
 */

/** The one line everything snaps to: the middle of the frame, on either axis. */
export const CENTRE = 50

/** How near the line the picture must come, in stage pixels, to be taken to it. */
export const SNAP_REACH_PX = 7

export type Snap = { value: number; snapped: boolean }

/** Which axes of a drag came to rest on a centre, and so have a line to draw. */
export type Centred = { x: boolean; y: boolean }

/* Constants rather than fresh objects, so a drag that stays snapped — or stays
   off the line — does not re-render the stage on every pointer move. */
export const NOT_CENTRED: Centred = { x: false, y: false }
export const CENTRED_X: Centred = { x: true, y: false }
export const CENTRED_Y: Centred = { x: false, y: true }

/** What one dragged stage pixel is worth, for a thing placed in percent of it. */
export const percentPerPx = (stagePx: number) => (stagePx > 0 ? 100 / stagePx : 0)

/**
 * Pull a value onto the centre line when the drag comes within reach of it.
 *
 * `percentPerPx` is signed and may be zero — a fitted picture wider than the
 * Format travels the opposite way, and an axis with nowhere to pan travels not
 * at all. Only its size matters here, and zero means there is no movement for a
 * magnet to act on.
 */
export function snapToCentre(value: number, percentPerPx: number, enabled = true): Snap {
  if (!enabled || !Number.isFinite(percentPerPx) || percentPerPx === 0) {
    return { value, snapped: false }
  }
  const reach = Math.abs(percentPerPx) * SNAP_REACH_PX
  return Math.abs(value - CENTRE) <= reach
    ? { value: CENTRE, snapped: true }
    : { value, snapped: false }
}

/** Both axes of a layer's centre at once, with the lines to draw for them. */
export function snappedCentre(
  centre: { center_x: number; center_y: number },
  stage: { width: number; height: number },
  enabled = true,
): { center_x: number; center_y: number; centred: Centred } {
  const x = snapToCentre(centre.center_x, percentPerPx(stage.width), enabled)
  const y = snapToCentre(centre.center_y, percentPerPx(stage.height), enabled)
  return {
    center_x: x.value,
    center_y: y.value,
    centred: { x: x.snapped, y: y.snapped },
  }
}

/** Whether the magnet is on for this event: it is, unless Alt is held down. */
export const magnetOn = (event: { altKey: boolean }) => !event.altKey

/**
 * The lines that say a drag is centred, drawn only while it is.
 *
 * Each is named for the axis it marks rather than the direction it runs, so the
 * line for a centred `center_x` is the upright one down the middle. They are
 * drawn inside whichever stage layer is dragging, which is why they inherit
 * their extent from `inset: 0` rather than measuring anything.
 */
export function CentreLines({ centred }: { centred: Centred }) {
  if (!centred.x && !centred.y) return null
  return (
    <>
      {centred.x && (
        <span className="player__centre-line player__centre-line--x" aria-hidden="true" />
      )}
      {centred.y && (
        <span className="player__centre-line player__centre-line--y" aria-hidden="true" />
      )}
    </>
  )
}
