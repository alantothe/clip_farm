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
    <section className="export-panel">
      <div className="export-panel__head">
        <div>
          <p className="eyebrow">Finished video</p>
          <h2>
            {shotCount} {shotCount === 1 ? 'clip' : 'clips'}
            {shotCount > 0 && <span className="export-panel__total"> · {formatTime(totalMs)}</span>}
          </h2>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={onExport}
          disabled={busy || shotCount === 0}
          title={shotCount === 0 ? 'Add clips to the timeline first' : 'Join the timeline into one video'}
        >
          {busy ? <LoaderCircle className="spin" size={18} /> : <Film size={18} />}
          {busy ? 'Exporting' : 'Export video'}
        </button>
      </div>

      {running && sequenceRender && (
        <div className="export-panel__progress">
          <span
            className="export-panel__progress-bar"
            style={{ width: `${sequenceRender.progress}%` }}
            role="progressbar"
            aria-valuenow={sequenceRender.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Export progress"
          />
          <small>{sequenceRender.message}</small>
        </div>
      )}

      {sequenceRender?.status === 'failed' && (
        <p className="export-panel__error" role="alert">
          <TriangleAlert size={15} />
          {sequenceRender.message}
        </p>
      )}

      {error && <p className="export-panel__error" role="alert">{error.message}</p>}

      {sequenceRender?.status === 'complete' && sequenceRender.download_url && (
        <div className="export-panel__done">
          <a
            className="secondary-button"
            href={`${API_BASE}${sequenceRender.download_url}`}
            download
          >
            <Download size={16} />
            Download MP4
          </a>
          <small>
            {sequenceRender.duration_ms != null && formatTime(sequenceRender.duration_ms)}
            {sequenceRender.size_bytes != null && ` · ${formatBytes(sequenceRender.size_bytes)}`}
          </small>
          {stale && (
            <small className="export-panel__stale">
              The timeline changed since this export — run it again to include the change.
            </small>
          )}
        </div>
      )}
    </section>
  )
}
