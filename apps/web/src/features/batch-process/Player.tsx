import { useRef, useState } from 'react'
import {
  Clapperboard,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Crop,
  Maximize,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { formatDefinition } from '../../formats/registry'
import { formatTime } from '../../lib/format'
import { artifact } from '../../lib/project'
import type { Format, Project } from '../../types'
import { ScrubBar } from './ScrubBar'
import { usePlayerKeys } from './usePlayerKeys'
import type { SequencePlayer } from './useSequencePlayer'

/** What the stage is showing: the finished shape, or the whole source frame. */
type View = 'format' | 'source'

/** Half speed to study a cut, double to sit through a long Sequence. */
const RATES = [0.5, 1, 1.5, 2]

/**
 * How wide the Format's frame is as a share of a source frame's width.
 *
 * A vertical crop out of a landscape source keeps a slice as tall as the frame
 * and as wide as the ratio allows, so what survives is a fraction of the width.
 * 1 means the source is already no wider than the Format and nothing is lost.
 */
export function keptWidthFraction(
  clip: Pick<Project, 'width' | 'height'>,
  format: Format,
): number {
  const source = (clip.width ?? 16) / (clip.height ?? 9)
  const target = (formatDefinition(format).width) / (formatDefinition(format).height)
  return Math.min(1, target / source)
}

/**
 * Where that slice sits, as a left edge in percent.
 *
 * `crop_center_x` is where the operator put the centre, but the slice cannot
 * hang off either edge, so it is clamped — which is what the renderer does too.
 */
export function keptLeftPercent(
  clip: Pick<Project, 'width' | 'height' | 'crop_center_x'>,
  format: Format,
): number {
  const width = keptWidthFraction(clip, format) * 100
  return Math.min(Math.max(0, clip.crop_center_x - width / 2), 100 - width)
}

/** The aspect ratio a source frame is drawn at, falling back to 16:9. */
const sourceRatio = (clip: Project | null): string =>
  clip?.width && clip?.height ? `${clip.width} / ${clip.height}` : '16 / 9'

/**
 * The Player: the screen that plays a Sequence as one video.
 *
 * There is otherwise no way to watch a Batch without exporting it, and a
 * playhead you cannot play is not much of an editor. `useSequencePlayer` chains
 * the Clips' existing `preview` Artifacts; this renders what it produces and
 * owns no playback state — only which of the two views is on screen.
 *
 * The stage is the Batch's Format, because that is the shape being made. The
 * previews underneath are landscape Source Videos, so each Shot is framed the
 * way its Layout says it will be framed on export — `object-fit: cover` at its
 * `crop_center_x` for a smart crop, letterboxed over a blurred backdrop for a
 * fit. That is exact for a fit and approximate for a smart crop, whose real
 * crop drifts frame by frame after a face detector (ADR 0004).
 *
 * The Source view exists for the judgement the Format view cannot show: what
 * the crop is throwing away. It draws the whole frame and outlines the slice
 * that survives.
 */
export function Player({
  player,
  format,
  onTrimToPlayhead,
  canTrim = false,
}: {
  player: SequencePlayer
  format: Format
  /** Set the selected Shot's Trim to the playhead. Absent when nothing can. */
  onTrimToPlayhead?: (edge: 'in' | 'out') => void
  canTrim?: boolean
}) {
  const [view, setView] = useState<View>('format')
  const stageRef = useRef<HTMLDivElement>(null)
  const { placed, totalMs, current, next, covering, playing, slot, videos } = player
  const dead = !placed.length

  /**
   * Fullscreen the stage, not the video.
   *
   * A `<video>` full-screened by itself shows the raw landscape media with
   * none of the framing, guides or Cutaway badge drawn over it — everything
   * that makes this a preview rather than a file. The container carries them
   * all, so the container is what expands.
   */
  function onFullscreen() {
    const stage = stageRef.current
    if (!stage) return
    if (document.fullscreenElement) void document.exitFullscreen?.()
    else void stage.requestFullscreen?.().catch(() => undefined)
  }

  // Bound to the window, so the keys work while you are editing on the
  // Timeline rather than only when the Player happens to hold focus.
  usePlayerKeys({ player, enabled: !dead, onTrimToPlayhead, onFullscreen })

  const shape = formatDefinition(format)
  const currentClip = current?.item.clip ?? null
  // The cover element holds a Cutaway's Clip; the two swapping elements hold
  // the current Shot's and the next one's, so each is framed by its own Layout.
  const clipInSlot = (value: number): Project | null =>
    value === slot ? currentClip : next?.clip ?? null

  const framed = view === 'format'
  // Only a smart crop discards anything. A fit keeps the whole frame and pads
  // it, so there is no slice to outline.
  const cropped = currentClip?.layout === 'smart_crop'
  const thumbnail = currentClip ? artifact(currentClip, 'thumbnail') : ''

  return (
    <section className="player" aria-label="Player">
      <div
        ref={stageRef}
        className={`player__stage player__stage--${view}`}
        style={{
          aspectRatio: framed
            ? `${shape.width} / ${shape.height}`
            : sourceRatio(currentClip),
          ...(thumbnail ? ({ '--stage-thumb': `url("${thumbnail}")` } as object) : {}),
        }}
      >
        {placed.length === 0 || player.missingPreview ? (
          <span className="player__placeholder">
            <Clapperboard size={30} />
          </span>
        ) : null}

        {/* The blurred fill a fit renders against, as the export builds it. */}
        {framed && currentClip?.layout === 'fit_background' && thumbnail && (
          <div className="player__backdrop" aria-hidden="true" />
        )}

        {[0, 1].map((value) => {
          const clip = clipInSlot(value)
          return (
            <video
              key={value}
              ref={videos[value]}
              className={`player__video player__video--${
                framed ? clip?.layout ?? 'fit_background' : 'whole'
              } ${value === slot ? 'is-active' : ''}`}
              style={{ '--crop-x': `${clip?.crop_center_x ?? 50}%` } as object}
              playsInline
              preload="auto"
              // Two different reasons to be silent: this element is not the
              // sound source, or the operator turned the sound off.
              muted={value !== slot || player.muted}
              onTimeUpdate={value === slot ? player.onTimeUpdate : undefined}
              // `timeupdate` stops firing once the media ends, so the last word
              // on whether a Shot is over belongs to the element itself.
              onEnded={value === slot ? player.advance : undefined}
            />
          )
        })}

        {/* Muted, and over the top: the base element below still has the sound. */}
        <video
          ref={player.coverRef}
          className={`player__video player__video--cover player__video--${
            framed ? covering?.clip.layout ?? 'fit_background' : 'whole'
          } ${covering ? 'is-active' : ''}`}
          style={{ '--crop-x': `${covering?.clip.crop_center_x ?? 50}%` } as object}
          playsInline
          preload="auto"
          muted
        />

        {/* In the Source view, what the crop keeps and what it drops. */}
        {!framed && cropped && currentClip && (
          <div
            className="player__kept"
            aria-hidden="true"
            style={{
              left: `${keptLeftPercent(currentClip, format)}%`,
              width: `${keptWidthFraction(currentClip, format) * 100}%`,
            }}
          />
        )}
      </div>

      <ScrubBar
        placed={placed}
        cutaways={player.placedCutaways}
        range={player.range}
        totalMs={totalMs}
        playheadMs={player.playheadMs}
        onScrub={player.onScrub}
      />

      <div className="player__transport">
        <button
          className="icon-button"
          type="button"
          onClick={() => player.jumpCut(-1)}
          disabled={dead}
          aria-label="Previous cut"
          title="Previous cut (Shift ←)"
        >
          <SkipBack size={15} />
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => player.stepFrame(-1)}
          disabled={dead}
          aria-label="Back one frame"
          title="Back one frame (,)"
        >
          <ChevronLeft size={15} />
        </button>
        <button
          className="icon-button icon-button--play"
          type="button"
          onClick={() => player.setPlaying(!playing)}
          disabled={dead}
          aria-label={playing ? 'Pause the rough cut' : 'Play the rough cut'}
          title={playing ? 'Pause (space)' : 'Play (space)'}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => player.stepFrame(1)}
          disabled={dead}
          aria-label="Forward one frame"
          title="Forward one frame (.)"
        >
          <ChevronRight size={15} />
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => player.jumpCut(1)}
          disabled={dead}
          aria-label="Next cut"
          title="Next cut (Shift →)"
        >
          <SkipForward size={15} />
        </button>

        <span className="player__clock">
          {formatTime(Math.min(player.playheadMs, totalMs))} / {formatTime(totalMs)}
        </span>

        <button
          className={`icon-button ${player.muted ? 'is-off' : ''}`}
          type="button"
          onClick={() => player.setMuted(!player.muted)}
          aria-label={player.muted ? 'Unmute' : 'Mute'}
          aria-pressed={player.muted}
          title={player.muted ? 'Unmute (M)' : 'Mute (M)'}
        >
          {player.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <input
          className="player__volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={player.muted ? 0 : player.volume}
          aria-label="Volume"
          onChange={(event) => {
            player.setVolume(Number(event.target.value))
            if (player.muted) player.setMuted(false)
          }}
        />
        <button
          className="icon-button"
          type="button"
          onClick={onFullscreen}
          disabled={dead}
          aria-label="Fullscreen"
          title="Fullscreen (F)"
        >
          <Maximize size={15} />
        </button>
      </div>

      <div className="player__tools">
        <div className="player__rates" role="group" aria-label="Playback speed">
          {RATES.map((option) => (
            <button
              key={option}
              type="button"
              className={player.rate === option ? 'is-active' : ''}
              aria-pressed={player.rate === option}
              onClick={() => player.setRate(option)}
            >
              {option}×
            </button>
          ))}
        </div>

        <button
          className={`chip ${player.looping ? 'is-active' : ''}`}
          type="button"
          onClick={() => player.setLooping(!player.looping)}
          aria-pressed={player.looping}
          disabled={dead}
          title="Loop (R)"
        >
          <Repeat size={13} />
          Loop
        </button>

        <div className="player__views" role="group" aria-label="What the stage shows">
          <button
            type="button"
            className={framed ? 'is-active' : ''}
            aria-pressed={framed}
            onClick={() => setView('format')}
            title={`${shape.name} ${shape.ratio} — the shape being made`}
          >
            <Square size={13} />
            Format
          </button>
          <button
            type="button"
            className={!framed ? 'is-active' : ''}
            aria-pressed={!framed}
            onClick={() => setView('source')}
            title="The whole source frame, and what the crop keeps"
          >
            <Crop size={13} />
            Source
          </button>
        </div>
      </div>

      <div className="player__tools">
        <span className="player__tools-label">Review range</span>
        <button
          className="chip"
          type="button"
          onClick={player.markIn}
          disabled={dead}
          title="Mark the range in-point here ([)"
        >
          <ChevronsRight size={13} />
          In
        </button>
        <button
          className="chip"
          type="button"
          onClick={player.markOut}
          disabled={dead}
          title="Mark the range out-point here (])"
        >
          <ChevronsLeft size={13} />
          Out
        </button>
        <button
          className="chip"
          type="button"
          onClick={player.rangeToSelection}
          disabled={!player.canRangeToSelection}
          title="Set the range to the selected shot, and loop it"
        >
          <Repeat size={13} />
          This shot
        </button>
        {player.range && (
          <>
            <span className="player__range-readout">
              {formatTime(player.range.inMs)}–{formatTime(player.range.outMs)}
            </span>
            <button className="text-button" type="button" onClick={player.clearRange}>
              Clear
            </button>
          </>
        )}
      </div>

      {onTrimToPlayhead && (
        <div className="player__tools">
          <span className="player__tools-label">Trim shot</span>
          <button
            className="chip"
            type="button"
            onClick={() => onTrimToPlayhead('in')}
            disabled={!canTrim}
            title="Set the selected shot's in-point to the playhead (I)"
          >
            In to playhead
          </button>
          <button
            className="chip"
            type="button"
            onClick={() => onTrimToPlayhead('out')}
            disabled={!canTrim}
            title="Set the selected shot's out-point to the playhead (O)"
          >
            Out to playhead
          </button>
          {!canTrim && (
            <small className="player__hint">
              Select the shot the playhead is inside.
            </small>
          )}
        </div>
      )}

      <p className="player__now">
        {covering ? (
          <>
            <strong>{covering.clip.title}</strong>
            <small>covering {current ? current.item.clip.title : 'a shot'}, its sound playing</small>
          </>
        ) : current ? (
          <>
            <strong>{current.item.clip.title}</strong>
            <small>shot {player.index + 1} of {placed.length}</small>
          </>
        ) : (
          <small>Nothing placed yet.</small>
        )}
      </p>

      <p className="player__caveat">
        {framed
          ? 'Rough cut — this plays the source videos, so framing and subtitles apply on export, not here.'
          : 'The whole source frame. The outline is what the vertical crop keeps.'}
      </p>
    </section>
  )
}
