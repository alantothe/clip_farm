import { ChevronLeft, ChevronRight, Clapperboard, X } from 'lucide-react'
import { formatTime } from '../../lib/format'
import { artifact } from '../../lib/project'
import type { Project, Shot } from '../../types'

/** What a Shot contributes to the finished video: its Clip's own Trim. */
export function shotDurationMs(clip: Project): number {
  const end = clip.trim_end_ms ?? clip.duration_ms ?? 0
  return Math.max(0, end - clip.trim_start_ms)
}

export function sequenceDurationMs(shots: Shot[], clips: Project[]): number {
  return shots.reduce((total, shot) => {
    const clip = clips.find((item) => item.id === shot.clip_id)
    return total + (clip ? shotDurationMs(clip) : 0)
  }, 0)
}

/**
 * The strip that presents a Sequence for reordering.
 *
 * Reordering is by button rather than drag: no drag-and-drop library is in the
 * project, and arrows are reachable by keyboard without one. Position is sent
 * to the API rather than a swap, so the server stays the one deciding order.
 */
export function Timeline({
  shots,
  clips,
  onMove,
  onRemove,
  busy,
}: {
  shots: Shot[]
  clips: Project[]
  onMove: (shot: Shot, position: number) => void
  onRemove: (shot: Shot) => void
  busy: boolean
}) {
  if (!shots.length) {
    return (
      <p className="timeline-empty">
        Nothing on the timeline yet. Add clips from below and they play in the order
        you put them here.
      </p>
    )
  }

  return (
    <ol className="timeline" aria-label="Timeline">
      {shots.map((shot, index) => {
        const clip = clips.find((item) => item.id === shot.clip_id)
        if (!clip) return null
        const thumbnail = artifact(clip, 'thumbnail')
        return (
          <li className="timeline__shot" key={shot.id}>
            <span className="timeline__index" aria-hidden="true">{index + 1}</span>
            <span className="timeline__thumb">
              {thumbnail ? <img src={thumbnail} alt="" /> : <Clapperboard size={20} />}
            </span>
            <span className="timeline__body">
              <strong>{clip.title}</strong>
              <small>{formatTime(shotDurationMs(clip))}</small>
            </span>
            <span className="timeline__actions">
              <button
                className="icon-button"
                type="button"
                onClick={() => onMove(shot, index - 1)}
                disabled={busy || index === 0}
                aria-label={`Move ${clip.title} earlier`}
                title="Move earlier"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => onMove(shot, index + 1)}
                disabled={busy || index === shots.length - 1}
                aria-label={`Move ${clip.title} later`}
                title="Move later"
              >
                <ChevronRight size={16} />
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => onRemove(shot)}
                disabled={busy}
                aria-label={`Remove ${clip.title} from the timeline`}
                title="Remove from timeline"
              >
                <X size={16} />
              </button>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
