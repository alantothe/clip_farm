import { useRef, useState } from 'react'
import { Type } from 'lucide-react'
import { formatTime } from '../../lib/format'
import type { Title } from '../../types'

/** The floor a Title can be dragged to, matching a Shot's (`MIN_SPAN_MS`). */
const MIN_TITLE_MS = 400
const SNAP_MS = 100
const DRAG_THRESHOLD_PX = 3
export const MAX_TITLE_SLOTS = 3
export const NEW_TITLE_MS = 3000

/** The editor row assigned to each Title by interval partitioning. */
export function titleSlots(titles: Title[]): Map<string, number> {
  const availableAt = Array.from({ length: MAX_TITLE_SLOTS }, () => -Infinity)
  const slots = new Map<string, number>()
  const ordered = titles
    .map((title, index) => ({ title, index }))
    .sort(
      (a, b) =>
        a.title.start_ms - b.title.start_ms ||
        a.title.end_ms - b.title.end_ms ||
        a.index - b.index,
    )

  for (const { title } of ordered) {
    const open = availableAt.findIndex((endMs) => endMs <= title.start_ms)
    // Old data may contain more than three overlaps. Keep it inside the third
    // row; every new or retimed Title is protected by the API limit.
    const slot = open === -1 ? MAX_TITLE_SLOTS - 1 : open
    slots.set(title.id, slot)
    availableAt[slot] = Math.max(availableAt[slot], title.end_ms)
  }
  return slots
}

/** Whether another half-open Title span fits in the three visible rows. */
export function hasTitleSlot(
  titles: Title[],
  startMs: number,
  endMs: number,
  replacingId?: string,
): boolean {
  const events: [number, number][] = [
    [startMs, 1],
    [endMs, -1],
  ]
  for (const title of titles) {
    if (
      title.id === replacingId ||
      title.start_ms >= endMs ||
      title.end_ms <= startMs
    ) {
      continue
    }
    events.push([Math.max(startMs, title.start_ms), 1])
    events.push([Math.min(endMs, title.end_ms), -1])
  }

  let active = 0
  for (const [, change] of events.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    active += change
    if (active > MAX_TITLE_SLOTS) return false
  }
  return true
}

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
 * A Title outside the Sequence would be text the finished video never shows, so
 * both ends hold it: the whole span slides rather than an edge being clipped,
 * which is what dragging something means. `latest` is the last start that keeps
 * the Title's own length on the strip, and is ignored when there is no room for
 * it — a Title longer than the Sequence still starts at zero.
 */
export function slideTo(ms: number, latest = Infinity): number {
  const at = snap(ms)
  return Math.max(0, Number.isFinite(latest) ? Math.min(at, snap(latest)) : at)
}

/** A Title lying entirely past the end still needs somewhere to be grabbed. */
const ORPHAN_PX = 14

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
  const slots = titleSlots(drafted)
  const canAdd = hasTitleSlot(titles, playheadMs, playheadMs + NEW_TITLE_MS)

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
      const span = title.end_ms - title.start_ms
      const start = slideTo(msAtX(event.clientX) - current.grabMs, totalMs - span)
      setDraft({ titleId: title.id, start, end: start + span })
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
            end: Math.min(
              Math.max(current.from.start + MIN_TITLE_MS, current.from.end + deltaMs),
              // The end of the Sequence is the end of the video: text dragged
              // past it would render as nothing.
              Math.max(current.from.start + MIN_TITLE_MS, totalMs),
            ),
            start: current.from.start,
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
        // The lane is exactly the Sequence long, so a Title is drawn clipped to
        // it: what runs past the end renders as nothing, and saying so is the
        // job of the marking rather than of extra track. Shortening the
        // Sequence is what usually strands one, so it keeps a grabbable sliver
        // at the end instead of vanishing.
        const clipped = title.end_ms > totalMs
        const orphaned = title.start_ms >= totalMs
        const start = Math.min(title.start_ms, totalMs)
        const width = orphaned
          ? ORPHAN_PX
          : pxOf(Math.min(title.end_ms, totalMs) - start)
        return (
          <li
            className={`sequence__title ${selected ? 'is-selected' : ''} ${
              orphaned ? 'is-orphaned' : ''
            } ${clipped ? 'is-clipped' : ''}`}
            key={title.id}
            style={{
              left: Math.max(0, orphaned ? pxOf(totalMs) - ORPHAN_PX : pxOf(start)),
              top: (slots.get(title.id) ?? 0) * 24,
              width,
            }}
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
                orphaned
                  ? ', past the end of the sequence'
                  : clipped
                    ? ', clipped to the end of the sequence'
                    : ''
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
        disabled={busy || !canAdd}
        title={
          canAdd
            ? 'Add text at the playhead'
            : `All ${MAX_TITLE_SLOTS} text slots are occupied here`
        }
      >
        <Type size={11} />
        Add text
      </button>
    </ol>
  )
}
