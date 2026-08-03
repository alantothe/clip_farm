import { useRef, useState } from 'react'
import { Type } from 'lucide-react'
import { formatTime } from '../../lib/format'
import type { Title } from '../../types'

/** The floor a Title can be dragged to, matching a Shot's (`MIN_SPAN_MS`). */
const MIN_TITLE_MS = 400
const SNAP_MS = 100
const DRAG_THRESHOLD_PX = 3

const snap = (ms: number) => Math.round(ms / SNAP_MS) * SNAP_MS

/** What a Title edit sends: the edge that moved, or where the whole thing lands. */
export type TitleSpan = { start_ms?: number; end_ms?: number }

type Gesture =
  | { kind: 'move'; titleId: string; originX: number; grabMs: number }
  | {
      kind: 'trim'
      titleId: string
      edge: 'start' | 'end'
      originX: number
      from: { start: number; end: number }
    }

/**
 * Where a Title dragged to `ms` lands, kept on the Sequence.
 *
 * A Title before zero would be text the finished video never shows, so the
 * whole span slides rather than the leading edge being clipped — which is what
 * dragging something means.
 */
export function slideTo(ms: number): number {
  return Math.max(0, snap(ms))
}

/**
 * The Title Track: a Batch's Titles, laid out in Sequence time.
 *
 * It is a lane of its own above the Shots because that is what a Title is —
 * text at a time in the finished video, not a property of whatever Shot happens
 * to be underneath. Reordering the Sequence slides the Shots and leaves these
 * where they were written (ADR 0008).
 *
 * Its gestures are its own rather than the Timeline's, because a Title never
 * interacts with a Shot: it does not reorder anything and it anchors to
 * nothing. Dragging one is arithmetic on a start time.
 */
export function TitleTrack({
  titles,
  selectedTitleId,
  pxPerSec,
  totalMs,
  playheadMs,
  onSelect,
  onMove,
  onTrim,
  onAdd,
  busy,
}: {
  titles: Title[]
  selectedTitleId: string | null
  pxPerSec: number
  totalMs: number
  playheadMs: number
  onSelect: (titleId: string | null) => void
  onMove: (title: Title, span: TitleSpan) => void
  onTrim: (title: Title, span: TitleSpan) => void
  onAdd: (atMs: number) => void
  busy: boolean
}) {
  const [draft, setDraft] = useState<{ titleId: string; start: number; end: number } | null>(null)
  const laneRef = useRef<HTMLOListElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const dragged = useRef(false)

  const pxOf = (ms: number) => (ms / 1000) * pxPerSec
  const drafted = titles.map((title) =>
    draft?.titleId === title.id
      ? { ...title, start_ms: draft.start, end_ms: draft.end }
      : title,
  )

  function msAtX(clientX: number) {
    const rect = laneRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, ((clientX - rect.left) / pxPerSec) * 1000)
  }

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

    const title = titles.find((item) => item.id === current.titleId)
    if (!title) return

    if (current.kind === 'move') {
      const start = slideTo(msAtX(event.clientX) - current.grabMs)
      setDraft({
        titleId: title.id,
        start,
        end: start + (title.end_ms - title.start_ms),
      })
      return
    }

    const deltaMs = snap(((event.clientX - current.originX) / pxPerSec) * 1000)
    setDraft({
      titleId: title.id,
      ...(current.edge === 'start'
        ? {
            start: Math.min(
              current.from.end - MIN_TITLE_MS,
              Math.max(0, current.from.start + deltaMs),
            ),
            end: current.from.end,
          }
        : {
            start: current.from.start,
            end: Math.max(current.from.start + MIN_TITLE_MS, current.from.end + deltaMs),
          }),
    })
  }

  function onPointerUp() {
    const current = gesture.current
    gesture.current = null
    if (!current) return

    if (!dragged.current) {
      // A click, not a drag. Selecting is what a click means.
      setDraft(null)
      onSelect(current.titleId)
      return
    }

    const title = titles.find((item) => item.id === current.titleId)
    if (title && draft && draft.titleId === title.id) {
      if (current.kind === 'move') {
        if (draft.start !== title.start_ms) {
          // Both edges travel: a Title dragged along the track keeps its length.
          onMove(title, { start_ms: draft.start, end_ms: draft.end })
        }
      } else if (current.edge === 'start') {
        if (draft.start !== title.start_ms) onTrim(title, { start_ms: draft.start })
      } else if (draft.end !== title.end_ms) {
        onTrim(title, { end_ms: draft.end })
      }
    }
    setDraft(null)
  }

  return (
    <ol className="sequence__titles" aria-label="Titles" ref={laneRef}>
      {drafted.map((title) => {
        const selected = title.id === selectedTitleId
        const width = pxOf(title.end_ms - title.start_ms)
        // A Title can be written past the end of the Sequence — the Shots under
        // it may not have been placed yet — and is marked rather than hidden.
        const orphaned = title.start_ms >= totalMs
        return (
          <li
            className={`sequence__title ${selected ? 'is-selected' : ''} ${
              orphaned ? 'is-orphaned' : ''
            }`}
            key={title.id}
            style={{ left: pxOf(title.start_ms), width }}
          >
            <button
              className="sequence__title-body"
              type="button"
              onPointerDown={(event) =>
                begin(event, {
                  kind: 'move',
                  titleId: title.id,
                  originX: event.clientX,
                  grabMs: msAtX(event.clientX) - title.start_ms,
                })
              }
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onFocus={() => onSelect(title.id)}
              aria-label={`${title.text || 'Empty title'}, ${formatTime(
                title.start_ms,
              )} to ${formatTime(title.end_ms)}${
                orphaned ? ', past the end of the sequence' : ''
              }`}
            >
              {width > 26 && <Type size={11} aria-hidden="true" />}
              {width > 64 && (
                <span className="sequence__title-text">{title.text || 'Empty title'}</span>
              )}
            </button>
            <span
              className="sequence__handle sequence__handle--start"
              aria-hidden="true"
              onPointerDown={(event) =>
                begin(event, {
                  kind: 'trim',
                  titleId: title.id,
                  edge: 'start',
                  originX: event.clientX,
                  from: { start: title.start_ms, end: title.end_ms },
                })
              }
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
            <span
              className="sequence__handle sequence__handle--end"
              aria-hidden="true"
              onPointerDown={(event) =>
                begin(event, {
                  kind: 'trim',
                  titleId: title.id,
                  edge: 'end',
                  originX: event.clientX,
                  from: { start: title.start_ms, end: title.end_ms },
                })
              }
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          </li>
        )
      })}

      {!titles.length && (
        <span className="sequence__titles-hint">
          No text yet. Add some and it plays over whatever is on screen at that moment.
        </span>
      )}

      {/* Dragging is not reachable by keyboard, so adding never is either: the
          button puts a Title at the playhead, and the inspector retimes it. */}
      <button
        className="sequence__titles-add"
        type="button"
        onClick={() => onAdd(playheadMs)}
        disabled={busy}
        title="Add text at the playhead"
      >
        <Type size={11} />
        Add text
      </button>
    </ol>
  )
}
