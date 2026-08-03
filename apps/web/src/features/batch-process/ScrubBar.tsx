import { useRef } from 'react'
import { formatTime } from '../../lib/format'
import type { Placed, PlacedCutaway } from './Timeline'

/**
 * The whole Sequence, always, under the Player.
 *
 * This duplicates a playhead the Timeline already draws, deliberately. The
 * Timeline zooms: while you are trimming a Shot at 200 pixels per second the
 * rest of the Sequence is off screen, and there is nothing left saying where
 * you are in the finished video. This bar never zooms, so it always answers
 * that. Both write the same `playheadMs`, so they cannot disagree.
 *
 * Shot joins are ticked and Cutaway spans are shaded, which makes it a map of
 * the cut rather than a bare progress bar.
 */
export function ScrubBar({
  placed,
  cutaways,
  totalMs,
  playheadMs,
  onScrub,
}: {
  placed: Placed[]
  cutaways: PlacedCutaway[]
  totalMs: number
  playheadMs: number
  onScrub: (ms: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const at = totalMs > 0 ? Math.min(playheadMs, totalMs) : 0
  const percent = totalMs > 0 ? (at / totalMs) * 100 : 0

  /** Where a pointer landed, as a point on the Sequence. */
  function scrubTo(clientX: number) {
    const track = trackRef.current
    if (!track || totalMs <= 0) return
    const box = track.getBoundingClientRect()
    if (box.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    onScrub(Math.round(ratio * totalMs))
  }

  /** One step of the arrow keys: a second, or a tenth of a short Sequence. */
  const step = Math.max(100, Math.min(1000, Math.round(totalMs / 10)))

  return (
    <div
      ref={trackRef}
      className="scrub"
      role="slider"
      tabIndex={0}
      aria-label="Sequence position"
      aria-valuemin={0}
      aria-valuemax={Math.round(totalMs)}
      aria-valuenow={Math.round(at)}
      aria-valuetext={`${formatTime(at)} of ${formatTime(totalMs)}`}
      onPointerDown={(event) => {
        if (totalMs <= 0) return
        dragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        scrubTo(event.clientX)
      }}
      onPointerMove={(event) => {
        if (dragging.current) scrubTo(event.clientX)
      }}
      onPointerUp={(event) => {
        dragging.current = false
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
      onKeyDown={(event) => {
        if (totalMs <= 0) return
        if (event.key === 'ArrowLeft') onScrub(Math.max(0, at - step))
        else if (event.key === 'ArrowRight') onScrub(Math.min(totalMs, at + step))
        else if (event.key === 'Home') onScrub(0)
        else if (event.key === 'End') onScrub(totalMs)
        else return
        // Only swallow the keys actually used, so the page keymap still sees
        // everything else.
        event.preventDefault()
      }}
    >
      <div className="scrub__track">
        <div className="scrub__played" style={{ width: `${percent}%` }} />
        {/* Shaded where a Cutaway takes over the picture. */}
        {totalMs > 0 &&
          cutaways.map((item) => (
            <span
              key={item.cutaway.id}
              className="scrub__cutaway"
              style={{
                left: `${(item.startMs / totalMs) * 100}%`,
                width: `${(item.spanMs / totalMs) * 100}%`,
              }}
            />
          ))}
        {/* A tick at every join. The first Shot's start is the bar's own edge. */}
        {totalMs > 0 &&
          placed.slice(1).map((item) => (
            <span
              key={item.shot.id}
              className="scrub__join"
              style={{ left: `${(item.startMs / totalMs) * 100}%` }}
            />
          ))}
        <span className="scrub__head" style={{ left: `${percent}%` }} />
      </div>
    </div>
  )
}
