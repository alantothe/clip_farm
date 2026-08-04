/**
 * The centre magnet, on its own.
 *
 * The gestures that feed it are geometry jsdom does not have; what can be
 * pinned down here is the pull itself — that it lands on the centre exactly,
 * that its reach is a distance on the screen rather than a share of an axis,
 * and that Alt turns it off.
 */
import { SNAP_REACH_PX, percentPerPx, snapToCentre, snappedCentre } from './snapping'

describe('the magnet that takes a drag to the centre of the frame', () => {
  // A 1080×1920 Format drawn 200 wide and 400 tall: a percent across is 2px,
  // and a percent down is 4px.
  const stage = { width: 200, height: 400 }

  test('a drag that comes within reach lands on the centre exactly', () => {
    // 51.5% across is 3px right of the middle of a 200px stage.
    expect(snappedCentre({ center_x: 51.5, center_y: 51 }, stage)).toEqual({
      center_x: 50,
      center_y: 50,
      centred: { x: true, y: true },
    })
  })

  test('the reach is the same few pixels on either axis, not the same percent', () => {
    // 2% is 4px across and 8px down, so the short axis is still in reach while
    // the long one has left it. A percent-shaped reach would take both.
    expect(snappedCentre({ center_x: 52, center_y: 52 }, stage)).toEqual({
      center_x: 50,
      center_y: 52,
      centred: { x: true, y: false },
    })
  })

  test('a drag beyond the reach keeps the pixel it was put on', () => {
    expect(snappedCentre({ center_x: 62, center_y: 40 }, stage)).toEqual({
      center_x: 62,
      center_y: 40,
      centred: { x: false, y: false },
    })
  })

  test('holding Alt suppresses it, for a placement that is meant to be off centre', () => {
    expect(snappedCentre({ center_x: 50.2, center_y: 50.1 }, stage, false)).toEqual({
      center_x: 50.2,
      center_y: 50.1,
      centred: { x: false, y: false },
    })
  })

  test('the reach is stated in stage pixels, whatever the axis is worth', () => {
    const acrossReach = SNAP_REACH_PX * percentPerPx(stage.width)
    expect(snapToCentre(50 + acrossReach, percentPerPx(stage.width)).snapped).toBe(true)
    expect(snapToCentre(50 + acrossReach * 1.01, percentPerPx(stage.width)).snapped).toBe(false)
  })

  test('an axis with nowhere to travel is never snapped', () => {
    // A Shot at 1× has no picture outside the Format to pan, and an unmeasured
    // stage has no pixels at all. Neither is a centring the operator asked for.
    expect(snapToCentre(50.4, 0)).toEqual({ value: 50.4, snapped: false })
    expect(percentPerPx(0)).toBe(0)
    expect(snappedCentre({ center_x: 50.1, center_y: 50.1 }, { width: 0, height: 0 })).toEqual({
      center_x: 50.1,
      center_y: 50.1,
      centred: { x: false, y: false },
    })
  })

  test('it pulls from either side of the line', () => {
    const rate = percentPerPx(stage.width)
    expect(snapToCentre(48.5, rate).value).toBe(50)
    expect(snapToCentre(51.5, rate).value).toBe(50)
  })

  test('a negative rate pulls just as hard, since only its size is the reach', () => {
    // A fitted picture wider than the Format travels against the pointer, so the
    // rate its gesture reports is negative (ADR 0009).
    expect(snapToCentre(51.5, -percentPerPx(stage.width)).value).toBe(50)
  })
})
