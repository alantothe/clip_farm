import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react'
import { formatTime } from '../../lib/format'
import type { Cutaway, Project, Shot, ShotTrim } from '../../types'
import { shotSpanMs, shotTrim } from './Timeline'

const asSeconds = (ms: number) => (ms / 1000).toFixed(1)

/**
 * The selected Shot's controls.
 *
 * Dragging cannot be reached by keyboard and cannot type an exact in-point, and
 * a Shot only two seconds long is too narrow to grab at all at low zoom. This
 * panel is the answer to all three, which is why it carries move and remove as
 * well as the numbers (ADR 0004).
 */
export function ShotInspector({
  shot,
  clip,
  index,
  count,
  covering,
  onMove,
  onTrim,
  onRemove,
  busy,
}: {
  shot: Shot | Cutaway
  clip: Project
  index: number
  count: number
  /** The Base Shot's title when this is a Cutaway, which has no place in the order. */
  covering: string | null
  onMove: (shot: Shot, position: number) => void
  onTrim: (shot: Shot | Cutaway, trim: ShotTrim) => void
  onRemove: (shot: Shot | Cutaway) => void
  busy: boolean
}) {
  const trim = shotTrim(shot, clip)
  const [draft, setDraft] = useState({ start: asSeconds(trim.start), end: asSeconds(trim.end) })
  const overridden = shot.trim_start_ms !== null || shot.trim_end_ms !== null

  // A drag on the timeline is the other way these numbers change.
  useEffect(() => {
    setDraft({ start: asSeconds(trim.start), end: asSeconds(trim.end) })
  }, [shot.id, trim.start, trim.end])

  /** Commit on blur or Enter rather than per keystroke, which would be a request each. */
  function commit(edge: 'start' | 'end') {
    const seconds = Number(edge === 'start' ? draft.start : draft.end)
    if (!Number.isFinite(seconds) || seconds < 0) {
      setDraft({ start: asSeconds(trim.start), end: asSeconds(trim.end) })
      return
    }
    const ms = Math.round(seconds * 1000)
    if (ms === (edge === 'start' ? trim.start : trim.end)) return
    onTrim(shot, edge === 'start' ? { trim_start_ms: ms } : { trim_end_ms: ms })
  }

  return (
    <div className="shot-inspector" aria-label={`Selected shot: ${clip.title}`}>
      <span className="shot-inspector__title">
        <strong>{clip.title}</strong>
        <small>
          {covering ? `covering ${covering}` : `shot ${index + 1} of ${count}`} ·{' '}
          {formatTime(shotSpanMs(shot, clip))} ·{' '}
          {overridden ? 'trimmed here' : 'follows clip'}
        </small>
      </span>

      <label className="shot-inspector__field">
        In
        <input
          type="number"
          step={0.1}
          min={0}
          value={draft.start}
          disabled={busy}
          onChange={(event) => setDraft((value) => ({ ...value, start: event.target.value }))}
          onBlur={() => commit('start')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          aria-label="Shot in point, seconds"
        />
      </label>
      <label className="shot-inspector__field">
        Out
        <input
          type="number"
          step={0.1}
          min={0}
          value={draft.end}
          disabled={busy}
          onChange={(event) => setDraft((value) => ({ ...value, end: event.target.value }))}
          onBlur={() => commit('end')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          aria-label="Shot out point, seconds"
        />
      </label>

      <span className="shot-inspector__actions">
        {/* A Cutaway has no place in the running order to move it along. */}
        {!covering && (
          <>
            <button
              className="icon-button"
              type="button"
              onClick={() => onMove(shot as Shot, index - 1)}
              disabled={busy || index === 0}
              aria-label={`Move ${clip.title} earlier`}
              title="Move earlier"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => onMove(shot as Shot, index + 1)}
              disabled={busy || index === count - 1}
              aria-label={`Move ${clip.title} later`}
              title="Move later"
            >
              <ChevronRight size={16} />
            </button>
          </>
        )}
        <button
          className="text-button"
          type="button"
          onClick={() => onTrim(shot, { trim_start_ms: null, trim_end_ms: null })}
          disabled={busy || !overridden}
          aria-label={`Reset ${clip.title} to its clip's trim`}
          title="Play this clip's own trim again"
        >
          <RotateCcw size={14} />
          Reset to clip
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => onRemove(shot)}
          disabled={busy}
          aria-label={
            covering
              ? `Stop ${clip.title} covering ${covering}`
              : `Remove ${clip.title} from the timeline`
          }
          title={covering ? 'Uncover the shot' : 'Remove from timeline'}
        >
          <X size={16} />
        </button>
      </span>
    </div>
  )
}
