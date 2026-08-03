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
import { insertionIndex, sequenceDurationMs, shotSpanMs, shotTrim } from './Timeline'
import type { Batch, Project, Shot } from '../../types'

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
