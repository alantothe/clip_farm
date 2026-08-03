import { Clapperboard, Pause, Play, SkipBack } from 'lucide-react'
import { formatTime } from '../../lib/format'
import type { SequencePlayer } from './useSequencePlayer'

/**
 * The Player: the screen that plays a Sequence as one video.
 *
 * There is otherwise no way to watch a Batch without exporting it, and a
 * playhead you cannot play is not much of an editor. `useSequencePlayer` chains
 * the Clips' existing `preview` Artifacts; this renders what it produces and
 * owns no playback state of its own.
 *
 * Those previews are the Source Video scaled down — **landscape, uncropped and
 * unsubtitled**. So this shows order, timing, and where the cuts fall, and says
 * so; it does not show the finished framing. A server-rendered proxy would be
 * accurate but costs minutes per build and is stale the moment a Shot moves,
 * which makes it the export button with extra steps (ADR 0004).
 */
export function Player({ player }: { player: SequencePlayer }) {
  const { placed, totalMs, current, index, covering, playing, slot, videos } = player

  return (
    <section className="preview" aria-label="Player">
      <div className="preview__screen">
        {placed.length === 0 || player.missingPreview ? (
          <span className="preview__placeholder">
            <Clapperboard size={26} />
          </span>
        ) : null}
        {[0, 1].map((value) => (
          <video
            key={value}
            ref={videos[value]}
            className={`preview__video ${value === slot ? 'is-active' : ''}`}
            playsInline
            preload="auto"
            muted={value !== slot}
            onTimeUpdate={value === slot ? player.onTimeUpdate : undefined}
            // `timeupdate` stops firing once the media ends, so the last word
            // on whether a Shot is over belongs to the element itself.
            onEnded={value === slot ? player.advance : undefined}
          />
        ))}
        {/* Muted, and over the top: the base element below still has the sound. */}
        <video
          ref={player.coverRef}
          className={`preview__video preview__video--cover ${covering ? 'is-active' : ''}`}
          playsInline
          preload="auto"
          muted
        />
      </div>

      <div className="preview__side">
        <div className="preview__transport">
          <button
            className="icon-button"
            type="button"
            onClick={player.restart}
            disabled={!placed.length}
            aria-label="Back to the start"
            title="Back to the start"
          >
            <SkipBack size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => player.setPlaying(!playing)}
            disabled={!placed.length}
            aria-label={playing ? 'Pause the rough cut' : 'Play the rough cut'}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <span className="preview__clock">
            {formatTime(Math.min(player.playheadMs, totalMs))} / {formatTime(totalMs)}
          </span>
        </div>

        <p className="preview__now">
          {covering ? (
            <>
              <strong>{covering.clip.title}</strong>
              <small>covering {current ? current.item.clip.title : 'a shot'}, its sound playing</small>
            </>
          ) : current ? (
            <>
              <strong>{current.item.clip.title}</strong>
              <small>shot {index + 1} of {placed.length}</small>
            </>
          ) : (
            <small>Nothing placed yet.</small>
          )}
        </p>

        <p className="preview__caveat">
          Rough cut — this plays the source videos, so framing and subtitles
          apply on export, not here.
        </p>
      </div>
    </section>
  )
}
