import { Download, FileOutput, LoaderCircle, Send, TriangleAlert } from 'lucide-react'
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
 * The control lives beside playback: both actions operate on the same rough
 * cut, and neither needs a permanent toolbar of its own. Its tooltip carries
 * the detailed state; only progress and a finished download add visible UI.
 */
export function ExportPanel({
  sequenceRender,
  shotCount,
  onExport,
  onPublish,
  publishedCount,
  starting,
  error,
}: {
  sequenceRender: SequenceRender | null
  shotCount: number
  onExport: () => void
  onPublish: () => void
  /** How many Platforms this export has already gone out to. */
  publishedCount: number
  starting: boolean
  error: Error | null
}) {
  const running = sequenceRender != null && RUNNING.includes(sequenceRender.status)
  const busy = running || starting
  // A Sequence edited since the export is no longer what that file holds. The
  // API works this out from when the Batch was last touched, so a retrim or a
  // Title counts and not only a Shot added or removed.
  const stale = sequenceRender?.status === 'complete' && sequenceRender.stale
  const failedMessage = sequenceRender?.status === 'failed' ? sequenceRender.message : error?.message
  const exportTooltip =
    shotCount === 0
      ? 'Add clips to the timeline before exporting'
      : running && sequenceRender
        ? `Exporting ${sequenceRender.progress}% — ${sequenceRender.message}`
        : starting
          ? 'Starting export…'
          : failedMessage
            ? `${failedMessage} — try exporting again`
            : 'Export the timeline as one video'

  return (
    <section className="export-control" aria-label="Export controls">
      <span className="export-control__action">
        <button
          className={`export-control__button ${failedMessage ? 'is-failed' : ''}`}
          type="button"
          onClick={onExport}
          disabled={busy || shotCount === 0}
          aria-label={busy ? 'Exporting video' : 'Export video'}
          aria-describedby="export-action-tooltip"
          title={exportTooltip}
        >
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : failedMessage ? (
            <TriangleAlert size={17} />
          ) : (
            <FileOutput size={17} />
          )}
        </button>
        <span className="control-tooltip" id="export-action-tooltip" role="tooltip">
          {exportTooltip}
        </span>
      </span>

      {running && sequenceRender && (
        <span
          className="export-control__progress"
          role="progressbar"
          aria-valuenow={sequenceRender.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Export progress"
        >
          {sequenceRender.progress}%
        </span>
      )}

      {failedMessage && (
        <span className="export-control__message" role="alert">{failedMessage}</span>
      )}

      {/*
       * The file is not the end of the work — a finished export still has to be
       * written up and sent somewhere. That stage opens from here, beside the
       * download, because both are things you do with the same finished cut.
       */}
      {sequenceRender?.status === 'complete' && (
        <span className="export-control__action">
          <button
            className="export-control__publish"
            type="button"
            onClick={onPublish}
            aria-describedby="publish-action-tooltip"
          >
            <Send size={16} />
            Publish
            {publishedCount > 0 && <i aria-hidden="true">{publishedCount}</i>}
          </button>
          <span className="control-tooltip" id="publish-action-tooltip" role="tooltip">
            {publishedCount > 0
              ? `Posted to ${publishedCount} ${publishedCount === 1 ? 'platform' : 'platforms'} — open to post again`
              : 'Write the caption and send this to Instagram'}
          </span>
        </span>
      )}

      {sequenceRender?.status === 'complete' && sequenceRender.download_url && (
        <span className="export-control__action">
          <a
            className={`export-control__download ${stale ? 'is-stale' : ''}`}
            href={`${API_BASE}${sequenceRender.download_url}`}
            download
            aria-label="Download MP4"
            aria-describedby="download-export-tooltip"
          >
            <Download size={16} />
          </a>
          <span className="control-tooltip" id="download-export-tooltip" role="tooltip">
            Download MP4
            {sequenceRender.duration_ms != null && ` · ${formatTime(sequenceRender.duration_ms)}`}
            {sequenceRender.size_bytes != null && ` · ${formatBytes(sequenceRender.size_bytes)}`}
            {stale && ' · Timeline changed — export again to include it'}
          </span>
          {stale && <span className="export-control__message">Timeline changed since this export</span>}
        </span>
      )}
    </section>
  )
}
