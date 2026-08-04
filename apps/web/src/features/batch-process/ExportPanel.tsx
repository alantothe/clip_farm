import { Download, FileOutput, LoaderCircle, Send, Square, TriangleAlert } from 'lucide-react'
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
 *
 * While an export runs, the one button is the way to stop it. It does not
 * sprout a second control to hover for: an export that has started cannot be
 * started again, so the button has nothing else left to mean, and one that
 * changed what it did depending on the pointer would be a trap for anyone
 * reaching it by keyboard or touch. Hovering only swaps the spinner for a stop
 * icon, so the shape says what the click has been doing all along.
 */
export function ExportPanel({
  sequenceRender,
  shotCount,
  onExport,
  onCancel,
  onPublish,
  publishedCount,
  starting,
  cancelling,
  error,
}: {
  sequenceRender: SequenceRender | null
  shotCount: number
  onExport: () => void
  /** Ask the export that is running to stop. */
  onCancel: () => void
  onPublish: () => void
  /** How many Platforms this export has already gone out to. */
  publishedCount: number
  starting: boolean
  /**
   * A stop has been asked for from here and not yet come back on the row.
   * Stays true after the request succeeds, because the Batch is only polled
   * every second and a half and the answer arrives on it, not on the reply.
   */
  cancelling: boolean
  error: Error | null
}) {
  const running = sequenceRender != null && RUNNING.includes(sequenceRender.status)
  const busy = running || starting
  // Cancelling covers both sides of the wait: the request in flight, and the
  // one already recorded on the row while the worker kills its ffmpeg pass and
  // clears the render directory. Neither is a moment to offer a second stop.
  const stopping = running && (cancelling || sequenceRender.cancel_requested_at != null)
  // Only a started export can be stopped. The moment between the click and the
  // row existing has nothing to cancel yet, so `starting` waits it out.
  const canCancel = running && !stopping
  // A Sequence edited since the export is no longer what that file holds. The
  // API works this out from when the Batch was last touched, so a retrim or a
  // Title counts and not only a Shot added or removed.
  const stale = sequenceRender?.status === 'complete' && sequenceRender.stale
  const failedMessage = sequenceRender?.status === 'failed' ? sequenceRender.message : error?.message
  const cancelled = sequenceRender?.status === 'cancelled'
  const exportTooltip =
    shotCount === 0
      ? 'Add clips to the timeline before exporting'
      : stopping
        ? 'Stopping the export…'
        : canCancel && sequenceRender
          ? `Exporting ${sequenceRender.progress}% — ${sequenceRender.message}. Click to stop`
          : starting
            ? 'Starting export…'
            : failedMessage
              ? `${failedMessage} — try exporting again`
              : cancelled
                ? 'Last export was stopped — export the timeline as one video'
                : 'Export the timeline as one video'

  return (
    <section className="export-control" aria-label="Export controls">
      <span className="export-control__action">
        <button
          className={[
            'export-control__button',
            failedMessage ? 'is-failed' : '',
            canCancel ? 'is-stoppable' : '',
            stopping ? 'is-stopping' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          type="button"
          onClick={canCancel ? onCancel : onExport}
          disabled={stopping || starting || (!running && shotCount === 0)}
          aria-label={
            canCancel
              ? 'Stop export'
              : stopping
                ? 'Stopping export'
                : busy
                  ? 'Exporting video'
                  : 'Export video'
          }
          aria-describedby="export-action-tooltip"
          title={exportTooltip}
        >
          {stopping ? (
            /* The click has landed and will not be taken back, so the icon
               stops turning: a spinner here would say the export was still
               being made, which is the one thing it is no longer doing. It
               holds the stop the operator pressed, in red, and pulses while
               the worker kills its ffmpeg pass and clears up. */
            <Square size={11} fill="currentColor" />
          ) : busy ? (
            <>
              <LoaderCircle className="spin export-control__working" size={17} />
              {/* Only drawn on hover or keyboard focus, by CSS: the spinner is
                  what an export at rest should look like. */}
              {canCancel && (
                <Square
                  className="export-control__stop"
                  size={11}
                  fill="currentColor"
                  aria-hidden="true"
                />
              )}
            </>
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

      {/* A percentage that keeps climbing would say the export is still being
          made. Once it is being torn down, the honest reading is the wait. */}
      {stopping ? (
        <span className="export-control__progress is-stopping">Stopping…</span>
      ) : running && sequenceRender ? (
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
      ) : null}

      {failedMessage && (
        <span className="export-control__message" role="alert">{failedMessage}</span>
      )}

      {/* Not an alert: the operator asked for this, and knows. It is here so a
          stopped export does not read as one that quietly never happened. */}
      {cancelled && !failedMessage && (
        <span className="export-control__message">Export stopped</span>
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
