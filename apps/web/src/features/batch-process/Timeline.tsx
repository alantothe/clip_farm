import { useEffect, useRef, useState } from 'react'
import { Clapperboard, ZoomIn, ZoomOut } from 'lucide-react'
import { formatTime } from '../../lib/format'
import { artifact } from '../../lib/project'
import type { Project, Shot, ShotTrim } from '../../types'

/** The span a Shot plays: its own Trim, falling back to its Clip's. */
export function shotTrim(shot: Shot, clip: Project) {
  return {
    start: shot.trim_start_ms ?? clip.trim_start_ms,
    end: shot.trim_end_ms ?? clip.trim_end_ms ?? clip.duration_ms ?? 0,
  }
}

export function shotSpanMs(shot: Shot, clip: Project): number {
  const { start, end } = shotTrim(shot, clip)
  return Math.max(0, end - start)
}

export function sequenceDurationMs(shots: Shot[], clips: Project[]): number {
  return shots.reduce((total, shot) => {
    const clip = clips.find((item) => item.id === shot.clip_id)
    return total + (clip ? shotSpanMs(shot, clip) : 0)
  }, 0)
}

/** A Shot on the Timeline, with where it starts and how long it runs. */
type Placed = { shot: Shot; clip: Project; startMs: number; spanMs: number }

/** Gapless: each Shot starts where the one before it ended. */
function layout(shots: Shot[], clips: Project[]): Placed[] {
  let cursor = 0
  const placed: Placed[] = []
  for (const shot of shots) {
    const clip = clips.find((item) => item.id === shot.clip_id)
    if (!clip) continue
    const spanMs = shotSpanMs(shot, clip)
    placed.push({ shot, clip, startMs: cursor, spanMs })
    cursor += spanMs
  }
  return placed
}

/** Where a Shot dragged to `ms` belongs, given the Shots it is not. */
export function insertionIndex(others: Placed[], ms: number): number {
  let index = 0
  for (const item of others) {
    if (ms < item.startMs + item.spanMs / 2) break
    index += 1
  }
  return index
}

const MIN_SPAN_MS = 400
const SNAP_MS = 100
const DRAG_THRESHOLD_PX = 3
const ZOOM_LIMITS = { min: 4, max: 200 }

const snap = (ms: number) => Math.round(ms / SNAP_MS) * SNAP_MS

type Gesture =
  | { kind: 'move'; shotId: string; originX: number }
  | {
      kind: 'trim'
      shotId: string
      edge: 'start' | 'end'
      originX: number
      from: { start: number; end: number }
    }

/**
 * The strip that presents a Sequence for editing.
 *
 * Horizontal space is time: a Shot is drawn as wide as it is long, at a
 * pixels-per-second scale the zoom control changes. That is what makes a
 * Shot's edges mean something to grab (ADR 0004).
 *
 * Every gesture is a pointer event resolved through the same time-to-pixel
 * scale, following the pattern `ClipEditor` already uses for image Overlays.
 * Nothing is sent while a finger is down — a gesture edits local draft state
 * and commits once, on release.
 *
 * Dragging is not reachable by keyboard, so it adds to the controls rather
 * than replacing them: selecting a Shot opens an inspector that can move,
 * trim, reset, and remove it.
 */
export function Timeline({
  shots,
  clips,
  selectedShotId,
  placingClipId,
  onSelect,
  onMove,
  onTrim,
  onPlace,
  onPlaceEnd,
  busy,
}: {
  shots: Shot[]
  clips: Project[]
  selectedShotId: string | null
  placingClipId: string | null
  onSelect: (shotId: string | null) => void
  onMove: (shot: Shot, position: number) => void
  onTrim: (shot: Shot, trim: ShotTrim) => void
  onPlace: (clipId: string, position: number) => void
  onPlaceEnd: () => void
  busy: boolean
}) {
  const [pxPerSec, setPxPerSec] = useState(24)
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null)
  const [draftTrim, setDraftTrim] = useState<{ shotId: string; start: number; end: number } | null>(
    null,
  )
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const trackRef = useRef<HTMLOListElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const dragged = useRef(false)

  // A draft reorders locally while dragging; a draft trim resizes one Shot.
  const ordered = draftOrder
    ? (draftOrder.map((id) => shots.find((shot) => shot.id === id)).filter(Boolean) as Shot[])
    : shots
  const drafted = draftTrim
    ? ordered.map((shot) =>
        shot.id === draftTrim.shotId
          ? { ...shot, trim_start_ms: draftTrim.start, trim_end_ms: draftTrim.end }
          : shot,
      )
    : ordered

  const placed = layout(drafted, clips)
  const totalMs = placed.reduce((sum, item) => sum + item.spanMs, 0)
  const pxOf = (ms: number) => (ms / 1000) * pxPerSec

  function msAtX(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, ((clientX - rect.left) / pxPerSec) * 1000)
  }

  // Placement is a drag that starts in the grid, so the pointer events arrive
  // at the card, not here — the window is the only place both can be seen.
  useEffect(() => {
    if (!placingClipId) return
    const track = trackRef.current

    function over(event: PointerEvent) {
      const rect = track?.getBoundingClientRect()
      return Boolean(
        rect &&
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      )
    }

    function move(event: PointerEvent) {
      setDropIndex(over(event) ? insertionIndex(placed, msAtX(event.clientX)) : null)
    }

    function up(event: PointerEvent) {
      if (over(event)) onPlace(placingClipId!, insertionIndex(placed, msAtX(event.clientX)))
      setDropIndex(null)
      onPlaceEnd()
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  })

  function begin(event: React.PointerEvent<HTMLElement>, next: Gesture) {
    if (busy) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragged.current = false
    gesture.current = next
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const current = gesture.current
    if (!current) return
    if (Math.abs(event.clientX - current.originX) > DRAG_THRESHOLD_PX) dragged.current = true
    if (!dragged.current) return

    if (current.kind === 'move') {
      const others = placed.filter((item) => item.shot.id !== current.shotId)
      const target = insertionIndex(others, msAtX(event.clientX))
      const without = ordered.filter((shot) => shot.id !== current.shotId)
      const moving = ordered.find((shot) => shot.id === current.shotId)
      if (!moving) return
      const next = [...without]
      next.splice(target, 0, moving)
      setDraftOrder(next.map((shot) => shot.id))
      return
    }

    const item = placed.find((entry) => entry.shot.id === current.shotId)
    if (!item) return
    const deltaMs = snap(((event.clientX - current.originX) / pxPerSec) * 1000)
    const limit = item.clip.duration_ms ?? current.from.end
    const next =
      current.edge === 'start'
        ? {
            start: Math.min(current.from.end - MIN_SPAN_MS, Math.max(0, current.from.start + deltaMs)),
            end: current.from.end,
          }
        : {
            start: current.from.start,
            end: Math.max(current.from.start + MIN_SPAN_MS, Math.min(limit, current.from.end + deltaMs)),
          }
    setDraftTrim({ shotId: current.shotId, ...next })
  }

  function onPointerUp() {
    const current = gesture.current
    gesture.current = null
    if (!current) return

    if (!dragged.current) {
      // A click, not a drag. Selecting is what a click means.
      setDraftOrder(null)
      setDraftTrim(null)
      onSelect(current.shotId)
      return
    }

    const shot = shots.find((item) => item.id === current.shotId)
    if (current.kind === 'move' && draftOrder && shot) {
      const from = shots.findIndex((item) => item.id === current.shotId)
      const to = draftOrder.indexOf(current.shotId)
      if (to >= 0 && to !== from) onMove(shot, to)
    }
    if (current.kind === 'trim' && draftTrim && shot) {
      // Only the edge that moved is sent, so the other stays as it was —
      // following the Clip if it was following the Clip.
      onTrim(
        shot,
        current.edge === 'start'
          ? { trim_start_ms: draftTrim.start }
          : { trim_end_ms: draftTrim.end },
      )
    }
    setDraftOrder(null)
    setDraftTrim(null)
  }

  if (!shots.length) {
    return (
      <p className="timeline-empty">
        Nothing on the timeline yet. Add clips from below and they play in the order
        you put them here.
      </p>
    )
  }

  // Ticks land on a round interval wide enough to read at this zoom.
  const stepSec = [1, 2, 5, 10, 15, 30, 60, 120].find((step) => step * pxPerSec >= 64) ?? 120
  const ticks: number[] = []
  for (let second = 0; second * 1000 <= totalMs; second += stepSec) ticks.push(second)

  return (
    <div className="sequence">
      <div className="sequence__bar">
        <span className="sequence__total">
          {shots.length} {shots.length === 1 ? 'shot' : 'shots'} · {formatTime(totalMs)}
        </span>
        <span className="sequence__zoom">
          <button
            className="icon-button"
            type="button"
            onClick={() => setPxPerSec((value) => Math.max(ZOOM_LIMITS.min, value / 1.5))}
            disabled={pxPerSec <= ZOOM_LIMITS.min}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <ZoomOut size={15} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => setPxPerSec((value) => Math.min(ZOOM_LIMITS.max, value * 1.5))}
            disabled={pxPerSec >= ZOOM_LIMITS.max}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <ZoomIn size={15} />
          </button>
        </span>
      </div>

      <div className="sequence__scroll">
        <div className="sequence__inner" style={{ width: Math.max(pxOf(totalMs), 240) }}>
          <div className="sequence__ruler" aria-hidden="true">
            {ticks.map((second) => (
              <span key={second} style={{ left: pxOf(second * 1000) }}>
                {formatTime(second * 1000)}
              </span>
            ))}
          </div>

          <ol className="sequence__track" aria-label="Timeline" ref={trackRef}>
            {placed.map((item, index) => {
              const thumbnail = artifact(item.clip, 'thumbnail')
              const selected = item.shot.id === selectedShotId
              const overridden =
                item.shot.trim_start_ms !== null || item.shot.trim_end_ms !== null
              const width = pxOf(item.spanMs)
              return (
                <li
                  className={`sequence__shot ${selected ? 'is-selected' : ''}`}
                  key={item.shot.id}
                  style={{ left: pxOf(item.startMs), width }}
                >
                  <button
                    className="sequence__shot-body"
                    type="button"
                    onPointerDown={(event) =>
                      begin(event, {
                        kind: 'move',
                        shotId: item.shot.id,
                        originX: event.clientX,
                      })
                    }
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onFocus={() => onSelect(item.shot.id)}
                    aria-label={`${item.clip.title}, shot ${index + 1} of ${placed.length}, ${
                      formatTime(item.spanMs)
                    }${overridden ? ', trimmed on the timeline' : ''}`}
                  >
                    {width > 44 && (
                      <span className="sequence__shot-thumb" aria-hidden="true">
                        {thumbnail ? <img src={thumbnail} alt="" /> : <Clapperboard size={14} />}
                      </span>
                    )}
                    {width > 96 && (
                      <span className="sequence__shot-text">
                        <strong>{item.clip.title}</strong>
                        <small>
                          {formatTime(item.spanMs)}
                          {overridden ? ' · trimmed' : ''}
                        </small>
                      </span>
                    )}
                  </button>
                  <span
                    className="sequence__handle sequence__handle--start"
                    aria-hidden="true"
                    onPointerDown={(event) => {
                      const { start, end } = shotTrim(item.shot, item.clip)
                      begin(event, {
                        kind: 'trim',
                        shotId: item.shot.id,
                        edge: 'start',
                        originX: event.clientX,
                        from: { start, end },
                      })
                    }}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                  />
                  <span
                    className="sequence__handle sequence__handle--end"
                    aria-hidden="true"
                    onPointerDown={(event) => {
                      const { start, end } = shotTrim(item.shot, item.clip)
                      begin(event, {
                        kind: 'trim',
                        shotId: item.shot.id,
                        edge: 'end',
                        originX: event.clientX,
                        from: { start, end },
                      })
                    }}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                  />
                </li>
              )
            })}
            {dropIndex !== null && (
              <i
                className="sequence__drop"
                style={{ left: pxOf(placed[dropIndex]?.startMs ?? totalMs) }}
                aria-hidden="true"
              />
            )}
          </ol>
        </div>
      </div>
    </div>
  )
}
