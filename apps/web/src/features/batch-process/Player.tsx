import { useState } from 'react'
import { Clapperboard, Crop, Pause, Play, SkipBack, Square } from 'lucide-react'
import { formatDefinition } from '../../formats/registry'
import { formatTime } from '../../lib/format'
import { artifact } from '../../lib/project'
import type { Format, Project } from '../../types'
import { ScrubBar } from './ScrubBar'
import type { SequencePlayer } from './useSequencePlayer'

/** What the stage is showing: the finished shape, or the whole source frame. */
type View = 'format' | 'source'

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
export function Player({ player, format }: { player: SequencePlayer; format: Format }) {
  const [view, setView] = useState<View>('format')
  const { placed, totalMs, current, next, covering, playing, slot, videos } = player

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
              muted={value !== slot}
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
        totalMs={totalMs}
        playheadMs={player.playheadMs}
        onScrub={player.onScrub}
      />

      <div className="player__transport">
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
        <span className="player__clock">
          {formatTime(Math.min(player.playheadMs, totalMs))} / {formatTime(totalMs)}
        </span>

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
