import { describe, expect, test } from 'vitest'
import { clampCoverOffset } from './CoverImageCropper'

describe('an uploaded Instagram cover crop', () => {
  test('a landscape picture can move horizontally but never expose an empty edge', () => {
    const source = { width: 1920, height: 1080 }
    const viewport = { width: 270, height: 480 }

    expect(clampCoverOffset({ x: 999, y: 999 }, source, viewport, 1)).toEqual({
      x: 291.66666666666663,
      y: 0,
    })
    expect(clampCoverOffset({ x: -999, y: -999 }, source, viewport, 1)).toEqual({
      x: -291.66666666666663,
      y: 0,
    })
  })

  test('zooming creates room to position a portrait picture on both axes', () => {
    expect(clampCoverOffset(
      { x: 999, y: -999 },
      { width: 1080, height: 1920 },
      { width: 270, height: 480 },
      2,
    )).toEqual({ x: 135, y: -240 })
  })
})
