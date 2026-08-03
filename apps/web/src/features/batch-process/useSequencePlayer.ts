import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { artifact } from '../../lib/project'
import type { Cutaway, Project, Shot } from '../../types'
import {
  layout,
  layoutCutaways,
  shotAt,
  shotTrim,
  sourceTimeMs,
  type Placed,
  type PlacedCutaway,
} from './Timeline'

/** The preview Artifact, falling back to the Source Video as ClipEditor does. */
export function previewUrl(clip: Project): string | null {
  return artifact(clip, 'preview') || artifact(clip, 'source') || null
}

/** How far the video may drift before a seek is a correction rather than a jump. */
const SEEK_TOLERANCE_MS = 300

/** About two frames at 30 fps. */
const BOUNDARY_TOLERANCE_MS = 60

/**
 * Whether playback has run out of this Shot and should hand over to the next.
 *
 * A Clip's Trim end is the duration ffprobe read from its Source Video, but
 * what plays here is the `preview` Artifact — a re-encode, which can be a frame
 * or two shorter. A Shot trimmed to the very end therefore never reaches its
 * own end: `currentTime` stops just below it, the element fires `ended` instead
 * of another `timeupdate`, and the Sequence stalls after one Shot. So the
 * media's own duration ends the Shot too, whatever the Clip recorded.
 */
export function shotIsOver(
  atMs: number,
  endMs: number,
  mediaDurationMs: number | null,
): boolean {
  if (atMs >= endMs - BOUNDARY_TOLERANCE_MS) return true
  return mediaDurationMs !== null && atMs >= mediaDurationMs - BOUNDARY_TOLERANCE_MS
}

/** Everything the Player renders, and everything that drives it. */
export interface SequencePlayer {
  /** Echoed back so the Player reads and moves the playhead from one place. */
  playheadMs: number
  onScrub: (ms: number) => void
  playing: boolean
  setPlaying: (playing: boolean) => void
  /** Index of the visible element; the other one is holding the next Shot. */
  slot: number
  videos: [RefObject<HTMLVideoElement>, RefObject<HTMLVideoElement>]
  coverRef: RefObject<HTMLVideoElement>
  placed: Placed[]
  totalMs: number
  /** The Shot under the playhead, and how far into it the playhead sits. */
  current: { item: Placed; intoShotMs: number } | null
  /** The Shot the idle element is holding, so the stage can frame it too. */
  next: Placed | null
  /** Its position in the running order, or -1 when nothing is placed. */
  index: number
  /** Every Cutaway against the Sequence, for the scrub bar to mark. */
  placedCutaways: PlacedCutaway[]
  /** Whichever Cutaway is over the playhead, if any. */
  covering: PlacedCutaway | null
  /** True when the Shot under the playhead has no preview to play. */
  missingPreview: boolean
  onTimeUpdate: () => void
  advance: () => void
  restart: () => void
}

/**
 * Playing a Sequence as one video.
 *
 * The arithmetic lives here rather than in the component for two reasons: the
 * Timeline and a page-level keymap both need to drive the same playhead, and
 * jsdom implements no media element at all — so anything left inside a
 * component that renders `<video>` cannot be tested without one.
 *
 * Two elements rather than one: switching `src` on a single element black-
 * flashes and drops audio at every cut, so the next Shot is loaded and seeked
 * on the idle element while the current one plays, and they swap at the join.
 *
 * A Cutaway plays as a third element laid over the top, muted, while the Base
 * Shot underneath keeps supplying the sound — which is exactly what the export
 * does, so the rough cut does not mislead about the one thing Cutaways change.
 */
export function useSequencePlayer({
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
}): SequencePlayer {
  const [playing, setPlaying] = useState(false)
  const [slot, setSlot] = useState(0)
  const videos: [RefObject<HTMLVideoElement>, RefObject<HTMLVideoElement>] = [
    useRef<HTMLVideoElement>(null),
    useRef<HTMLVideoElement>(null),
  ]
  const coverRef = useRef<HTMLVideoElement>(null)

  const placed = layout(shots, clips)
  const totalMs = placed.reduce((sum, item) => sum + item.spanMs, 0)
  const current = shotAt(placed, playheadMs)
  const index = current ? placed.indexOf(current.item) : -1
  const next = index >= 0 ? placed[index + 1] ?? null : null

  const active = videos[slot]
  const idle = videos[1 - slot]

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

  /** Move to the next Shot, or stop if this was the last. */
  function advance() {
    if (!current) return
    if (!next) {
      setPlaying(false)
      onScrub(totalMs)
      return
    }
    // Hand over to the element already sitting on the next Shot's in-point.
    setSlot((value) => 1 - value)
    onScrub(current.item.startMs + current.item.spanMs)
  }

  function onTimeUpdate() {
    const video = active.current
    if (!video || !current) return
    const { start, end } = shotTrim(current.item.shot, current.item.clip)
    const atMs = video.currentTime * 1000

    if (shotIsOver(atMs, end, Number.isFinite(video.duration) ? video.duration * 1000 : null)) {
      advance()
      return
    }
    onScrub(current.item.startMs + Math.max(0, atMs - start))
  }

  function restart() {
    setPlaying(false)
    onScrub(0)
  }

  return {
    playheadMs,
    onScrub,
    playing,
    setPlaying,
    slot,
    videos,
    coverRef,
    placed,
    totalMs,
    current,
    next,
    index,
    placedCutaways,
    covering,
    missingPreview: current ? !previewUrl(current.item.clip) : false,
    onTimeUpdate,
    advance,
    restart,
  }
}
