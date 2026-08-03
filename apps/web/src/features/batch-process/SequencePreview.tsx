import { useEffect, useRef, useState } from 'react'
import { Clapperboard, Pause, Play, SkipBack } from 'lucide-react'
import { formatTime } from '../../lib/format'
import { artifact } from '../../lib/project'
import type { Cutaway, Project, Shot } from '../../types'
import { layout, layoutCutaways, shotAt, shotTrim, sourceTimeMs } from './Timeline'

/** The preview Artifact, falling back to the Source Video as ClipEditor does. */
export function previewUrl(clip: Project): string | null {
  return artifact(clip, 'preview') || artifact(clip, 'source') || null
}

/** How far the video may drift before a seek is a correction rather than a jump. */
const SEEK_TOLERANCE_MS = 300

/**
 * The Sequence as one rough cut.
 *
 * There is otherwise no way to watch a Batch without exporting it, and a
 * playhead you cannot play is not much of an editor. This chains the Clips'
 * existing `preview` Artifacts, switching at Shot boundaries and seeking to
 * each Shot's in-point.
 *
 * Those previews are the Source Video scaled down — **landscape, uncropped and
 * unsubtitled**. So this shows order, timing, and where the cuts fall, and says
 * so; it does not show the finished framing. A server-rendered proxy would be
 * accurate but costs minutes per build and is stale the moment a Shot moves,
 * which makes it the export button with extra steps (ADR 0004).
 *
 * Two elements rather than one: switching `src` on a single element black-
 * flashes and drops audio at every cut, so the next Shot is loaded and seeked
 * on the idle element while the current one plays, and they swap at the join.
 *
 * A Cutaway plays as a third element laid over the top, muted, while the Base
 * Shot underneath keeps supplying the sound — which is exactly what the export
 * does, so the rough cut does not mislead about the one thing Cutaways change.
 */
export function SequencePreview({
  shots,
  cutaways,
  clips,
  playheadMs,
  onScrub,
}: {
  shots: Shot[]
  cutaways: Cutaway[]
  clips: Project[]
  playheadMs: number
  onScrub: (ms: number) => void
}) {
  const [playing, setPlaying] = useState(false)
  const [slot, setSlot] = useState(0)
  const videos = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)]
  const coverRef = useRef<HTMLVideoElement>(null)

  const placed = layout(shots, clips)
  const totalMs = placed.reduce((sum, item) => sum + item.spanMs, 0)
  const current = shotAt(placed, playheadMs)
  const index = current ? placed.indexOf(current.item) : -1
  const next = index >= 0 ? placed[index + 1] ?? null : null

  const active = videos[slot]
  const idle = videos[1 - slot]

  // Whichever Cutaway is over the playhead, if any.
  const placedCutaways = layoutCutaways(cutaways, placed, clips)
  const covering =
    placedCutaways.find(
      (item) => playheadMs >= item.startMs && playheadMs < item.startMs + item.spanMs,
    ) ?? null

  useEffect(() => {
    const video = coverRef.current
    if (!video || !covering) return
    const url = previewUrl(covering.clip)
    if (!url) return
    if (video.getAttribute('src') !== url) video.setAttribute('src', url)
    const wanted =
      shotTrim(covering.cutaway, covering.clip).start + (playheadMs - covering.startMs)
    if (Math.abs(video.currentTime * 1000 - wanted) > SEEK_TOLERANCE_MS) {
      video.currentTime = wanted / 1000
    }
  }, [covering?.cutaway.id, covering?.startMs, playheadMs])

  useEffect(() => {
    const video = coverRef.current
    if (!video) return
    if (playing && covering) void video.play().catch(() => undefined)
    else video.pause()
  }, [playing, covering?.cutaway.id])

  // Keep the visible element on the right Clip at the right frame. A seek only
  // happens when it has drifted — during playback the video's own clock is
  // already right, and correcting it every tick would stutter.
  useEffect(() => {
    const video = active.current
    if (!video || !current) return
    const url = previewUrl(current.item.clip)
    if (!url) return
    if (video.getAttribute('src') !== url) video.setAttribute('src', url)
    const wanted = sourceTimeMs(current.item, current.intoShotMs)
    if (Math.abs(video.currentTime * 1000 - wanted) > SEEK_TOLERANCE_MS) {
      video.currentTime = wanted / 1000
    }
  }, [active, current?.item.shot.id, current?.intoShotMs, playheadMs])

  // Prime the other element with whatever comes next, so the swap is instant.
  useEffect(() => {
    const video = idle.current
    if (!video || !next) return
    const url = previewUrl(next.clip)
    if (!url) return
    if (video.getAttribute('src') !== url) video.setAttribute('src', url)
    video.currentTime = shotTrim(next.shot, next.clip).start / 1000
  }, [idle, next?.shot.id])

  useEffect(() => {
    const video = active.current
    if (!video) return
    if (playing) void video.play().catch(() => setPlaying(false))
    else video.pause()
    videos[1 - slot].current?.pause()
  }, [playing, slot, current?.item.shot.id])

  // Stopping playback when the Sequence is edited out from under it avoids a
  // playhead chasing Shots that have moved.
  useEffect(() => setPlaying(false), [shots.length])

  function onTimeUpdate() {
    const video = active.current
    if (!video || !current) return
    const { start, end } = shotTrim(current.item.shot, current.item.clip)
    const atMs = video.currentTime * 1000

    if (atMs >= end) {
      if (!next) {
        setPlaying(false)
        onScrub(totalMs)
        return
      }
      // Hand over to the element already sitting on the next Shot's in-point.
      setSlot((value) => 1 - value)
      onScrub(current.item.startMs + current.item.spanMs)
      return
    }
    onScrub(current.item.startMs + Math.max(0, atMs - start))
  }

  const missingPreview = current ? !previewUrl(current.item.clip) : false

  return (
    <section className="preview" aria-label="Rough cut">
      <div className="preview__screen">
        {placed.length === 0 || missingPreview ? (
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
            onTimeUpdate={value === slot ? onTimeUpdate : undefined}
          />
        ))}
        {/* Muted, and over the top: the base element below still has the sound. */}
        <video
          ref={coverRef}
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
            onClick={() => {
              setPlaying(false)
              onScrub(0)
            }}
            disabled={!placed.length}
            aria-label="Back to the start"
            title="Back to the start"
          >
            <SkipBack size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => setPlaying((value) => !value)}
            disabled={!placed.length}
            aria-label={playing ? 'Pause the rough cut' : 'Play the rough cut'}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <span className="preview__clock">
            {formatTime(Math.min(playheadMs, totalMs))} / {formatTime(totalMs)}
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
