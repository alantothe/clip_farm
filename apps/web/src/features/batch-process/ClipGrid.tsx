import { useRef } from 'react'
import { Clapperboard, Plus, TriangleAlert } from 'lucide-react'
import { Status } from '../../components/Status'
import { formatTime } from '../../lib/format'
import { artifact, projectIsBusy } from '../../lib/project'
import type { Project } from '../../types'

/**
 * Every Clip in a Batch, with the progress of its own Import.
 *
 * Each Clip imports behind its own Job, so the grid shows several bars moving
 * at once rather than one bar for the Batch. Clicking a ready Clip opens it in
 * the editor; a Clip still importing is not yet editable.
 *
 * Adding to the timeline is a separate button rather than part of the card:
 * being in a Batch and being in its Sequence are different decisions, and a
 * card that both opens and places would have to guess which was meant.
 *
 * That button is also the drag handle. Dragging from it drops the Clip at a
 * position on the Timeline; clicking appends. Putting both on one control
 * keeps the gesture discoverable and leaves the card's own click free to mean
 * "open this in the editor", with no threshold to guess at.
 */
export function ClipGrid({
  clips,
  onOpen,
  onAdd,
  onDragToTimeline,
  placedCounts,
  adding,
}: {
  clips: Project[]
  onOpen: (clip: Project) => void
  onAdd: (clip: Project) => void
  onDragToTimeline: (clip: Project) => void
  /** How many Shots each Clip has. A Clip can be placed more than once. */
  placedCounts: Map<string, number>
  adding: boolean
}) {
  // Set once the pointer has travelled far enough for this to be a drag, so
  // releasing over the grid does not also append the Clip.
  const dragging = useRef(false)

  return (
    <ul className="clip-grid" aria-label="Clips in this batch">
      {clips.map((clip) => {
        const thumbnail = artifact(clip, 'thumbnail')
        const busy = projectIsBusy(clip)
        const failed = clip.status === 'failed'
        const job = clip.latest_job
        const placed = placedCounts.get(clip.id) ?? 0
        return (
          <li key={clip.id}>
            <button
              className={`clip-card ${failed ? 'clip-card--failed' : ''}`}
              type="button"
              onClick={() => onOpen(clip)}
              disabled={busy}
              // Named explicitly: the card's contents read as a jumble of
              // status, duration, and progress text.
              aria-label={busy ? `${clip.title} is still importing` : `Edit ${clip.title}`}
              title={busy ? `${clip.title} is still importing` : `Edit ${clip.title}`}
            >
              <span className="clip-card__thumb">
                {thumbnail
                  ? <img src={thumbnail} alt="" />
                  : failed
                    ? <TriangleAlert size={22} />
                    : <Clapperboard size={22} />}
              </span>
              <span className="clip-card__body">
                <strong>{clip.title}</strong>
                <span className="clip-card__meta">
                  <Status value={clip.status} />
                  {clip.duration_ms != null && <small>{formatTime(clip.duration_ms)}</small>}
                </span>
                {busy && job && (
                  <span className="clip-card__progress">
                    <span
                      className="clip-card__progress-bar"
                      style={{ width: `${job.progress}%` }}
                      role="progressbar"
                      aria-valuenow={job.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${clip.title} import progress`}
                    />
                    <small>{job.message}</small>
                  </span>
                )}
                {failed && <small className="clip-card__error">{job?.message || 'Import failed'}</small>}
              </span>
            </button>
            <span className="clip-card__place">
              <button
                className="clip-card__add"
                type="button"
                disabled={busy || failed || adding}
                onPointerDown={(event) => {
                  if (busy || failed || adding) return
                  dragging.current = false
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event) => {
                  if (dragging.current || !event.currentTarget.hasPointerCapture(event.pointerId)) {
                    return
                  }
                  if (Math.abs(event.movementX) + Math.abs(event.movementY) > 0) {
                    dragging.current = true
                    onDragToTimeline(clip)
                  }
                }}
                // Still a click handler, so Enter and Space keep working — a
                // drag ends over the timeline, which does its own placing, and
                // only swallows the click that follows it.
                onClick={() => {
                  if (dragging.current) {
                    dragging.current = false
                    return
                  }
                  onAdd(clip)
                }}
                aria-label={`Add ${clip.title} to the timeline`}
                title={
                  busy
                    ? 'Wait for this clip to finish importing'
                    : failed
                      ? 'This clip failed to import'
                      : 'Click to append, or drag onto the timeline'
                }
              >
                <Plus size={14} />
                Add to timeline
              </button>
              {placed > 0 && (
                <small className="clip-card__placed">
                  {placed === 1 ? 'On the timeline' : `On the timeline ${placed}×`}
                </small>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
