import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Image, Maximize2, Trash2 } from 'lucide-react'
import { formatTime } from '../../lib/format'
import type { BatchMedia, BatchMediaPatch } from '../../types'

const MIN_MEDIA_MS = 400
const SNAP_MS = 100
const DRAG_THRESHOLD_PX = 3
const ROW_PX = 40

type Gesture =
  | { kind: 'move'; mediaId: string; originX: number; grabMs: number }
  | {
      kind: 'trim'
      mediaId: string
      edge: 'start' | 'end'
      originX: number
      from: { start: number; end: number }
    }

const snap = (ms: number) => Math.round(ms / SNAP_MS) * SNAP_MS

function slotsFor(media: BatchMedia[]) {
  const availableAt: number[] = []
  const slots = new Map<string, number>()
  for (const item of [...media].sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms)) {
    let slot = availableAt.findIndex((end) => end <= item.start_ms)
    if (slot < 0) slot = availableAt.length
    slots.set(item.id, slot)
    availableAt[slot] = item.end_ms
  }
  return slots
}

export type MediaSpan = Pick<BatchMedia, 'start_ms' | 'end_ms'>

export function MediaTrack({
  media,
  selectedMediaId,
  pxPerSec,
  totalMs,
  onSelect,
  onChange,
  onRemove,
  busy,
}: {
  media: BatchMedia[]
  selectedMediaId: string | null
  pxPerSec: number
  totalMs: number
  onSelect: (mediaId: string | null) => void
  onChange: (media: BatchMedia, patch: BatchMediaPatch) => void
  onRemove: (media: BatchMedia) => void
  busy: boolean
}) {
  const [draft, setDraft] = useState<{ mediaId: string; start: number; end: number } | null>(null)
  const [menu, setMenu] = useState<{ mediaId: string; x: number; y: number } | null>(null)
  const laneRef = useRef<HTMLOListElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const dragged = useRef(false)

  const pxOf = (ms: number) => (ms / 1000) * pxPerSec
  const drafted = media.map((item) =>
    draft?.mediaId === item.id
      ? { ...item, start_ms: draft.start, end_ms: draft.end }
      : item,
  )
  const slots = slotsFor(drafted)
  const rows = Math.max(0, ...slots.values()) + 1

  function msAtX(clientX: number) {
    const rect = laneRef.current?.getBoundingClientRect()
    return rect ? Math.max(0, ((clientX - rect.left) / pxPerSec) * 1000) : 0
  }

  function begin(event: React.PointerEvent<HTMLElement>, next: Gesture) {
    if (busy || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    gesture.current = next
    dragged.current = false
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const current = gesture.current
    if (!current) return
    if (Math.abs(event.clientX - current.originX) > DRAG_THRESHOLD_PX) dragged.current = true
    if (!dragged.current) return
    const item = media.find((entry) => entry.id === current.mediaId)
    if (!item) return

    if (current.kind === 'move') {
      const span = item.end_ms - item.start_ms
      const start = Math.max(0, Math.min(snap(msAtX(event.clientX) - current.grabMs), totalMs - span))
      setDraft({ mediaId: item.id, start, end: start + span })
      return
    }

    const delta = snap(((event.clientX - current.originX) / pxPerSec) * 1000)
    setDraft({
      mediaId: item.id,
      ...(current.edge === 'start'
        ? {
            start: Math.min(current.from.end - MIN_MEDIA_MS, Math.max(0, current.from.start + delta)),
            end: current.from.end,
          }
        : {
            start: current.from.start,
            end: Math.min(totalMs, Math.max(current.from.start + MIN_MEDIA_MS, current.from.end + delta)),
          }),
    })
  }

  function onPointerUp() {
    const current = gesture.current
    gesture.current = null
    if (!current) return
    const item = media.find((entry) => entry.id === current.mediaId)
    if (!dragged.current) {
      setDraft(null)
      onSelect(current.mediaId)
      return
    }
    if (item && draft?.mediaId === item.id) {
      const patch: BatchMediaPatch = {}
      if (draft.start !== item.start_ms) patch.start_ms = draft.start
      if (draft.end !== item.end_ms) patch.end_ms = draft.end
      if (Object.keys(patch).length) onChange(item, patch)
    }
    setDraft(null)
  }

  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector('button')?.focus()
    function dismiss(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null)
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', keydown)
    }
  }, [menu])

  const menuItem = media.find((item) => item.id === menu?.mediaId) ?? null

  return (
    <ol
      className="sequence__media"
      aria-label="Media"
      ref={laneRef}
      style={{ height: Math.min(126, rows * ROW_PX + 6) }}
    >
      {drafted.map((item) => {
        const selected = item.id === selectedMediaId
        const width = pxOf(item.end_ms - item.start_ms)
        return (
          <li
            className={`sequence__media-item ${selected ? 'is-selected' : ''}`}
            key={item.id}
            style={{ left: pxOf(item.start_ms), top: (slots.get(item.id) ?? 0) * ROW_PX, width }}
          >
            <button
              className="sequence__media-body"
              type="button"
              onPointerDown={(event) =>
                begin(event, {
                  kind: 'move',
                  mediaId: item.id,
                  originX: event.clientX,
                  grabMs: msAtX(event.clientX) - item.start_ms,
                })
              }
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onFocus={() => onSelect(item.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                onSelect(item.id)
                setMenu({ mediaId: item.id, x: event.clientX, y: event.clientY })
              }}
              aria-label={`${item.name}, ${formatTime(item.start_ms)} to ${formatTime(item.end_ms)}`}
            >
              {width > 28 && <Image size={12} aria-hidden="true" />}
              {width > 70 && <span>{item.name}</span>}
            </button>
            <span
              className="sequence__handle sequence__handle--start"
              aria-hidden="true"
              onPointerDown={(event) =>
                begin(event, {
                  kind: 'trim',
                  mediaId: item.id,
                  edge: 'start',
                  originX: event.clientX,
                  from: { start: item.start_ms, end: item.end_ms },
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
                  mediaId: item.id,
                  edge: 'end',
                  originX: event.clientX,
                  from: { start: item.start_ms, end: item.end_ms },
                })
              }
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          </li>
        )
      })}

      {menu && menuItem &&
        createPortal(
          <div
            className="timeline-context-menu"
            ref={menuRef}
            role="menu"
            aria-label={`Image options for ${menuItem.name}`}
            style={{
              left: Math.max(8, Math.min(menu.x, window.innerWidth - 220)),
              top: Math.max(8, Math.min(menu.y, window.innerHeight - 100)),
            }}
          >
            <button
              type="button"
              role="menuitem"
              disabled={busy || (menuItem.start_ms === 0 && menuItem.end_ms === totalMs)}
              onClick={() => {
                onChange(menuItem, { start_ms: 0, end_ms: totalMs })
                setMenu(null)
              }}
            >
              <Maximize2 size={14} />
              <span>Fill entire timeline</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              disabled={busy}
              onClick={() => {
                onRemove(menuItem)
                setMenu(null)
              }}
            >
              <Trash2 size={14} />
              <span>Remove image</span>
            </button>
          </div>,
          document.body,
        )}
    </ol>
  )
}
