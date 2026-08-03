/**
 * The Timeline's arithmetic, on its own.
 *
 * The gestures themselves are geometry — pointer capture and element rects —
 * which jsdom does not implement and which is verified in a browser. What can
 * be pinned down here is the maths those gestures resolve through: what a Shot
 * plays, where a dragged Shot lands, and what the cache looks like the instant
 * a gesture ends.
 */
import { applySequenceEdit } from './BatchProcessPage'
import { shotIsOver } from './SequencePreview'
import {
  anchorAt,
  insertionIndex,
  layout,
  layoutCutaways,
  sequenceDurationMs,
  shotAt,
  shotSpanMs,
  shotTrim,
  sourceTimeMs,
} from './Timeline'
import type { Batch, Cutaway, Project, Shot } from '../../types'

const clip = (overrides: Partial<Project> & { id: string }): Project =>
  ({
    title: overrides.id,
    duration_ms: 10_000,
    trim_start_ms: 0,
    trim_end_ms: 10_000,
    ...overrides,
  }) as Project

const shot = (overrides: Partial<Shot> & { id: string; clip_id: string }): Shot => ({
  position: 0,
  trim_start_ms: null,
  trim_end_ms: null,
  ...overrides,
})

test('a shot with no trim of its own plays its clip’s', () => {
  const source = clip({ id: 'a', trim_start_ms: 1_000, trim_end_ms: 6_000 })

  expect(shotTrim(shot({ id: 's', clip_id: 'a' }), source)).toEqual({ start: 1_000, end: 6_000 })
  expect(shotSpanMs(shot({ id: 's', clip_id: 'a' }), source)).toBe(5_000)
})

test('a trimmed shot overrides its clip, one edge at a time', () => {
  const source = clip({ id: 'a', trim_start_ms: 1_000, trim_end_ms: 6_000 })

  // Only the end was dragged, so the start still follows the clip.
  const half = shot({ id: 's', clip_id: 'a', trim_end_ms: 3_000 })
  expect(shotTrim(half, source)).toEqual({ start: 1_000, end: 3_000 })

  const both = shot({ id: 's', clip_id: 'a', trim_start_ms: 2_000, trim_end_ms: 4_500 })
  expect(shotSpanMs(both, source)).toBe(2_500)
})

test('a clip that never finished importing has no span rather than a negative one', () => {
  const unimported = clip({ id: 'a', duration_ms: null, trim_end_ms: null, trim_start_ms: 0 })

  expect(shotSpanMs(shot({ id: 's', clip_id: 'a' }), unimported)).toBe(0)
})

test('the sequence is as long as its shots, not its clips', () => {
  const clips = [
    clip({ id: 'a', trim_end_ms: 4_000 }),
    clip({ id: 'b', trim_end_ms: 9_000 }),
  ]
  const shots = [
    shot({ id: 's1', clip_id: 'a', position: 0 }),
    // The same clip twice, the second one trimmed shorter on the timeline.
    shot({ id: 's2', clip_id: 'a', position: 1, trim_end_ms: 1_000 }),
    shot({ id: 's3', clip_id: 'b', position: 2 }),
  ]

  expect(sequenceDurationMs(shots, clips)).toBe(4_000 + 1_000 + 9_000)
})

describe('where a dragged shot lands', () => {
  // 0–4s, 4–6s, 6–12s.
  const placed = [
    { startMs: 0, spanMs: 4_000 },
    { startMs: 4_000, spanMs: 2_000 },
    { startMs: 6_000, spanMs: 6_000 },
  ] as Parameters<typeof insertionIndex>[0]

  test('a shot lands before the one whose first half it is over', () => {
    expect(insertionIndex(placed, 0)).toBe(0)
    expect(insertionIndex(placed, 1_900)).toBe(0)
  })

  test('past a shot’s midpoint means after it', () => {
    expect(insertionIndex(placed, 2_100)).toBe(1)
    expect(insertionIndex(placed, 4_900)).toBe(1)
    expect(insertionIndex(placed, 5_100)).toBe(2)
  })

  test('dropping past the end lands last', () => {
    expect(insertionIndex(placed, 99_000)).toBe(3)
  })
})

describe('the cache while an edit is in flight', () => {
  const batch = {
    id: 'batch-1',
    shots: [
      shot({ id: 's1', clip_id: 'a', position: 0 }),
      shot({ id: 's2', clip_id: 'b', position: 1 }),
      shot({ id: 's3', clip_id: 'c', position: 2 }),
    ],
  } as Batch

  test('a move reorders and renumbers', () => {
    const next = applySequenceEdit(batch, { kind: 'move', shotId: 's3', position: 0 })

    expect(next.shots.map((item) => item.id)).toEqual(['s3', 's1', 's2'])
    expect(next.shots.map((item) => item.position)).toEqual([0, 1, 2])
  })

  test('a removal closes the gap it leaves', () => {
    const next = applySequenceEdit(batch, { kind: 'remove', shotId: 's1' })

    expect(next.shots.map((item) => item.id)).toEqual(['s2', 's3'])
    expect(next.shots.map((item) => item.position)).toEqual([0, 1])
  })

  test('a trim touches only the edge it was given', () => {
    const next = applySequenceEdit(batch, { kind: 'trim', shotId: 's2', trim: { trim_end_ms: 800 } })

    expect(next.shots[1].trim_end_ms).toBe(800)
    expect(next.shots[1].trim_start_ms).toBeNull()
    expect(next.shots[0]).toEqual(batch.shots[0])
  })

  test('an add is not predicted — only the server can name the new shot', () => {
    expect(applySequenceEdit(batch, { kind: 'add', clipId: 'a' })).toBe(batch)
  })

  test('the batch it was given is never mutated', () => {
    applySequenceEdit(batch, { kind: 'move', shotId: 's3', position: 0 })

    expect(batch.shots.map((item) => item.id)).toEqual(['s1', 's2', 's3'])
  })
})

describe('what plays at a point on the sequence', () => {
  const clips = [
    // Trimmed to 2s–6s of a 20s source: the preview holds the whole source, so
    // the trim is an offset to seek to rather than a cut already made.
    clip({ id: 'a', trim_start_ms: 2_000, trim_end_ms: 6_000 }),
    clip({ id: 'b', trim_start_ms: 0, trim_end_ms: 3_000 }),
  ]
  const placed = layout(
    [
      shot({ id: 's1', clip_id: 'a', position: 0 }),
      shot({ id: 's2', clip_id: 'b', position: 1 }),
    ],
    clips,
  )

  test('the sequence starts on the first shot at its in-point', () => {
    const at = shotAt(placed, 0)!

    expect(at.item.shot.id).toBe('s1')
    expect(at.intoShotMs).toBe(0)
    expect(sourceTimeMs(at.item, at.intoShotMs)).toBe(2_000)
  })

  test('a point inside a shot seeks that far past its in-point', () => {
    const at = shotAt(placed, 1_500)!

    expect(at.item.shot.id).toBe('s1')
    expect(sourceTimeMs(at.item, at.intoShotMs)).toBe(3_500)
  })

  test('a boundary belongs to the shot that starts there', () => {
    const at = shotAt(placed, 4_000)!

    expect(at.item.shot.id).toBe('s2')
    expect(at.intoShotMs).toBe(0)
    expect(sourceTimeMs(at.item, at.intoShotMs)).toBe(0)
  })

  test('past the end holds the last frame rather than reporting nothing', () => {
    const at = shotAt(placed, 99_000)!

    expect(at.item.shot.id).toBe('s2')
    expect(at.intoShotMs).toBe(3_000)
  })

  test('an empty sequence has nothing playing', () => {
    expect(shotAt([], 0)).toBeNull()
  })
})

describe('cutaways positioned against the sequence', () => {
  const clips = [
    clip({ id: 'a', trim_end_ms: 6_000 }),
    clip({ id: 'b', trim_end_ms: 8_000 }),
    clip({ id: 'cover', trim_end_ms: 2_000 }),
  ]
  const placed = layout(
    [
      shot({ id: 's1', clip_id: 'a', position: 0 }),
      shot({ id: 's2', clip_id: 'b', position: 1 }),
    ],
    clips,
  )
  const cutaway = (overrides: Partial<Cutaway> & { base_shot_id: string; offset_ms: number }) => ({
    id: 'k1',
    clip_id: 'cover',
    trim_start_ms: null,
    trim_end_ms: null,
    ...overrides,
  })

  test('a cutaway lands at its base shot’s start plus its offset', () => {
    const [item] = layoutCutaways([cutaway({ base_shot_id: 's2', offset_ms: 3_000 })], placed, clips)

    // s2 starts at 6.0s, so a 3.0s offset into it is 9.0s on the sequence.
    expect(item.startMs).toBe(9_000)
    expect(item.spanMs).toBe(2_000)
    expect(item.overflows).toBe(false)
  })

  test('a cutaway is clipped to what is left of the shot it covers', () => {
    // s2 runs 6.0s–14.0s, so an offset of 7.0s leaves only 1.0s of room.
    const [item] = layoutCutaways([cutaway({ base_shot_id: 's2', offset_ms: 7_000 })], placed, clips)

    expect(item.spanMs).toBe(1_000)
    expect(item.overflows).toBe(true)
  })

  test('a cutaway whose base shot is gone is not drawn', () => {
    expect(layoutCutaways([cutaway({ base_shot_id: 'gone', offset_ms: 0 })], placed, clips)).toEqual(
      [],
    )
  })
})

describe('where a dragged cutaway anchors', () => {
  const clips = [clip({ id: 'a', trim_end_ms: 6_000 }), clip({ id: 'b', trim_end_ms: 8_000 })]
  const placed = layout(
    [
      shot({ id: 's1', clip_id: 'a', position: 0 }),
      shot({ id: 's2', clip_id: 'b', position: 1 }),
    ],
    clips,
  )

  test('it covers whichever shot it was dropped over', () => {
    expect(anchorAt(placed, 2_000, 1_000)).toEqual({ baseShotId: 's1', offsetMs: 2_000 })
    expect(anchorAt(placed, 7_500, 1_000)).toEqual({ baseShotId: 's2', offsetMs: 1_500 })
  })

  test('it cannot be pushed past the end of the shot it covers', () => {
    // s1 is 6.0s long, so a 2.0s cutaway can start no later than 4.0s in.
    expect(anchorAt(placed, 5_800, 2_000)).toEqual({ baseShotId: 's1', offsetMs: 4_000 })
  })

  test('dropping past the sequence falls on the last shot', () => {
    expect(anchorAt(placed, 99_000, 1_000)?.baseShotId).toBe('s2')
  })

  test('an empty sequence has nothing to cover', () => {
    expect(anchorAt([], 0, 1_000)).toBeNull()
  })
})

describe('when a shot is over', () => {
  test('reaching its trim end hands over to the next shot', () => {
    expect(shotIsOver(5_000, 5_000, 5_000)).toBe(true)
    expect(shotIsOver(2_000, 5_000, 5_000)).toBe(false)
  })

  test('a preview shorter than the clip still ends the shot', () => {
    // The regression: trim_end_ms is the source's duration, but the preview is
    // a re-encode two frames shorter, so currentTime never reaches 5000 and the
    // sequence stalled after one shot.
    expect(shotIsOver(4_966, 5_000, 4_966)).toBe(true)
  })

  test('a trimmed shot ends at its trim, not at the media', () => {
    expect(shotIsOver(3_000, 3_000, 20_000)).toBe(true)
    expect(shotIsOver(2_500, 3_000, 20_000)).toBe(false)
  })

  test('an unknown media duration falls back to the trim alone', () => {
    expect(shotIsOver(4_950, 5_000, null)).toBe(true)
    // Still a tenth of a second to play: not over.
    expect(shotIsOver(4_900, 5_000, null)).toBe(false)
  })
})
