import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import {
  Clapperboard,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Crop,
  Frame,
  ImagePlus,
  Layers,
  Maximize,
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  Save,
  SkipBack,
  SkipForward,
  Square,
  Type,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { api } from '../../api'
import { formatDefinition } from '../../formats/registry'
import { formatTime, formatTimecode } from '../../lib/format'
import { artifact } from '../../lib/project'
import type {
  FontCatalog,
  BatchMedia,
  BatchMediaPatch,
  Format,
  Project,
  Cutaway,
  Shot,
  ShotFraming,
  Title,
  TitlePatch,
} from '../../types'
import { ScrubBar } from './ScrubBar'
import { MediaStage } from './MediaStage'
import { TitleStage } from './TitleStage'
import { usePlayerKeys } from './usePlayerKeys'
import type { SequencePlayer } from './useSequencePlayer'

/** What the stage is showing: the finished shape, or the whole source frame. */
type View = 'format' | 'source'

type FramingGesture = {
  mode: 'move' | 'zoom'
  /**
   * The one centre a move changes. An edge is a handle on its own axis — the
   * left border pans across, the top border pans up and down — so a drag that
   * wanders diagonally still moves the picture along a single axis. `null`
   * while zooming, which moves neither.
   */
  axis: 'x' | 'y' | null
  originX: number
  originY: number
  startDistance: number
  framing: ShotFraming
  latest: ShotFraming
  rect: DOMRect
  layout: Project['layout']
}

/** Half speed to study a cut, double to sit through a long Sequence. */
const RATES = [0.5, 1, 1.5, 2]

const clampPercent = (value: number) => Math.min(100, Math.max(0, value))
const clampZoom = (value: number) => Math.min(3, Math.max(1, value))

/** Which centre each border of the cage pans, in the order they are drawn. */
const EDGE_AXES = [
  ['top', 'y'],
  ['right', 'x'],
  ['bottom', 'y'],
  ['left', 'x'],
] as const satisfies ReadonlyArray<readonly [string, 'x' | 'y']>

/** Move one framing axis by the same geometry the Player and renderer use. */
export function movedFrameCenter({
  center,
  deltaPx,
  stagePx,
  zoom,
  layout,
  fitFraction,
}: {
  center: number
  deltaPx: number
  stagePx: number
  zoom: number
  layout: Project['layout']
  fitFraction: number
}): number {
  if (stagePx <= 0) return center
  const deltaPercent = (deltaPx / stagePx) * 100
  if (layout === 'smart_crop') {
    // At 1× there is no picture outside the Format to pull into view.
    if (zoom <= 1.001) return center
    return clampPercent(center - deltaPercent / (zoom - 1))
  }
  const travelPercent = 100 - fitFraction * 100 * zoom
  if (Math.abs(travelPercent) < 0.01) return center
  return clampPercent(center + (deltaPercent * 100) / travelPercent)
}

/** Pulling a corner radially scales the picture, capped to the slider's range. */
export function pulledFrameZoom(startZoom: number, startDistance: number, distance: number) {
  if (startDistance <= 0) return startZoom
  return clampZoom(startZoom * (distance / startDistance))
}

/** The sharp fitted picture's exact size inside the 1080×1920 Format. */
export function fittedVideoPercent(
  clip: Pick<Project, 'width' | 'height'>,
  zoom: number,
): { width: number; height: number } {
  const sourceWidth = clip.width ?? 16
  const sourceHeight = clip.height ?? 9
  const scale = Math.min((1080 * zoom) / sourceWidth, (1920 * zoom) / sourceHeight)
  return {
    width: ((sourceWidth * scale) / 1080) * 100,
    height: ((sourceHeight * scale) / 1920) * 100,
  }
}

/**
 * Direct-manipulation frame around the selected picture.
 *
 * Only its narrow edges and corners receive pointer events, so Titles remain
 * selectable through the open middle. Sliders below remain the exact and
 * keyboard-accessible path to the same numbers.
 */
function FramingCage({
  stageRef,
  shot,
  clip,
  onPreview,
  onCommit,
}: {
  stageRef: RefObject<HTMLDivElement>
  shot: Shot | Cutaway
  clip: Project
  onPreview: (framing: ShotFraming | null) => void
  onCommit: (framing: ShotFraming) => void
}) {
  const gesture = useRef<FramingGesture | null>(null)
  const [grip, setGrip] = useState<{ mode: 'move' | 'zoom'; axis: 'x' | 'y' | null } | null>(null)

  function begin(
    event: ReactPointerEvent<HTMLElement>,
    nextMode: 'move' | 'zoom',
    axis: 'x' | 'y' | null,
  ) {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const framing = {
      frame_zoom: shot.frame_zoom,
      frame_center_x: shot.frame_center_x,
      frame_center_y: shot.frame_center_y,
    }
    gesture.current = {
      mode: nextMode,
      axis,
      originX: event.clientX,
      originY: event.clientY,
      startDistance: Math.hypot(event.clientX - centerX, event.clientY - centerY),
      framing,
      latest: framing,
      rect,
      layout: clip.layout,
    }
    setGrip({ mode: nextMode, axis })
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const current = gesture.current
    if (!current) return
    let next: ShotFraming
    if (current.mode === 'zoom') {
      const centerX = current.rect.left + current.rect.width / 2
      const centerY = current.rect.top + current.rect.height / 2
      next = {
        ...current.framing,
        frame_zoom: pulledFrameZoom(
          current.framing.frame_zoom,
          current.startDistance,
          Math.hypot(event.clientX - centerX, event.clientY - centerY),
        ),
      }
    } else {
      const fitted = fittedVideoPercent(clip, 1)
      // Only the edge's own axis moves. The other centre is carried through
      // untouched, so a drag that strays sideways cannot nudge it.
      next =
        current.axis === 'x'
          ? {
              ...current.framing,
              frame_center_x: movedFrameCenter({
                center: current.framing.frame_center_x,
                deltaPx: event.clientX - current.originX,
                stagePx: current.rect.width,
                zoom: current.framing.frame_zoom,
                layout: current.layout,
                fitFraction: fitted.width / 100,
              }),
            }
          : {
              ...current.framing,
              frame_center_y: movedFrameCenter({
                center: current.framing.frame_center_y,
                deltaPx: event.clientY - current.originY,
                stagePx: current.rect.height,
                zoom: current.framing.frame_zoom,
                layout: current.layout,
                fitFraction: fitted.height / 100,
              }),
            }
    }
    current.latest = next
    onPreview(next)
  }

  function finish() {
    const current = gesture.current
    gesture.current = null
    setGrip(null)
    onPreview(null)
    if (!current) return
    if (
      current.latest.frame_zoom !== current.framing.frame_zoom ||
      current.latest.frame_center_x !== current.framing.frame_center_x ||
      current.latest.frame_center_y !== current.framing.frame_center_y
    ) onCommit(current.latest)
  }

  function cancel() {
    gesture.current = null
    setGrip(null)
    onPreview(null)
  }

  const gestureProps = {
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: cancel,
  }

  return (
    <div
      className={`player__framing-cage ${grip ? `is-${grip.mode}` : ''}`}
      aria-label={`Framing controls for ${clip.title}`}
    >
      {EDGE_AXES.map(([edge, axis]) => (
        <span
          key={edge}
          className={`player__framing-edge player__framing-edge--${edge}`}
          onPointerDown={(event) => begin(event, 'move', axis)}
          {...gestureProps}
        />
      ))}
      {(['nw', 'ne', 'se', 'sw'] as const).map((corner) => (
        <span
          key={corner}
          className={`player__framing-corner player__framing-corner--${corner}`}
          onPointerDown={(event) => begin(event, 'zoom', null)}
          {...gestureProps}
        />
      ))}
      <span className="player__framing-hint">
        {grip?.mode === 'move'
          ? grip.axis === 'x'
            ? 'Positioning across'
            : 'Positioning up and down'
          : grip?.mode === 'zoom'
            ? 'Scaling'
            : 'Drag edge · pull corner'}
      </span>
    </div>
  )
}

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
 * The largest box of ratio `ratio` that fits inside `room`.
 *
 * Exported because it is the whole of the fitting, and cheaper to test here
 * than through a layout jsdom does not have.
 */
export function fitInside(
  room: { width: number; height: number },
  ratio: number,
): { width: number; height: number } {
  return room.width / room.height > ratio
    ? { width: room.height * ratio, height: room.height }
    : { width: room.width, height: room.width / ratio }
}

/**
 * The stage, sized to whatever room the editing shell leaves around it.
 *
 * Two ratios have to be compared — the Format's and the frame's — and CSS
 * cannot compare them: `height: 100%` overflows a narrow frame, `width: 100%`
 * overflows a short one, and a `max-width`/`max-height` clamp fixes the axis it
 * touches while the other keeps the size it was given. That is a stretched
 * preview of the one shape this Player exists to be exact about (ADR 0007), so
 * the frame is measured instead and the stage takes the box that fits.
 */
function useFittedStage(ratio: number) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const frame = frameRef.current
    // jsdom has neither ResizeObserver nor layout; there the CSS fallback stands.
    if (!frame || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setRoom({ width, height })
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  const fitted = room && room.width > 0 && room.height > 0 ? fitInside(room, ratio) : null
  return { frameRef, fitted }
}

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
  titles = [],
  media = [],
  fontCatalog = null,
  selectedTitleId = null,
  selectedMediaId = null,
  selectedShotId = null,
  titlePreview = null,
  framingPreview = null,
  onSelectTitle,
  onEditTitle,
  onSelectMedia,
  onEditMedia,
  onPreviewFraming,
  onCommitFraming,
  onTrimToPlayhead,
  canTrim = false,
  exportControl = null,
  onAddText,
  canAddText = false,
  onAddMedia,
  canAddMedia = false,
  onOpenProfiles,
}: {
  player: SequencePlayer
  format: Format
  /** The Batch's Titles, timed against the Sequence like the playhead itself. */
  titles?: Title[]
  /** Still images timed against the assembled Sequence. */
  media?: BatchMedia[]
  fontCatalog?: FontCatalog | null
  selectedTitleId?: string | null
  selectedMediaId?: string | null
  selectedShotId?: string | null
  /** An in-flight inspector edit, drawn but not yet sent. */
  titlePreview?: ({ titleId: string } & TitlePatch) | null
  /** An in-flight Shot framing edit, drawn while its slider is moving. */
  framingPreview?: ({ shotId: string } & ShotFraming) | null
  onSelectTitle?: (titleId: string) => void
  onEditTitle?: (title: Title, patch: TitlePatch) => void
  onSelectMedia?: (mediaId: string) => void
  onEditMedia?: (media: BatchMedia, patch: BatchMediaPatch) => void
  onPreviewFraming?: (framing: ShotFraming | null) => void
  onCommitFraming?: (framing: ShotFraming) => void
  /** Set the selected Shot's Trim to the playhead. Absent when nothing can. */
  onTrimToPlayhead?: (edge: 'in' | 'out') => void
  canTrim?: boolean
  /** The Batch-level export action, kept beside playback where it is used. */
  exportControl?: ReactNode
  /** Add a full-length text layer without putting a large action on the Timeline. */
  onAddText?: () => void
  canAddText?: boolean
  /** Open the full-length Sequence image uploader. */
  onAddMedia?: () => void
  canAddMedia?: boolean
  /** Save the visible layers, or apply an arrangement saved from another Batch. */
  onOpenProfiles?: () => void
}) {
  const [view, setView] = useState<View>('format')
  const [guides, setGuides] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const { placed, totalMs, current, next, covering, playing, slot, videos } = player
  const dead = !placed.length
  const addTextTooltip = dead
    ? 'Add a video before adding text'
    : canAddText
      ? 'Add text for the full video'
      : 'All three text layers are already occupied'
  const addMediaTooltip = dead
    ? 'Add a video before adding media'
    : 'Add an image for the full video'
  const profilesTooltip = dead
    ? 'Add a video before using layer profiles'
    : 'Save or reuse a layer profile'

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

  // The secondary controls float over the Player instead of permanently
  // taking space from the picture. Dismiss them like a native popover.
  useEffect(() => {
    if (!moreOpen) return

    function onPointerDown(event: PointerEvent) {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false)
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setMoreOpen(false)
      moreButtonRef.current?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [moreOpen])

  const shape = formatDefinition(format)
  const currentClip = current?.item.clip ?? null
  const clockFps = currentClip?.fps ?? 30
  const stageRatio =
    view === 'format'
      ? shape.width / shape.height
      : (currentClip?.width ?? 16) / (currentClip?.height ?? 9)
  const { frameRef, fitted } = useFittedStage(stageRatio)
  // The cover element holds a Cutaway's Clip; the two swapping elements hold
  // the current Shot's and the next one's, so each is framed by its own Layout.
  const itemInSlot = (value: number) =>
    value === slot ? current?.item ?? null : next

  const frameOf = (shot: Shot | Cutaway): ShotFraming =>
    framingPreview?.shotId === shot.id ? framingPreview : shot

  const videoStyle = (shot: Shot | Cutaway | null, clip: Project | null) => {
    const framing = shot ? frameOf(shot) : null
    const zoom = framing?.frame_zoom ?? 1
    // Calculate the sharp foreground itself, rather than a larger invisible
    // contain box around it. This matches ffmpeg's `scale ... decrease` and
    // makes its visible edge land exactly where the Player says it will.
    const fitted = clip ? fittedVideoPercent(clip, zoom) : { width: 100, height: 100 }
    const fitWidth = fitted.width
    const fitHeight = fitted.height
    const centerX = framing?.frame_center_x ?? 50
    const centerY = framing?.frame_center_y ?? 50
    return {
      '--crop-x': `${clip?.crop_center_x ?? 50}%`,
      '--frame-zoom': zoom,
      '--frame-x': `${centerX}%`,
      '--frame-y': `${centerY}%`,
      '--fit-width': `${fitWidth}%`,
      '--fit-height': `${fitHeight}%`,
      '--fit-left': `${((100 - fitWidth) * centerX) / 100}%`,
      '--fit-top': `${((100 - fitHeight) * centerY) / 100}%`,
    } as object
  }

  const framed = view === 'format'
  // Only a smart crop discards anything. A fit keeps the whole frame and pads
  // it, so there is no slice to outline.
  const cropped = currentClip?.layout === 'smart_crop'
  const thumbnail = currentClip ? artifact(currentClip, 'thumbnail') : ''

  // Whichever Clip is supplying the picture, and where in its own Source Video
  // the playhead is sitting. During a Cutaway that is the Cutaway's Clip.
  const pictureClip = covering?.clip ?? currentClip
  const framingPicture =
    covering?.cutaway.id === selectedShotId
      ? { shot: covering.cutaway, clip: covering.clip }
      : !covering && current?.item.shot.id === selectedShotId
        ? { shot: current.item.shot, clip: current.item.clip }
        : null
  const pictureMs = covering ? player.coverSourceMs ?? 0 : player.sourceMs
  const subtitle = currentClip?.captions.find(
    (segment) => player.sourceMs >= segment.start_ms && player.sourceMs <= segment.end_ms,
  )
  // An inspector edit still under the operator's finger is drawn from here
  // rather than waiting for the round trip, so a size slider moves the text.
  const drawnTitles = titlePreview
    ? titles.map((title) =>
        title.id === titlePreview.titleId ? { ...title, ...titlePreview } : title,
      )
    : titles
  /*
   * The instant the Sequence's layers are drawn at.
   *
   * A layer's span is half-open, so one ending at the Sequence end is not
   * inside itself at `totalMs` — and that is exactly where `advance` parks the
   * playhead when playback finishes, over a last frame the video is still
   * showing. Drawing the final instant instead keeps a full-length Title or
   * image on screen for as long as there is picture under it, while touching
   * spans inside the Sequence stay non-overlapping as `titles_in_span` has it.
   */
  const layerMs = totalMs > 0 ? Math.min(player.playheadMs, totalMs - 1) : player.playheadMs

  return (
    <section className="player" aria-label="Player">
      <div className="player__frame" ref={frameRef}>
        <span
          className="player__clock"
          aria-label={`Playhead and duration at ${Math.round(clockFps)} frames per second`}
        >
          {formatTimecode(Math.min(player.playheadMs, totalMs), clockFps)} /{' '}
          {formatTimecode(totalMs, clockFps)}
        </span>
        <div
          ref={stageRef}
          className={`player__stage player__stage--${view}`}
          style={{
            aspectRatio: framed
              ? `${shape.width} / ${shape.height}`
              : sourceRatio(currentClip),
            ...(fitted ? { width: fitted.width, height: fitted.height } : null),
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
            const item = itemInSlot(value)
            const clip = item?.clip ?? null
            return (
              <video
                key={value}
                ref={videos[value]}
                className={`player__video player__video--${
                  framed ? clip?.layout ?? 'fit_background' : 'whole'
                } ${value === slot ? 'is-active' : ''}`}
                style={videoStyle(item?.shot ?? null, clip)}
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
            style={videoStyle(covering?.cutaway ?? null, covering?.clip ?? null)}
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

          {/*
           * Overlays belong to whichever Clip is supplying the picture, which
           * during a Cutaway is the Cutaway's — the export burns that Clip's
           * Overlays in, with no guard against a covered span.
           */}
          {framed &&
            pictureClip?.image_overlays
              .filter((overlay) => pictureMs >= overlay.start_ms && pictureMs < overlay.end_ms)
              .map((overlay) => (
                <div
                  key={overlay.id}
                  className="player__overlay"
                  aria-hidden="true"
                  style={{
                    left: `${overlay.center_x}%`,
                    top: `${overlay.center_y}%`,
                    width: `${overlay.width_percent}%`,
                    transform: `translate(-50%, -50%) rotate(${overlay.rotation_deg}deg)`,
                  }}
                >
                  <img src={api.mediaUrl(overlay.url)} alt="" style={{ opacity: overlay.opacity }} />
                </div>
              ))}

          {framed && (
            <MediaStage
              media={media}
              playheadMs={layerMs}
              selectedMediaId={selectedMediaId}
              onSelect={(mediaId) => onSelectMedia?.(mediaId)}
              onEdit={(item, patch) => onEditMedia?.(item, patch)}
              editable={Boolean(onEditMedia)}
            />
          )}

          {/*
           * Subtitles, and only where the export burns them.
           *
           * A covered span renders the Cutaway's picture with captions off, so
           * nothing is burned in there at all — not the Cutaway's own, which
           * transcribe audio nobody is hearing, and not the Base Shot's either
           * (ADR 0005, `tasks.py`). Showing either would promise a subtitle the
           * finished video does not have.
           */}
          {framed && !covering && currentClip?.captions_enabled && subtitle && (
            <div
              className={`caption-preview caption-preview--${currentClip.caption_style} caption-preview--position-${currentClip.caption_position}`}
            >
              {subtitle.text}
            </div>
          )}

          {/*
           * Titles, over everything the Clip brought with it.
           *
           * They belong to the Batch and are timed against the Sequence, so
           * unlike Subtitles and Overlays they are unaffected by which Clip is
           * supplying the picture — a Cutaway included (ADR 0008). Drawn only
           * in the Format view, because the Source view shows the whole frame
           * and a Title is placed against the finished one.
           */}
          {framed && (
            <TitleStage
              titles={drawnTitles}
              catalog={fontCatalog}
              playheadMs={layerMs}
              selectedTitleId={selectedTitleId}
              onSelect={(titleId) => onSelectTitle?.(titleId)}
              onEdit={(title, patch) => onEditTitle?.(title, patch)}
              editable={Boolean(onEditTitle)}
            />
          )}

          {framed && framingPicture && onPreviewFraming && onCommitFraming && (
            <FramingCage
              stageRef={stageRef}
              shot={framingPicture.shot}
              clip={framingPicture.clip}
              onPreview={onPreviewFraming}
              onCommit={onCommitFraming}
            />
          )}

          {/* Where Instagram's own chrome will sit over the picture. */}
          {framed && guides && <div className="safe-area" aria-hidden="true" />}

          {covering && (
            <div className="player__badge">
              <span className="player__badge-mark">
                <Layers size={11} /> Cutaway
              </span>
              <span className="player__badge-sound">
                <Volume2 size={11} /> {current ? current.item.clip.title : 'the shot beneath'}
              </span>
            </div>
          )}
        </div>
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
        {(onAddText || onAddMedia || onOpenProfiles) && (
          <span className="player__layer-actions">
            {onAddText && (
              <span className="player__layer-action">
                <button
                  className="player__primary-action player__primary-action--text"
                  type="button"
                  onClick={onAddText}
                  disabled={dead || !canAddText}
                  aria-label="Add text"
                  aria-describedby="add-text-tooltip"
                  title={addTextTooltip}
                >
                  <Type size={16} />
                </button>
                <span className="control-tooltip" id="add-text-tooltip" role="tooltip">
                  {addTextTooltip}
                </span>
              </span>
            )}
            {onAddMedia && (
              <span className="player__layer-action">
                <button
                  className="player__primary-action player__primary-action--media"
                  type="button"
                  onClick={onAddMedia}
                  disabled={dead || !canAddMedia}
                  aria-label="Add media"
                  aria-describedby="add-media-tooltip"
                  title={addMediaTooltip}
                >
                  <ImagePlus size={16} />
                </button>
                <span className="control-tooltip" id="add-media-tooltip" role="tooltip">
                  {addMediaTooltip}
                </span>
              </span>
            )}
            {onOpenProfiles && (
              <span className="player__layer-action">
                <button
                  className="player__primary-action player__primary-action--profile"
                  type="button"
                  onClick={onOpenProfiles}
                  disabled={dead}
                  aria-label="Save or reuse layout"
                  aria-describedby="layer-profiles-tooltip"
                  title={profilesTooltip}
                >
                  <Save size={16} />
                </button>
                <span className="control-tooltip" id="layer-profiles-tooltip" role="tooltip">
                  {profilesTooltip}
                </span>
              </span>
            )}
          </span>
        )}

        <div className="player__primary-controls">
          <button
            className="player__primary-action"
            type="button"
            onClick={() => player.setPlaying(false)}
            disabled={dead || !playing}
            aria-label="Pause the rough cut"
            title="Pause (space)"
          >
            <Pause size={15} />
          </button>
          <button
            className="player__primary-action player__primary-action--play"
            type="button"
            onClick={() => player.setPlaying(true)}
            disabled={dead || playing}
            aria-label="Play the rough cut"
            title="Play (space)"
          >
            <Play size={18} />
          </button>
          {exportControl}
        </div>

        {current && (
          <p className="player__status" aria-live="polite">
            {covering ? (
              <>
                <strong>{covering.clip.title}</strong>
                <span>covering {current.item.clip.title}, its sound playing</span>
              </>
            ) : (
              <>
                <strong>{current.item.clip.title}</strong>
                <span>shot {player.index + 1} of {placed.length}</span>
              </>
            )}
          </p>
        )}

        <div className="player__more" ref={moreRef}>
          <button
            ref={moreButtonRef}
            className={`icon-button player__more-trigger ${moreOpen ? 'is-active' : ''}`}
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-label="More playback options"
            aria-expanded={moreOpen}
            aria-controls="player-more-options"
            title="More playback options"
          >
            <MoreHorizontal size={18} />
          </button>

          {moreOpen && (
            <div
              className="player__more-panel"
              id="player-more-options"
              role="group"
              aria-label="Playback options"
            >
              <div className="player__more-section">
                <span className="player__tools-label">Navigate</span>
                <div className="player__more-row">
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
              </div>

              <div className="player__more-section">
                <span className="player__tools-label">Sound</span>
                <div className="player__more-row player__more-row--sound">
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
                </div>
              </div>

              <div className="player__more-section">
                <span className="player__tools-label">Speed</span>
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
              </div>

              <div className="player__more-section">
                <div className="player__more-row player__more-row--wrap">
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

                  <button
                    className={`chip ${guides ? 'is-active' : ''}`}
                    type="button"
                    onClick={() => setGuides(!guides)}
                    aria-pressed={guides}
                    disabled={!framed}
                    title="Where the app's own buttons will cover the picture"
                  >
                    <Frame size={13} />
                    Safe area
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
              </div>

              <div className="player__more-section">
                <span className="player__tools-label">Review range</span>
                <div className="player__more-row player__more-row--wrap">
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
              </div>

              {onTrimToPlayhead && (
                <div className="player__more-section">
                  <span className="player__tools-label">Trim shot</span>
                  <div className="player__more-row player__more-row--wrap">
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
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/*
       * The caveat says something only where it applies.
       *
       * Framing and Subtitles are now shown, so the blanket warning became
       * untrue. What is still approximate is a smart crop: on export the crop
       * follows faces frame by frame, and CSS can only hold the fallback
       * centre. So it is said while such a Shot is on screen, and not
       * otherwise — a warning shown always is a warning nobody reads.
       *
       * The line itself is always here, empty when there is nothing to say:
       * the stage is sized from what the controls leave over, and a sentence
       * that came and went as playback crossed a cut would resize the picture
       * under the operator mid-scrub.
       */}
      <p className="player__caveat">
        {framed && cropped
          ? "Approximate — this shot's crop follows faces on export, so its framing will shift."
          : !framed && (
              <>
                The whole source frame.{' '}
                {cropped
                  ? 'The outline is what the vertical crop keeps.'
                  : 'This shot is fitted whole, so nothing is cropped away.'}
              </>
            )}
      </p>
    </section>
  )
}
