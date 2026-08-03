import { Download, Film, LoaderCircle, TriangleAlert } from 'lucide-react'
import { API_BASE } from '../../api'
import { formatBytes, formatTime } from '../../lib/format'
import type { SequenceRender } from '../../types'

const RUNNING = ['queued', 'running']

/**
 * Asking for the finished video, and what came back.
 *
 * A Sequence Render carries its own status rather than a Job, so this polls
 * the Batch instead of the job endpoint — see ADR 0003 for why it is not a
 * Render row.
 *
 * It is one strip in the editor's top bar, not a panel: exporting is a single
 * button pressed once at the end, and the room a panel took belongs to the
 * Player and the Timeline, which are pressed all day. Everything the export
 * has to say — progress, failure, the finished file — says it along the same
 * strip, beside the button that started it.
 */
export function ExportPanel({
  sequenceRender,
  shotCount,
  totalMs,
  onExport,
  starting,
  error,
}: {
  sequenceRender: SequenceRender | null
  shotCount: number
  totalMs: number
  onExport: () => void
  starting: boolean
  error: Error | null
}) {
  const running = sequenceRender != null && RUNNING.includes(sequenceRender.status)
  const busy = running || starting
  // A Sequence that changed since the export is no longer what that file holds.
  const stale =
    sequenceRender?.status === 'complete' && sequenceRender.shot_count !== shotCount

  return (
    <section className="export-bar">
      <h2 className="export-bar__summary">
        {shotCount} {shotCount === 1 ? 'clip' : 'clips'}
        {shotCount > 0 && <span className="export-bar__total"> · {formatTime(totalMs)}</span>}
      </h2>

      {running && sequenceRender && (
        <span className="export-bar__progress">
          <span className="export-bar__track">
            <span
              className="export-bar__progress-bar"
              style={{ width: `${sequenceRender.progress}%` }}
              role="progressbar"
              aria-valuenow={sequenceRender.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Export progress"
            />
          </span>
          <small title={sequenceRender.message}>{sequenceRender.message}</small>
        </span>
      )}

      {sequenceRender?.status === 'failed' && (
        <p className="export-bar__error" role="alert">
          <TriangleAlert size={14} />
          {sequenceRender.message}
        </p>
      )}

      {error && <p className="export-bar__error" role="alert">{error.message}</p>}

      {sequenceRender?.status === 'complete' && sequenceRender.download_url && (
        <span className="export-bar__done">
          <a
            className="secondary-button"
            href={`${API_BASE}${sequenceRender.download_url}`}
            download
          >
            <Download size={15} />
            Download MP4
          </a>
          <small>
            {sequenceRender.duration_ms != null && formatTime(sequenceRender.duration_ms)}
            {sequenceRender.size_bytes != null && ` · ${formatBytes(sequenceRender.size_bytes)}`}
          </small>
          {stale && (
            <small className="export-bar__stale">
              The timeline changed since this export — run it again to include the change.
            </small>
          )}
        </span>
      )}

      <button
        className="export-bar__go"
        type="button"
        onClick={onExport}
        disabled={busy || shotCount === 0}
        title={shotCount === 0 ? 'Add clips to the timeline first' : 'Join the timeline into one video'}
      >
        {busy ? <LoaderCircle className="spin" size={16} /> : <Film size={16} />}
        {busy ? 'Exporting' : 'Export video'}
      </button>
    </section>
  )
}
