import { Check, Clapperboard, Plus, TriangleAlert } from 'lucide-react'
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
 */
export function ClipGrid({
  clips,
  onOpen,
  onAdd,
  placedClipIds,
  adding,
}: {
  clips: Project[]
  onOpen: (clip: Project) => void
  onAdd: (clip: Project) => void
  placedClipIds: Set<string>
  adding: boolean
}) {
  return (
    <ul className="clip-grid" aria-label="Clips in this batch">
      {clips.map((clip) => {
        const thumbnail = artifact(clip, 'thumbnail')
        const busy = projectIsBusy(clip)
        const failed = clip.status === 'failed'
        const job = clip.latest_job
        const placed = placedClipIds.has(clip.id)
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
            {placed ? (
              <span className="clip-card__placed">
                <Check size={14} />
                On the timeline
              </span>
            ) : (
              <button
                className="clip-card__add"
                type="button"
                onClick={() => onAdd(clip)}
                disabled={busy || failed || adding}
                aria-label={`Add ${clip.title} to the timeline`}
                title={
                  busy
                    ? 'Wait for this clip to finish importing'
                    : failed
                      ? 'This clip failed to import'
                      : 'Add to the timeline'
                }
              >
                <Plus size={14} />
                Add to timeline
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
