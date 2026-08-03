import { useEffect, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  MoveHorizontal,
  MoveVertical,
  RotateCcw,
  X,
  ZoomIn,
} from 'lucide-react'
import { formatTime } from '../../lib/format'
import type { Cutaway, Project, Shot, ShotFraming, ShotTrim } from '../../types'
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
  onPreviewFraming,
  onFrame,
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
  onPreviewFraming: (framing: ShotFraming | null) => void
  onFrame: (shot: Shot | Cutaway, framing: ShotFraming) => void
  onRemove: (shot: Shot | Cutaway) => void
  busy: boolean
}) {
  const trim = shotTrim(shot, clip)
  const [draft, setDraft] = useState({ start: asSeconds(trim.start), end: asSeconds(trim.end) })
  const [framing, setFraming] = useState<ShotFraming>({
    frame_zoom: shot.frame_zoom,
    frame_center_x: shot.frame_center_x,
    frame_center_y: shot.frame_center_y,
  })
  const overridden = shot.trim_start_ms !== null || shot.trim_end_ms !== null
  const framingChanged =
    framing.frame_zoom !== 1 || framing.frame_center_x !== 50 || framing.frame_center_y !== 50

  // A drag on the timeline is the other way these numbers change.
  useEffect(() => {
    setDraft({ start: asSeconds(trim.start), end: asSeconds(trim.end) })
  }, [shot.id, trim.start, trim.end])

  useEffect(() => {
    const next = {
      frame_zoom: shot.frame_zoom,
      frame_center_x: shot.frame_center_x,
      frame_center_y: shot.frame_center_y,
    }
    setFraming(next)
    onPreviewFraming(null)
  }, [shot.id, shot.frame_zoom, shot.frame_center_x, shot.frame_center_y])

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

  function preview(patch: Partial<ShotFraming>) {
    const next = { ...framing, ...patch }
    setFraming(next)
    onPreviewFraming(next)
  }

  function commitFraming() {
    onPreviewFraming(null)
    if (
      framing.frame_zoom === shot.frame_zoom &&
      framing.frame_center_x === shot.frame_center_x &&
      framing.frame_center_y === shot.frame_center_y
    ) return
    onFrame(shot, framing)
  }

  function cancelFraming() {
    setFraming({
      frame_zoom: shot.frame_zoom,
      frame_center_x: shot.frame_center_x,
      frame_center_y: shot.frame_center_y,
    })
    onPreviewFraming(null)
  }

  function resetFraming() {
    const reset = { frame_zoom: 1, frame_center_x: 50, frame_center_y: 50 }
    setFraming(reset)
    onPreviewFraming(null)
    onFrame(shot, reset)
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

      <div className="shot-inspector__framing" aria-label="Shot framing controls">
        <label className="shot-inspector__frame-field">
          <span><ZoomIn size={13} /> Zoom</span>
          <input
            type="range"
            min={100}
            max={300}
            step={5}
            value={Math.round(framing.frame_zoom * 100)}
            disabled={busy}
            onChange={(event) => preview({ frame_zoom: Number(event.target.value) / 100 })}
            onPointerUp={commitFraming}
            onPointerCancel={cancelFraming}
            onKeyUp={commitFraming}
            onBlur={commitFraming}
            aria-label="Shot zoom"
          />
          <output>{Math.round(framing.frame_zoom * 100)}%</output>
        </label>
        <label className="shot-inspector__frame-field">
          <span><MoveHorizontal size={13} /> X</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={framing.frame_center_x}
            disabled={busy}
            onChange={(event) => preview({ frame_center_x: Number(event.target.value) })}
            onPointerUp={commitFraming}
            onPointerCancel={cancelFraming}
            onKeyUp={commitFraming}
            onBlur={commitFraming}
            aria-label="Shot horizontal position"
          />
          <output>{Math.round(framing.frame_center_x)}%</output>
        </label>
        <label className="shot-inspector__frame-field">
          <span><MoveVertical size={13} /> Y</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={framing.frame_center_y}
            disabled={busy}
            onChange={(event) => preview({ frame_center_y: Number(event.target.value) })}
            onPointerUp={commitFraming}
            onPointerCancel={cancelFraming}
            onKeyUp={commitFraming}
            onBlur={commitFraming}
            aria-label="Shot vertical position"
          />
          <output>{Math.round(framing.frame_center_y)}%</output>
        </label>
        <button
          className="icon-button shot-inspector__frame-reset"
          type="button"
          onClick={resetFraming}
          disabled={busy || !framingChanged}
          aria-label={`Reset ${clip.title} framing`}
          title="Reset zoom and position"
        >
          <RotateCcw size={14} />
        </button>
      </div>

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
