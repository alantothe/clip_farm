import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ExternalLink,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import { API_BASE } from '../../api'
import { formatBytes, formatTime } from '../../lib/format'
import { PLATFORMS, platformDefinition } from '../../platforms/registry'
import type {
  Batch,
  PlatformConnection,
  PublishOptions,
  SequencePublication,
  SequenceRender,
} from '../../types'

/** Instagram's caption limits, counted the way the API counts them. */
const MAX_CAPTION = 2200
const MAX_HASHTAGS = 30
const MAX_MENTIONS = 20
const HASHTAG_RE = /(?<!\w)#\w+/g
const MENTION_RE = /(?<!\w)@[\w.]+/g

const RUNNING = ['queued', 'processing', 'publishing']

/** The draft survives closing the dialog; it is real writing, not a checkbox. */
const draftKey = (batchId: string) => `clip-farm:caption-draft:${batchId}`

export interface CaptionStats {
  length: number
  hashtags: number
  mentions: number
  overLength: boolean
  overHashtags: boolean
  overMentions: boolean
}

export function captionStats(caption: string): CaptionStats {
  const length = caption.trim().length
  const hashtags = caption.match(HASHTAG_RE)?.length ?? 0
  const mentions = caption.match(MENTION_RE)?.length ?? 0
  return {
    length,
    hashtags,
    mentions,
    overLength: length > MAX_CAPTION,
    overHashtags: hashtags > MAX_HASHTAGS,
    overMentions: mentions > MAX_MENTIONS,
  }
}

type Step = 'destinations' | 'details' | 'posting'

/**
 * Where a finished Batch goes next.
 *
 * The export produces a file; this is the stage that turns it into a post. It
 * asks in the order the operator decides in — first *where*, then *what to say*
 * — because the second question's answer depends on the first: Instagram wants
 * a cover frame and a feed choice that mean nothing to YouTube.
 *
 * Every destination is posted separately, and the dialog can be closed while
 * they run: each Platform has its own row, its own progress and its own retry,
 * so one failing does not take the others with it (ADR 0012).
 */
export function PublishDialog({
  batch,
  sequenceRender,
  publications,
  connections,
  publishing,
  error,
  onPublish,
  onRewriteCaption,
  rewriting,
  onRefresh,
  refreshing,
  onClose,
}: {
  batch: Batch
  sequenceRender: SequenceRender
  publications: SequencePublication[]
  connections: PlatformConnection[]
  /** Platforms with a post request in flight right now. */
  publishing: string[]
  error: Error | null
  onPublish: (platform: string, caption: string, options: PublishOptions) => void
  onRewriteCaption: (caption: string) => Promise<string>
  rewriting: boolean
  /** Pull the Batch and the connected accounts again, on demand. */
  onRefresh: () => void
  refreshing: boolean
  onClose: () => void
}) {
  const posted = useMemo(
    () => new Map(publications.map((publication) => [publication.platform, publication])),
    [publications],
  )
  const [step, setStep] = useState<Step>(() =>
    publications.length ? 'posting' : 'destinations',
  )
  const [selected, setSelected] = useState<string[]>(() =>
    publications.length ? publications.map((publication) => publication.platform) : ['instagram'],
  )
  const [caption, setCaption] = useState(
    () =>
      publications[0]?.caption ||
      window.localStorage.getItem(draftKey(batch.id)) ||
      '',
  )
  const [shareToFeed, setShareToFeed] = useState(
    () => publications[0]?.options?.share_to_feed ?? true,
  )
  const [coverMs, setCoverMs] = useState<number | null>(
    () => publications[0]?.options?.thumb_offset_ms ?? null,
  )
  const [rewriteError, setRewriteError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    window.localStorage.setItem(draftKey(batch.id), caption)
  }, [batch.id, caption])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const stats = captionStats(caption)
  const captionIsBad = stats.overLength || stats.overHashtags || stats.overMentions
  // The API compares the export against when the Batch was last edited, so a
  // retrim, a reframe, a Title or an image all count — not only a Shot added
  // or removed, which is all a Shot count could ever notice.
  const stale = sequenceRender.stale
  const instagram = connections.find((connection) => connection.platform === 'instagram')
  const chosen = PLATFORMS.filter((platform) => selected.includes(platform.id))
  const blocked = chosen.filter((platform) => {
    if (!platform.ready) return true
    const connection = connections.find((item) => item.platform === platform.id)
    return !connection?.configured || connection.account?.status !== 'connected'
  })

  const toggle = (platform: string, ready: boolean) => {
    if (!ready) return
    setSelected((current) =>
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform],
    )
  }

  const post = () => {
    const options: PublishOptions = { share_to_feed: shareToFeed, thumb_offset_ms: coverMs }
    for (const platform of chosen) onPublish(platform.id, caption, options)
    setStep('posting')
  }

  const rewrite = () => {
    setRewriteError(null)
    onRewriteCaption(caption)
      .then(setCaption)
      .catch((cause: Error) => setRewriteError(cause.message))
  }

  return (
    <div className="delete-dialog-backdrop" role="presentation">
      <section
        className="publish-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-dialog-title"
      >
        <header className="publish-dialog__head">
          <div>
            <p className="eyebrow">Publish</p>
            <h2 id="publish-dialog-title">{batch.name}</h2>
          </div>
          {/*
           * The Batch is only polled while something is running, so an edit
           * made in another tab — or a Platform connected in Settings — will
           * not arrive on its own while this sits open. This is the way to ask.
           */}
          <div className="publish-dialog__head-actions">
            <button
              className="publish-dialog__refresh"
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? 'spin' : ''} size={14} />
              {refreshing ? 'Checking…' : 'Check for changes'}
            </button>
            <button
              className="publish-dialog__close"
              type="button"
              onClick={onClose}
              aria-label="Close publish dialog"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <ol className="publish-dialog__steps" aria-label="Publishing steps">
          {(['destinations', 'details', 'posting'] as Step[]).map((name, index) => (
            <li
              key={name}
              className={step === name ? 'is-active' : ''}
              aria-current={step === name ? 'step' : undefined}
            >
              <i aria-hidden="true">{index + 1}</i>
              {name === 'destinations' ? 'Destinations' : name === 'details' ? 'Details' : 'Posting'}
            </li>
          ))}
        </ol>

        <div className="publish-dialog__body">
          <aside className="publish-preview">
            {/*
             * The media fragment is what puts a picture on the element. Without
             * it the browser loads metadata and paints black, which would leave
             * the operator choosing a cover frame against nothing.
             */}
            <video
              ref={videoRef}
              className="publish-preview__video"
              src={`${API_BASE}${sequenceRender.download_url ?? ''}#t=0.1`}
              controls
              playsInline
              preload="metadata"
            />
            <dl className="publish-preview__facts">
              <div>
                <dt>Length</dt>
                <dd>{sequenceRender.duration_ms != null ? formatTime(sequenceRender.duration_ms) : '—'}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{sequenceRender.size_bytes != null ? formatBytes(sequenceRender.size_bytes) : '—'}</dd>
              </div>
              <div>
                <dt>Clips</dt>
                <dd>{sequenceRender.shot_count}</dd>
              </div>
            </dl>
            {stale && (
              <p className="publish-preview__stale" role="status">
                <TriangleAlert size={14} /> Edited since this export
              </p>
            )}
          </aside>

          <div className="publish-dialog__panel">
            {step === 'destinations' && (
              <>
                <p className="publish-dialog__lede">
                  Pick where this goes. Each destination is posted on its own, so one
                  failing leaves the others alone.
                </p>
                <ul className="publish-destinations">
                  {PLATFORMS.map((platform) => {
                    const connection = connections.find((item) => item.platform === platform.id)
                    const connected = connection?.account?.status === 'connected'
                    const active = selected.includes(platform.id)
                    const publication = posted.get(platform.id)
                    return (
                      <li key={platform.id}>
                        <button
                          type="button"
                          className={`publish-destination ${active ? 'is-selected' : ''} ${
                            platform.ready ? '' : 'is-unavailable'
                          }`}
                          aria-pressed={active}
                          disabled={!platform.ready}
                          onClick={() => toggle(platform.id, platform.ready)}
                        >
                          <span className="publish-destination__copy">
                            <strong>
                              {platform.name} · {platform.surface}
                            </strong>
                            <small>
                              {!platform.ready
                                ? platform.blurb
                                : connected
                                  ? `Posting as @${connection?.account?.username}`
                                  : 'Not connected — add it in Settings'}
                            </small>
                            {publication?.status === 'complete' && (
                              <small className="publish-destination__done">
                                <Check size={12} /> Already posted
                              </small>
                            )}
                          </span>
                          {active && (
                            <span className="publish-destination__tick" aria-hidden="true">
                              <Check size={14} />
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {!instagram?.configured && (
                  <p className="publish-dialog__note">
                    Instagram publishing is not configured on this server yet.
                  </p>
                )}
              </>
            )}

            {step === 'details' && (
              <>
                <label className="publish-caption">
                  <span>
                    Caption
                    <output className={stats.overLength ? 'is-over' : ''}>
                      {stats.length.toLocaleString()} / {MAX_CAPTION.toLocaleString()}
                    </output>
                  </span>
                  <textarea
                    value={caption}
                    rows={9}
                    autoFocus
                    placeholder="Write the text that goes out beside the video."
                    onChange={(event) => setCaption(event.target.value)}
                  />
                </label>
                <div className="publish-caption__meters">
                  <span className={stats.overHashtags ? 'is-over' : ''}>
                    {stats.hashtags} / {MAX_HASHTAGS} hashtags
                  </span>
                  <span className={stats.overMentions ? 'is-over' : ''}>
                    {stats.mentions} / {MAX_MENTIONS} mentions
                  </span>
                  <button
                    className="ai-caption-button"
                    type="button"
                    onClick={rewrite}
                    disabled={rewriting || !caption.trim()}
                  >
                    {rewriting ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Sparkles size={15} />
                    )}
                    Rewrite &amp; censor
                  </button>
                </div>
                {rewriteError && (
                  <p className="form-error" role="alert">
                    {rewriteError}
                  </p>
                )}

                {selected.includes('instagram') && (
                  <fieldset className="publish-options">
                    <legend>Instagram</legend>
                    <div className="publish-cover">
                      <div className="publish-cover__copy">
                        <strong>
                          <ImageIcon size={14} /> Cover frame
                        </strong>
                        <small>
                          {coverMs == null
                            ? 'Instagram picks the first frame.'
                            : `Showing the frame at ${formatTime(coverMs)}.`}
                        </small>
                      </div>
                      <div className="publish-cover__actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() =>
                            setCoverMs(Math.round((videoRef.current?.currentTime ?? 0) * 1000))
                          }
                        >
                          Use current frame
                        </button>
                        {coverMs != null && (
                          <button
                            type="button"
                            className="publish-cover__reset"
                            onClick={() => setCoverMs(null)}
                            aria-label="Clear the cover frame"
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    <label className="publish-toggle">
                      <input
                        type="checkbox"
                        checked={shareToFeed}
                        onChange={(event) => setShareToFeed(event.target.checked)}
                      />
                      <span>
                        <strong>Also share to feed</strong>
                        <small>Show the Reel in your main feed as well as the Reels tab.</small>
                      </span>
                    </label>
                  </fieldset>
                )}
              </>
            )}

            {step === 'posting' && (
              <ul className="publish-progress">
                {chosen.map((platform) => {
                  const publication = posted.get(platform.id)
                  const inFlight =
                    publishing.includes(platform.id) ||
                    (publication != null && RUNNING.includes(publication.status))
                  return (
                    <li key={platform.id} className="publish-progress__row">
                      <div className="publish-progress__head">
                        <strong>{platform.name}</strong>
                        <span>
                          {publication?.status === 'complete'
                            ? 'Posted'
                            : publication?.status === 'failed'
                              ? 'Failed'
                              : inFlight
                                ? (publication?.message ?? 'Starting…')
                                : 'Waiting'}
                        </span>
                      </div>
                      <div
                        className={`publish-progress__bar ${
                          publication?.status === 'failed' ? 'is-failed' : ''
                        }`}
                        role="progressbar"
                        aria-valuenow={publication?.progress ?? 0}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${platform.name} posting progress`}
                      >
                        <i style={{ width: `${publication?.progress ?? 0}%` }} />
                      </div>
                      {publication?.status === 'failed' && (
                        <p className="publish-progress__error" role="alert">
                          {publication.error_message}
                        </p>
                      )}
                      {publication?.permalink && (
                        <a
                          className="publish-progress__link"
                          href={publication.permalink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink size={14} /> View the post
                        </a>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {error && (
              <p className="form-error" role="alert">
                {error.message}
              </p>
            )}
          </div>
        </div>

        <footer className="publish-dialog__actions">
          {step === 'destinations' && (
            <>
              <button className="secondary-button" type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={selected.length === 0 || blocked.length > 0}
                onClick={() => setStep('details')}
              >
                Write the caption
              </button>
            </>
          )}
          {step === 'details' && (
            <>
              {/*
               * Said here rather than only beside the video, because this is
               * where the irreversible choice is made: what goes out is the
               * exported file, not the timeline as it stands now.
               */}
              {stale && (
                <p className="publish-dialog__warning" role="status">
                  <TriangleAlert size={15} />
                  This posts the older cut — the batch changed after it was exported.
                  Close and export again for the current one.
                </p>
              )}
              <button
                className="secondary-button"
                type="button"
                onClick={() => setStep('destinations')}
              >
                Back
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={captionIsBad || publishing.length > 0}
                onClick={post}
              >
                {publishing.length ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Send size={17} />
                )}
                {stale ? 'Post the older cut' : `Post to ${chosen.length === 1 ? chosen[0].name : `${chosen.length} destinations`}`}
              </button>
            </>
          )}
          {step === 'posting' && (
            <>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setStep('details')}
              >
                Edit and post again
              </button>
              <button className="primary-button" type="button" onClick={onClose}>
                Done
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}
