import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Clapperboard, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { formatTime } from '../../lib/format'
import { artifact } from '../../lib/project'
import type { BatchMedia, BatchMediaPatch, Cutaway, Project, Shot, ShotTrim, Title } from '../../types'
import { MediaTrack } from './MediaTrack'
import { TitleTrack } from './TitleTrack'
import type { TitleSpan } from './TitleTrack'

/** Everything with a Trim of its own: a Shot, or a Cutaway. */
type Trimmed = { trim_start_ms: number | null; trim_end_ms: number | null }

/** The span a Shot plays: its own Trim, falling back to its Clip's. */
export function shotTrim(shot: Trimmed, clip: Project) {
  return {
    start: shot.trim_start_ms ?? clip.trim_start_ms,
    end: shot.trim_end_ms ?? clip.trim_end_ms ?? clip.duration_ms ?? 0,
  }
}

export function shotSpanMs(shot: Trimmed, clip: Project): number {
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
export type Placed = { shot: Shot; clip: Project; startMs: number; spanMs: number }

/** Gapless: each Shot starts where the one before it ended. */
export function layout(shots: Shot[], clips: Project[]): Placed[] {
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

/** Which Shot is playing at a point on the Sequence, and where inside it. */
export function shotAt(placed: Placed[], ms: number): { item: Placed; intoShotMs: number } | null {
  for (const item of placed) {
    if (ms < item.startMs + item.spanMs) {
      return { item, intoShotMs: Math.max(0, ms - item.startMs) }
    }
  }
  // Past the end: hold on the last frame rather than reporting nothing.
  const last = placed[placed.length - 1]
  return last ? { item: last, intoShotMs: last.spanMs } : null
}

/**
 * Where to seek a Clip's Source Video for a point inside its Shot.
 *
 * The preview Artifact is the whole Source Video, so a Shot that starts three
 * seconds in plays from three seconds in — the Trim is an offset, not a cut.
 */
export function sourceTimeMs(item: Placed, intoShotMs: number): number {
  return shotTrim(item.shot, item.clip).start + intoShotMs
}

export const MIN_SPAN_MS = 400
const SNAP_MS = 100
const DRAG_THRESHOLD_PX = 3
const ZOOM_LIMITS = { min: 4, max: 200 }

const snap = (ms: number) => Math.round(ms / SNAP_MS) * SNAP_MS

/**
 * Where a Trim edge dragged by `deltaMs` lands, and what it took off the head.
 *
 * Each edge moves alone: dragging the front changes where the span starts and
 * leaves its end exactly where it was, and dragging the back does the mirror of
 * that. Neither may cross the other closer than `MIN_SPAN_MS`, and neither may
 * leave the Source Video — `floor` is the earliest the front may go and
 * `ceiling` the latest the back may.
 *
 * `shiftMs` is how much of the head the gesture took: positive when the front
 * was cut away, negative when it was pulled back out, zero for a back edge. It
 * is what tells the head trim apart from the tail one — the Timeline draws the
 * gesture with it, and a Cutaway's offset moves by it so its tail holds still.
 */
export function trimTo(
  from: { start: number; end: number },
  edge: 'start' | 'end',
  deltaMs: number,
  bounds: { floor: number; ceiling: number },
): { start: number; end: number; shiftMs: number } {
  if (edge === 'end') {
    return {
      start: from.start,
      end: Math.max(from.start + MIN_SPAN_MS, Math.min(bounds.ceiling, from.end + deltaMs)),
      shiftMs: 0,
    }
  }
  const start = Math.min(from.end - MIN_SPAN_MS, Math.max(bounds.floor, from.start + deltaMs))
  return { start, end: from.end, shiftMs: start - from.start }
}

/** A Cutaway drawn on the lane: where it starts on the Sequence, and how long. */
export type PlacedCutaway = {
  cutaway: Cutaway
  clip: Project
  startMs: number
  spanMs: number
  /** True when its Base Shot has been trimmed shorter than the Cutaway needs. */
  overflows: boolean
}

/**
 * Cutaways positioned against the Sequence.
 *
 * A Cutaway is anchored to its Base Shot, so where it lands is that Shot's
 * start plus the offset — which is exactly why reordering carries it along.
 */
export function layoutCutaways(
  cutaways: Cutaway[],
  placed: Placed[],
  clips: Project[],
): PlacedCutaway[] {
  const result: PlacedCutaway[] = []
  for (const cutaway of cutaways) {
    const base = placed.find((item) => item.shot.id === cutaway.base_shot_id)
    const clip = clips.find((item) => item.id === cutaway.clip_id)
    if (!base || !clip) continue
    const wanted = shotSpanMs(cutaway, clip)
    const room = Math.max(0, base.spanMs - cutaway.offset_ms)
    result.push({
      cutaway,
      clip,
      startMs: base.startMs + Math.min(cutaway.offset_ms, base.spanMs),
      spanMs: Math.min(wanted, room),
      overflows: wanted > room,
    })
  }
  return result
}

/** Where a Cutaway dragged to `ms` lands: which Shot it covers, and how far in. */
export function anchorAt(
  placed: Placed[],
  ms: number,
  spanMs: number,
): { baseShotId: string; offsetMs: number } | null {
  const host =
    placed.find((item) => ms >= item.startMs && ms < item.startMs + item.spanMs) ??
    placed[placed.length - 1]
  if (!host) return null
  const offset = Math.min(Math.max(0, ms - host.startMs), Math.max(0, host.spanMs - spanMs))
  return { baseShotId: host.shot.id, offsetMs: snap(offset) }
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

type Gesture =
  | { kind: 'move'; shotId: string; originX: number }
  | { kind: 'scrub'; originX: number }
  | { kind: 'cutaway-move'; shotId: string; originX: number; grabMs: number }
  | {
      kind: 'trim'
      shotId: string
      edge: 'start' | 'end'
      originX: number
      from: { start: number; end: number }
    }

type TimelineContextMenu = { itemId: string; x: number; y: number }

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
  cutaways,
  clips,
  titles,
  media,
  selectedShotId,
  selectedTitleId,
  selectedMediaId,
  placingClipId,
  playheadMs,
  onScrub,
  onSelect,
  onSelectTitle,
  onSelectMedia,
  onMove,
  onTrim,
  onRemove,
  onPlace,
  onMoveCutaway,
  onTrimCutaway,
  onPlaceCutaway,
  onPlaceEnd,
  onMoveTitle,
  onTrimTitle,
  onRemoveTitle,
  onChangeMedia,
  onRemoveMedia,
  busy,
}: {
  shots: Shot[]
  cutaways: Cutaway[]
  clips: Project[]
  titles: Title[]
  media: BatchMedia[]
  selectedShotId: string | null
  selectedTitleId: string | null
  selectedMediaId: string | null
  placingClipId: string | null
  playheadMs: number
  onScrub: (ms: number) => void
  onSelect: (shotId: string | null) => void
  onSelectTitle: (titleId: string | null) => void
  onSelectMedia: (mediaId: string | null) => void
  onMove: (shot: Shot, position: number) => void
  onTrim: (shot: Shot, trim: ShotTrim) => void
  onRemove: (shot: Shot | Cutaway) => void
  onPlace: (clipId: string, position: number) => void
  onMoveCutaway: (cutaway: Cutaway, baseShotId: string, offsetMs: number) => void
  onTrimCutaway: (cutaway: Cutaway, trim: ShotTrim) => void
  onPlaceCutaway: (clipId: string, baseShotId: string, offsetMs: number) => void
  onPlaceEnd: () => void
  onMoveTitle: (title: Title, span: TitleSpan) => void
  onTrimTitle: (title: Title, span: TitleSpan) => void
  onRemoveTitle: (title: Title) => void
  onChangeMedia: (media: BatchMedia, patch: BatchMediaPatch) => void
  onRemoveMedia: (media: BatchMedia) => void
  busy: boolean
}) {
  const [pxPerSec, setPxPerSec] = useState(24)
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null)
  const [draftTrim, setDraftTrim] = useState<
    { shotId: string; start: number; end: number; shiftMs: number } | null
  >(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [draftAnchor, setDraftAnchor] = useState<
    { cutawayId: string; baseShotId: string; offsetMs: number } | null
  >(null)
  const [coverDrop, setCoverDrop] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<TimelineContextMenu | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLOListElement>(null)
  const coverRef = useRef<HTMLOListElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const dragged = useRef(false)
  const fitted = useRef(false)

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
  // A Cutaway is trimmed and dragged with the same gestures, so the same drafts
  // apply to it — its id is what tells which list an in-flight edit belongs to.
  const draftedCutaways = cutaways.map((cutaway) => {
    let next = cutaway
    if (draftTrim?.shotId === cutaway.id) {
      next = { ...next, trim_start_ms: draftTrim.start, trim_end_ms: draftTrim.end }
    }
    if (draftAnchor?.cutawayId === cutaway.id) {
      next = { ...next, base_shot_id: draftAnchor.baseShotId, offset_ms: draftAnchor.offsetMs }
    }
    return next
  })
  const placedCutaways = layoutCutaways(draftedCutaways, placed, clips)
  const totalMs = placed.reduce((sum, item) => sum + item.spanMs, 0)
  const pxOf = (ms: number) => (ms / 1000) * pxPerSec

  /**
   * How far a head trim in flight pushes what comes after it.
   *
   * Shots are gapless (ADR 0004), so cutting one's front makes everything after
   * it play earlier. Rippling that while the finger is still down would slide
   * the Sequence out from under the pointer and — because a Shot is drawn from
   * where it starts, not from what it contains — would look exactly like cutting
   * its back: the same edge would move either way, which is why trimming from
   * the front appeared not to work at all. So during the gesture the cut is
   * drawn where it is being made. The head follows the pointer, the back of the
   * Shot and everything after it hold still, and the ripple lands on release.
   *
   * Only cutting is drawn this way. Pulling a head back out needs room that the
   * Shot before it is occupying, and a Shot drawn over its neighbour reads as a
   * bug — so that direction grows to the right, as it did before.
   */
  const shiftMs = draftTrim?.shiftMs ?? 0
  const shiftedFrom = draftTrim
    ? placed.findIndex((item) => item.shot.id === draftTrim.shotId)
    : -1
  const rippleShiftPx = shiftedFrom >= 0 ? Math.max(0, pxOf(shiftMs)) : 0
  /** A Cutaway rides on its Base Shot, and shifts with it — or on its own. */
  const shiftOf = (baseShotId: string, cutawayId: string) => {
    if (draftTrim?.shotId === cutawayId) return pxOf(shiftMs)
    const index = placed.findIndex((item) => item.shot.id === baseShotId)
    return index >= 0 && index >= shiftedFrom ? rippleShiftPx : 0
  }

  function msAtX(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, ((clientX - rect.left) / pxPerSec) * 1000)
  }

  /**
   * The strip is exactly as long as the Sequence, so a short one would open as
   * a stub in a wide panel. The scale is fitted to the panel once, when the
   * Sequence first has a length — after that the zoom control is the operator's
   * and nothing moves it under them.
   */
  useLayoutEffect(() => {
    if (fitted.current || totalMs <= 0) return
    const width = scrollRef.current?.clientWidth
    if (!width) return
    fitted.current = true
    // Short of the full width, so the end of the strip is visibly an end rather
    // than something the panel cut off — and so the playhead has somewhere to
    // sit when it gets there.
    const perSec = (Math.max(120, width - 12) / totalMs) * 1000
    setPxPerSec(Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, perSec)))
  }, [totalMs])

  // Placement is a drag that starts in the grid, so the pointer events arrive
  // at the card, not here — the window is the only place both can be seen.
  useEffect(() => {
    if (!placingClipId) return
    const clip = clips.find((item) => item.id === placingClipId)

    function over(element: Element | null, event: PointerEvent) {
      const rect = element?.getBoundingClientRect()
      return Boolean(
        rect &&
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      )
    }

    function move(event: PointerEvent) {
      const ms = msAtX(event.clientX)
      setCoverDrop(over(coverRef.current, event) ? ms : null)
      setDropIndex(over(trackRef.current, event) ? insertionIndex(placed, ms) : null)
    }

    function up(event: PointerEvent) {
      const ms = msAtX(event.clientX)
      if (over(coverRef.current, event) && clip) {
        // Dropped on the cover lane: it covers whichever Shot is under it.
        const anchor = anchorAt(placed, ms, shotSpanMs(clip as unknown as Trimmed, clip))
        if (anchor) onPlaceCutaway(placingClipId!, anchor.baseShotId, anchor.offsetMs)
      } else if (over(trackRef.current, event)) {
        onPlace(placingClipId!, insertionIndex(placed, ms))
      }
      setDropIndex(null)
      setCoverDrop(null)
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
    if (busy || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragged.current = false
    gesture.current = next
  }

  function openContextMenu(event: React.MouseEvent<HTMLElement>, itemId: string) {
    event.preventDefault()
    event.stopPropagation()
    onSelect(itemId)
    setContextMenu({ itemId, x: event.clientX, y: event.clientY })
  }

  useEffect(() => {
    if (!contextMenu) return
    menuRef.current?.querySelector('button')?.focus()

    function dismiss(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setContextMenu(null)
    }
    function dismissOnKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setContextMenu(null)
    }
    const dismissWithoutEvent = () => setContextMenu(null)

    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', dismissWithoutEvent)
    window.addEventListener('scroll', dismissWithoutEvent, true)
    document.addEventListener('keydown', dismissOnKey)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('resize', dismissWithoutEvent)
      window.removeEventListener('scroll', dismissWithoutEvent, true)
      document.removeEventListener('keydown', dismissOnKey)
    }
  }, [contextMenu])

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const current = gesture.current
    if (!current) return

    // Scrubbing follows the pointer from the first pixel: there is no click to
    // tell it apart from, so no threshold to clear first.
    if (current.kind === 'scrub') {
      onScrub(Math.min(totalMs, msAtX(event.clientX)))
      return
    }

    if (Math.abs(event.clientX - current.originX) > DRAG_THRESHOLD_PX) dragged.current = true
    if (!dragged.current) return

    if (current.kind === 'cutaway-move') {
      const item = placedCutaways.find((entry) => entry.cutaway.id === current.shotId)
      if (!item) return
      const anchor = anchorAt(placed, msAtX(event.clientX) - current.grabMs, item.spanMs)
      if (anchor) {
        setDraftAnchor({
          cutawayId: current.shotId,
          baseShotId: anchor.baseShotId,
          offsetMs: anchor.offsetMs,
        })
      }
      return
    }

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

    const covering = placedCutaways.find((entry) => entry.cutaway.id === current.shotId)
    const item = placed.find((entry) => entry.shot.id === current.shotId) ?? covering
    if (!item) return
    const deltaMs = snap(((event.clientX - current.originX) / pxPerSec) * 1000)
    const next = trimTo(current.from, current.edge, deltaMs, {
      // A Cutaway holds its tail by moving its offset, and an offset cannot go
      // negative — so its head reaches back only as far as its Base Shot starts.
      floor: covering ? Math.max(0, current.from.start - covering.cutaway.offset_ms) : 0,
      ceiling: item.clip.duration_ms ?? current.from.end,
    })
    setDraftTrim({ shotId: current.shotId, ...next })
  }

  function onPointerUp() {
    const current = gesture.current
    gesture.current = null
    if (!current) return

    // Scrubbing commits as it goes and selects nothing.
    if (current.kind === 'scrub') return

    if (!dragged.current) {
      // A click, not a drag. Selecting is what a click means.
      setDraftOrder(null)
      setDraftTrim(null)
      setDraftAnchor(null)
      onSelect(current.shotId)
      return
    }

    const cutaway = cutaways.find((item) => item.id === current.shotId)
    if (current.kind === 'cutaway-move' && draftAnchor && cutaway) {
      if (
        draftAnchor.baseShotId !== cutaway.base_shot_id ||
        draftAnchor.offsetMs !== cutaway.offset_ms
      ) {
        onMoveCutaway(cutaway, draftAnchor.baseShotId, draftAnchor.offsetMs)
      }
    }

    const shot = shots.find((item) => item.id === current.shotId)
    if (current.kind === 'move' && draftOrder && shot) {
      const from = shots.findIndex((item) => item.id === current.shotId)
      const to = draftOrder.indexOf(current.shotId)
      if (to >= 0 && to !== from) onMove(shot, to)
    }
    if (current.kind === 'trim' && draftTrim && cutaway) {
      // Where the offset that keeps a Cutaway's tail still is moved is the
      // caller's business — it is the same rule whichever control asked.
      onTrimCutaway(
        cutaway,
        current.edge === 'start'
          ? { trim_start_ms: draftTrim.start }
          : { trim_end_ms: draftTrim.end },
      )
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
    setDraftAnchor(null)
  }

  if (!shots.length) {
    return (
      <p className="timeline-empty">
        Nothing on the timeline yet. Add clips from the bin on the left and they play in
        the order you put them here.
      </p>
    )
  }

  // Ticks land on a round interval wide enough to read at this zoom.
  const stepSec = [1, 2, 5, 10, 15, 30, 60, 120].find((step) => step * pxPerSec >= 64) ?? 120
  const ticks: number[] = []
  for (let second = 0; second * 1000 <= totalMs; second += stepSec) ticks.push(second)

  const contextShot = shots.find((shot) => shot.id === contextMenu?.itemId) ?? null
  const contextCutaway = cutaways.find((cutaway) => cutaway.id === contextMenu?.itemId) ?? null
  const contextItem = contextShot ?? contextCutaway
  const contextClip = contextItem
    ? clips.find((clip) => clip.id === contextItem.clip_id) ?? null
    : null

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

      <div className="sequence__scroll" ref={scrollRef}>
        {/* Horizontal space is time, and the strip is no exception: it is as
            long as the Sequence and not a pixel longer, so where it ends is
            where the finished video ends (ADR 0004). A Title written past that
            end is drawn clipped to it, because that is what it renders as. */}
        <div
          className="sequence__inner"
          style={{ width: Math.max(pxOf(totalMs) + rippleShiftPx, 1) }}
        >
          <div
            className="sequence__ruler"
            onPointerDown={(event) => {
              begin(event, { kind: 'scrub', originX: event.clientX })
              onScrub(Math.min(totalMs, msAtX(event.clientX)))
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {ticks.map((second) => (
              <span key={second} style={{ left: pxOf(second * 1000) }}>
                {formatTime(second * 1000)}
              </span>
            ))}
          </div>

          {/* Titles ride above the Shots, because that is where they are: text
              at a time in the finished video rather than a property of whatever
              Shot is underneath (ADR 0008). */}
          <TitleTrack
            titles={titles}
            selectedTitleId={selectedTitleId}
            pxPerSec={pxPerSec}
            totalMs={totalMs}
            onSelect={onSelectTitle}
            onMove={onMoveTitle}
            onTrim={onTrimTitle}
            onRemove={onRemoveTitle}
            busy={busy}
          />

          {media.length > 0 && (
            <MediaTrack
              media={media}
              selectedMediaId={selectedMediaId}
              pxPerSec={pxPerSec}
              totalMs={totalMs}
              onSelect={onSelectMedia}
              onChange={onChangeMedia}
              onRemove={onRemoveMedia}
              busy={busy}
            />
          )}

          {placedCutaways.length > 0 && (
            <ol className="sequence__cover" aria-label="Cutaways" ref={coverRef}>
              {placedCutaways.map((item) => {
                const selected = item.cutaway.id === selectedShotId
                const width = pxOf(item.spanMs)
                return (
                  <li
                    className={`sequence__cutaway ${selected ? 'is-selected' : ''} ${
                      item.overflows ? 'is-clipped' : ''
                    }`}
                    key={item.cutaway.id}
                    style={{
                      left:
                        pxOf(item.startMs) + shiftOf(item.cutaway.base_shot_id, item.cutaway.id),
                      width,
                    }}
                  >
                    <button
                      className="sequence__cutaway-body"
                      type="button"
                      onPointerDown={(event) =>
                        begin(event, {
                          kind: 'cutaway-move',
                          shotId: item.cutaway.id,
                          originX: event.clientX,
                          grabMs: msAtX(event.clientX) - item.startMs,
                        })
                      }
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onContextMenu={(event) => openContextMenu(event, item.cutaway.id)}
                      onFocus={() => onSelect(item.cutaway.id)}
                      title="Right-click for cutaway options · Delete to remove"
                      aria-keyshortcuts="Delete Backspace"
                      aria-label={`${item.clip.title}, cutaway covering ${
                        formatTime(item.spanMs)
                      }${item.overflows ? ', clipped to the shot it covers' : ''}`}
                    >
                      {width > 72 && (
                        <span className="sequence__cutaway-text">{item.clip.title}</span>
                      )}
                    </button>
                    <span
                      className="sequence__handle sequence__handle--start"
                      aria-hidden="true"
                      onPointerDown={(event) => {
                        const { start, end } = shotTrim(item.cutaway, item.clip)
                        begin(event, {
                          kind: 'trim',
                          shotId: item.cutaway.id,
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
                        const { start, end } = shotTrim(item.cutaway, item.clip)
                        begin(event, {
                          kind: 'trim',
                          shotId: item.cutaway.id,
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
              {coverDrop !== null && (
                <i className="sequence__drop" style={{ left: pxOf(coverDrop) }} aria-hidden="true" />
              )}
            </ol>
          )}

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
                  style={{
                    left: pxOf(item.startMs) + (index >= shiftedFrom ? rippleShiftPx : 0),
                    width,
                  }}
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
                    onContextMenu={(event) => openContextMenu(event, item.shot.id)}
                    onFocus={() => onSelect(item.shot.id)}
                    title="Right-click for clip options · Delete to remove"
                    aria-keyshortcuts="Delete Backspace"
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

          <i
            className="sequence__playhead"
            style={{ left: pxOf(Math.min(playheadMs, totalMs)) }}
            aria-hidden="true"
          />
        </div>
      </div>

      {contextMenu && contextItem && contextClip &&
        createPortal(
          <div
            className="timeline-context-menu"
            ref={menuRef}
            role="menu"
            aria-label={`${contextCutaway ? 'Cutaway' : 'Clip'} options for ${contextClip.title}`}
            style={{
              left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 228)),
              top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 58)),
            }}
          >
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              disabled={busy}
              onClick={() => {
                onRemove(contextItem)
                setContextMenu(null)
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
              <span>{contextCutaway ? 'Remove cutaway' : 'Remove clip from timeline'}</span>
              <kbd>Del</kbd>
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
