/**
 * The Clip editor: one Clip, its preview, and everything that changes it.
 *
 * Mode-agnostic on purpose. Every Mode edits a Clip the same way, so the only
 * thing a Mode supplies is the rail beside the editor — the X mode lists loose
 * Clips, Batch Process lists the Clips in one Batch — and whatever the Clip's
 * Origin makes available, such as a link back to the post it came from.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Captions,
  Check,
  Copy,
  Crop,
  Download,
  ExternalLink,
  Focus,
  ImagePlus,
  Images,
  Instagram,
  LoaderCircle,
  Maximize2,
  MessageSquareQuote,
  Move,
  PanelTop,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { api } from '../../api'
import { JobBanner } from '../../components/JobBanner'
import { Segmented } from '../../components/Segmented'
import { Status } from '../../components/Status'
import { formatBytes, formatTime } from '../../lib/format'
import { artifact } from '../../lib/project'
import type { CaptionPosition, CaptionSegment, CaptionStyle, ImageOverlay, Layout, Project, ProjectSettings } from '../../types'

function getSettings(project: Project): ProjectSettings {
  return {
    trim_start_ms: project.trim_start_ms,
    trim_end_ms: project.trim_end_ms ?? project.duration_ms ?? 1,
    layout: project.layout,
    crop_center_x: project.crop_center_x,
    captions_enabled: project.captions_enabled,
    caption_style: project.caption_style,
    caption_position: project.caption_position,
  }
}

const captionStyleDetails: Record<CaptionStyle, { label: string; font: string; size: number; color: string }> = {
  bold: { label: 'Bold', font: 'DejaVu Sans', size: 72, color: '#FFFFFF' },
  classic: { label: 'Classic', font: 'DejaVu Sans', size: 60, color: '#FFFFFF' },
  minimal: { label: 'Minimal', font: 'DejaVu Sans', size: 56, color: '#F5F6F0' },
}

const captionPositionDetails: Record<CaptionPosition, { label: string; description: string }> = {
  top: { label: 'Top', description: 'Upper safe area' },
  middle: { label: 'Middle', description: 'Frame center' },
  bottom: { label: 'Bottom', description: 'Lower safe area' },
}

function captionSample(captions: CaptionSegment[]): string {
  const text = captions.find((caption) => caption.text.trim())?.text.trim()
  if (!text) return 'Your captions, in frame.'
  const words = text.split(/\s+/)
  return words.length > 7 ? `${words.slice(0, 7).join(' ')}…` : text
}

function VideoStage({
  project,
  settings,
  captions,
  outputUrl,
  previewMode,
  onPreviewMode,
  imageOverlays,
  selectedOverlayId,
  onSelectOverlay,
  onChangeOverlay,
  onUploadImage,
  uploadingImage,
}: {
  project: Project
  settings: ProjectSettings
  captions: CaptionSegment[]
  outputUrl: string
  previewMode: 'source' | 'output'
  onPreviewMode: (mode: 'source' | 'output') => void
  imageOverlays: ImageOverlay[]
  selectedOverlayId: string | null
  onSelectOverlay: (id: string) => void
  onChangeOverlay: (id: string, update: Partial<ImageOverlay>) => void
  onUploadImage: (file: File, startMs: number) => void
  uploadingImage: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const timelineTrackRef = useRef<HTMLDivElement>(null)
  const canvasInteraction = useRef<{
    id: string
    mode: 'move' | 'resize'
    clientX: number
    clientY: number
    overlay: ImageOverlay
    rect: DOMRect
  } | null>(null)
  const timelineInteraction = useRef<{
    id: string
    mode: 'move' | 'trim-start' | 'trim-end'
    clientX: number
    overlay: ImageOverlay
    width: number
  } | null>(null)
  const timelineDragged = useRef(false)
  const [timeMs, setTimeMs] = useState(settings.trim_start_ms)
  const previewUrl = artifact(project, 'preview') || artifact(project, 'source')
  const thumbnail = artifact(project, 'thumbnail')
  const shownUrl = previewMode === 'output' && outputUrl ? outputUrl : previewUrl
  const activeCaption = captions.find(
    (segment) => timeMs >= segment.start_ms && timeMs <= segment.end_ms,
  )
  const activeImages = imageOverlays.filter(
    (overlay) => timeMs >= overlay.start_ms && timeMs < overlay.end_ms,
  )
  const duration = project.duration_ms || 1

  function seekTo(nextTimeMs: number) {
    const clamped = Math.min(duration, Math.max(0, nextTimeMs))
    setTimeMs(clamped)
    if (videoRef.current) videoRef.current.currentTime = clamped / 1000
  }

  function beginCanvasInteraction(
    event: React.PointerEvent<HTMLElement>,
    overlay: ImageOverlay,
    mode: 'move' | 'resize',
  ) {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect || previewMode !== 'source') return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelectOverlay(overlay.id)
    canvasInteraction.current = {
      id: overlay.id,
      mode,
      clientX: event.clientX,
      clientY: event.clientY,
      overlay,
      rect,
    }
  }

  function moveCanvasInteraction(event: React.PointerEvent<HTMLElement>) {
    const interaction = canvasInteraction.current
    if (!interaction) return
    const dx = event.clientX - interaction.clientX
    const dy = event.clientY - interaction.clientY
    if (interaction.mode === 'move') {
      onChangeOverlay(interaction.id, {
        center_x: Math.min(100, Math.max(0, interaction.overlay.center_x + dx / interaction.rect.width * 100)),
        center_y: Math.min(100, Math.max(0, interaction.overlay.center_y + dy / interaction.rect.height * 100)),
      })
    } else {
      onChangeOverlay(interaction.id, {
        width_percent: Math.min(100, Math.max(10, interaction.overlay.width_percent + dx / interaction.rect.width * 200)),
      })
    }
  }

  function beginTimelineInteraction(
    event: React.PointerEvent<HTMLElement>,
    overlay: ImageOverlay,
    mode: 'move' | 'trim-start' | 'trim-end',
  ) {
    const width = timelineTrackRef.current?.getBoundingClientRect().width
    if (!width) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelectOverlay(overlay.id)
    timelineDragged.current = false
    timelineInteraction.current = { id: overlay.id, mode, clientX: event.clientX, overlay, width }
  }

  function moveTimelineInteraction(event: React.PointerEvent<HTMLElement>) {
    const interaction = timelineInteraction.current
    if (!interaction) return
    const pixelDelta = event.clientX - interaction.clientX
    if (Math.abs(pixelDelta) > 2) timelineDragged.current = true
    const delta = Math.round((pixelDelta / interaction.width * duration) / 100) * 100
    if (interaction.mode === 'move') {
      const clipDuration = interaction.overlay.end_ms - interaction.overlay.start_ms
      const start = Math.min(duration - clipDuration, Math.max(0, interaction.overlay.start_ms + delta))
      onChangeOverlay(interaction.id, { start_ms: start, end_ms: start + clipDuration })
      seekTo(start)
    } else if (interaction.mode === 'trim-start') {
      const start = Math.min(interaction.overlay.end_ms - 100, Math.max(0, interaction.overlay.start_ms + delta))
      onChangeOverlay(interaction.id, { start_ms: start })
      seekTo(start)
    } else {
      onChangeOverlay(interaction.id, {
        end_ms: Math.min(duration, Math.max(interaction.overlay.start_ms + 100, interaction.overlay.end_ms + delta)),
      })
    }
  }

  useEffect(() => {
    if (videoRef.current && previewMode === 'source') {
      videoRef.current.currentTime = settings.trim_start_ms / 1000
    }
  }, [settings.trim_start_ms, previewMode])

  return (
    <section className="stage-column">
      <div className="stage-toolbar">
        <div className="view-tabs" role="tablist" aria-label="Preview source">
          <button className={previewMode === 'source' ? 'is-active' : ''} onClick={() => onPreviewMode('source')}>Source</button>
          <button disabled={!outputUrl} className={previewMode === 'output' ? 'is-active' : ''} onClick={() => onPreviewMode('output')}>Output</button>
        </div>
        <span>{previewMode === 'output' ? '1080 × 1920' : `${project.width ?? '—'} × ${project.height ?? '—'}`}</span>
      </div>
      <div
        ref={stageRef}
        className={`video-stage video-stage--${settings.layout}`}
        style={{ '--crop-x': `${settings.crop_center_x}%`, '--stage-thumb': `url("${thumbnail}")` } as React.CSSProperties}
      >
        {settings.layout === 'fit_background' && previewMode === 'source' && <div className="video-stage__backdrop" />}
        {shownUrl ? (
          <video
            ref={videoRef}
            key={shownUrl}
            src={shownUrl}
            controls
            playsInline
            onTimeUpdate={(event) => {
              const video = event.currentTarget
              const current = video.currentTime * 1000
              setTimeMs(current)
              if (previewMode === 'source' && current > settings.trim_end_ms) {
                video.currentTime = settings.trim_start_ms / 1000
                if (!video.paused) void video.play()
              }
            }}
          />
        ) : (
          <LoaderCircle className="spin stage-loader" size={36} />
        )}
        {previewMode === 'source' && settings.captions_enabled && activeCaption?.text && (
          <div className={`caption-preview caption-preview--${settings.caption_style} caption-preview--position-${settings.caption_position}`}>{activeCaption.text}</div>
        )}
        {previewMode === 'source' && activeImages.map((overlay) => (
          <div
            role="button"
            tabIndex={0}
            aria-label={`Move ${overlay.name}`}
            className={`image-overlay-preview ${selectedOverlayId === overlay.id ? 'is-selected' : ''}`}
            key={overlay.id}
            style={{
              left: `${overlay.center_x}%`,
              top: `${overlay.center_y}%`,
              width: `${overlay.width_percent}%`,
              transform: `translate(-50%, -50%) rotate(${overlay.rotation_deg}deg)`,
            }}
            onPointerDown={(event) => beginCanvasInteraction(event, overlay, 'move')}
            onPointerMove={moveCanvasInteraction}
            onPointerUp={() => { canvasInteraction.current = null }}
            onPointerCancel={() => { canvasInteraction.current = null }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelectOverlay(overlay.id)
            }}
          >
            <img src={api.mediaUrl(overlay.url)} alt="" draggable={false} style={{ opacity: overlay.opacity }} />
            {selectedOverlayId === overlay.id && (
              <>
                <span className="overlay-move-chip"><Move size={10} /> Drag to move</span>
                <span
                  className="overlay-resize-handle"
                  aria-label="Resize image"
                  onPointerDown={(event) => beginCanvasInteraction(event, overlay, 'resize')}
                ><Maximize2 size={12} /></span>
              </>
            )}
          </div>
        ))}
        <div className="safe-area" aria-hidden="true" />
      </div>
      <div className="edit-timeline" aria-label="Video edit timeline">
        <div className="edit-timeline__head">
          <div>
            <strong>Mini timeline</strong>
            <span>{formatTime(timeMs)} / {formatTime(duration)}</span>
          </div>
          <label className={`add-image-button ${uploadingImage ? 'is-busy' : ''}`}>
            {uploadingImage ? <LoaderCircle className="spin" size={15} /> : <ImagePlus size={15} />}
            {uploadingImage ? 'Adding…' : 'Add image here'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploadingImage || previewMode === 'output'}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onUploadImage(file, timeMs)
                event.target.value = ''
              }}
            />
          </label>
        </div>
        <div className="edit-timeline__ruler" aria-hidden="true">
          {[0, 25, 50, 75, 100].map((percent) => (
            <span key={percent} style={{ left: `${percent}%` }}>{formatTime(duration * percent / 100)}</span>
          ))}
        </div>
        <div className="edit-timeline__tracks">
          <span className="track-label">VIDEO</span>
          <button
            type="button"
            className="timeline-video-track"
            aria-label="Seek video"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              seekTo(((event.clientX - rect.left) / rect.width) * duration)
            }}
          >
            <i
              className="timeline-trim"
              style={{
                left: `${settings.trim_start_ms / duration * 100}%`,
                width: `${(settings.trim_end_ms - settings.trim_start_ms) / duration * 100}%`,
              }}
            />
          </button>
          <span className="track-label"><Images size={11} /> IMAGES</span>
          <div className="timeline-image-track" ref={timelineTrackRef}>
            {imageOverlays.map((overlay, index) => (
              <div
                role="button"
                tabIndex={0}
                key={overlay.id}
                className={`timeline-image-clip ${selectedOverlayId === overlay.id ? 'is-selected' : ''}`}
                style={{
                  left: `${overlay.start_ms / duration * 100}%`,
                  width: `${Math.max(1.5, (overlay.end_ms - overlay.start_ms) / duration * 100)}%`,
                  '--clip-index': index,
                } as React.CSSProperties}
                onClick={() => {
                  if (timelineDragged.current) {
                    timelineDragged.current = false
                    return
                  }
                  onSelectOverlay(overlay.id)
                  seekTo(overlay.start_ms)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    onSelectOverlay(overlay.id)
                    seekTo(overlay.start_ms)
                  }
                }}
                onPointerDown={(event) => beginTimelineInteraction(event, overlay, 'move')}
                onPointerMove={moveTimelineInteraction}
                onPointerUp={() => { timelineInteraction.current = null }}
                onPointerCancel={() => { timelineInteraction.current = null }}
                title={`${overlay.name}: ${formatTime(overlay.start_ms)}–${formatTime(overlay.end_ms)}`}
              >
                <span
                  className="timeline-clip-handle timeline-clip-handle--start"
                  onPointerDown={(event) => beginTimelineInteraction(event, overlay, 'trim-start')}
                  aria-hidden="true"
                />
                <img src={api.mediaUrl(overlay.url)} alt="" />
                <span className="timeline-image-clip__name">{overlay.name}</span>
                <span
                  className="timeline-clip-handle timeline-clip-handle--end"
                  onPointerDown={(event) => beginTimelineInteraction(event, overlay, 'trim-end')}
                  aria-hidden="true"
                />
              </div>
            ))}
            {!imageOverlays.length && <span className="timeline-empty">Add an image at the playhead to start this track.</span>}
          </div>
          <i className="timeline-playhead" style={{ left: `calc(58px + (100% - 58px) * ${timeMs / duration})` }} aria-hidden="true" />
        </div>
      </div>
    </section>
  )
}

function CaptionStylePicker({
  value,
  position,
  captions,
  onChange,
  onPositionChange,
}: {
  value: CaptionStyle
  position: CaptionPosition
  captions: CaptionSegment[]
  onChange: (value: CaptionStyle) => void
  onPositionChange: (value: CaptionPosition) => void
}) {
  const selected = captionStyleDetails[value]
  const sample = captionSample(captions)

  return (
    <div className="caption-style-control">
      <div className="caption-style-options" role="radiogroup" aria-label="Caption style">
        {(Object.keys(captionStyleDetails) as CaptionStyle[]).map((style) => {
          const details = captionStyleDetails[style]
          return (
            <button
              type="button"
              role="radio"
              aria-checked={value === style}
              aria-label={`${details.label}, ${details.font}, ${details.size} pixels, ${details.color}`}
              className={`caption-style-option ${value === style ? 'is-active' : ''}`}
              key={style}
              onClick={() => onChange(style)}
            >
              <span className={`caption-style-option__sample caption-style-option__sample--${style}`}>Aa</span>
              <span>{details.label}</span>
              <small>{details.size} px</small>
            </button>
          )
        })}
      </div>
      <div className="caption-position-control">
        <div className="caption-position-control__label">
          <span>Placement</span>
          <small>{captionPositionDetails[position].description}</small>
        </div>
        <div className="caption-position-options" role="radiogroup" aria-label="Caption placement">
          {(Object.keys(captionPositionDetails) as CaptionPosition[]).map((placement) => (
            <button
              type="button"
              role="radio"
              aria-checked={position === placement}
              aria-label={`Place captions at ${placement}`}
              className={position === placement ? 'is-active' : ''}
              key={placement}
              onClick={() => onPositionChange(placement)}
            >
              <i className={`caption-position-icon caption-position-icon--${placement}`} aria-hidden="true"><span /></i>
              {captionPositionDetails[placement].label}
            </button>
          ))}
        </div>
      </div>
      <div className={`caption-style-preview caption-style-preview--${value}`}>
        <div className="caption-style-preview__head">
          <span>Style preview</span>
          <small>{captionPositionDetails[position].label} placement</small>
        </div>
        <div className={`caption-style-preview__frame caption-style-preview__frame--${position}`}>
          <span className={`caption-style-preview__text caption-style-preview__text--${value}`}>{sample}</span>
        </div>
        <dl>
          <div><dt>Font</dt><dd>{selected.font}</dd></div>
          <div><dt>Size</dt><dd>{selected.size} px</dd></div>
          <div><dt>Color</dt><dd><i style={{ background: selected.color }} />{selected.color}</dd></div>
        </dl>
      </div>
      <p className="caption-placement-note">Centered horizontally with side margins and automatic line wrapping inside the 9:16 safe area.</p>
    </div>
  )
}

function EditorPanel({
  project,
  settings,
  setSettings,
  captions,
  setCaptions,
  socialCaption,
  setSocialCaption,
  imageOverlays,
  setImageOverlays,
  selectedOverlayId,
  onSelectOverlay,
  onDeleteImage,
  onSave,
  onTranscribe,
  onRewriteCaption,
  onRender,
  ownRender,
  saving,
  rendering,
  rewritingCaption,
  shareToFeed,
  setShareToFeed,
}: {
  project: Project
  settings: ProjectSettings
  setSettings: (next: ProjectSettings) => void
  captions: CaptionSegment[]
  setCaptions: (next: CaptionSegment[]) => void
  socialCaption: string
  setSocialCaption: (next: string) => void
  imageOverlays: ImageOverlay[]
  setImageOverlays: (next: ImageOverlay[]) => void
  selectedOverlayId: string | null
  onSelectOverlay: (id: string) => void
  onDeleteImage: (id: string) => void
  onSave: () => void
  onTranscribe: () => void
  onRewriteCaption: () => void
  onRender: () => void
  ownRender: boolean
  saving: boolean
  rendering: boolean
  rewritingCaption: boolean
  shareToFeed: boolean
  setShareToFeed: (next: boolean) => void
}) {
  const [tab, setTab] = useState<'frame' | 'captions' | 'social' | 'images'>('frame')
  const [captionCopied, setCaptionCopied] = useState(false)
  const previousOverlayId = useRef(selectedOverlayId)
  const duration = project.duration_ms ?? 1
  const selectedOverlay = imageOverlays.find((overlay) => overlay.id === selectedOverlayId) ?? imageOverlays[0]

  function updateSelectedOverlay(update: Partial<ImageOverlay>) {
    if (!selectedOverlay) return
    setImageOverlays(imageOverlays.map((overlay) => (
      overlay.id === selectedOverlay.id ? { ...overlay, ...update } : overlay
    )))
  }

  useEffect(() => {
    if (selectedOverlayId && selectedOverlayId !== previousOverlayId.current) setTab('images')
    previousOverlayId.current = selectedOverlayId
  }, [selectedOverlayId])

  return (
    <section className="editor-panel">
      <div className="editor-tabs" role="tablist">
        <button className={tab === 'frame' ? 'is-active' : ''} onClick={() => setTab('frame')}><Crop size={17} /> Frame</button>
        <button className={tab === 'captions' ? 'is-active' : ''} onClick={() => setTab('captions')}><Captions size={17} /> Captions <span>{captions.length}</span></button>
        <button className={tab === 'social' ? 'is-active' : ''} onClick={() => setTab('social')}><MessageSquareQuote size={17} /> Post</button>
        <button className={tab === 'images' ? 'is-active' : ''} onClick={() => {
          setTab('images')
          if (!selectedOverlayId && imageOverlays[0]) onSelectOverlay(imageOverlays[0].id)
        }}><Images size={17} /> Images <span>{imageOverlays.length}</span></button>
      </div>

      <div className="editor-panel__body">
        {tab === 'frame' ? (
          <>
            <div className="control-group">
              <div className="control-label"><span>Layout</span></div>
              <Segmented<Layout>
                value={settings.layout}
                onChange={(layout) => setSettings({ ...settings, layout })}
                options={[
                  { value: 'smart_crop', label: 'Smart crop', icon: <Focus size={16} /> },
                  { value: 'fit_background', label: 'Full frame', icon: <PanelTop size={16} /> },
                ]}
              />
            </div>

            {settings.layout === 'smart_crop' && (
              <div className="control-group">
                <div className="control-label"><span>Fallback focus</span><output>{Math.round(settings.crop_center_x)}%</output></div>
                <input type="range" min="0" max="100" value={settings.crop_center_x} onChange={(event) => setSettings({ ...settings, crop_center_x: Number(event.target.value) })} />
                <div className="range-labels"><span>Left</span><span>Center</span><span>Right</span></div>
              </div>
            )}

            <div className="control-group trim-group">
              <div className="control-label"><span><Scissors size={15} /> Trim</span><output>{formatTime(settings.trim_end_ms - settings.trim_start_ms)}</output></div>
              <label>Start <time>{formatTime(settings.trim_start_ms)}</time></label>
              <input
                type="range"
                min="0"
                max={Math.max(1, settings.trim_end_ms - 100)}
                step="100"
                value={settings.trim_start_ms}
                onChange={(event) => setSettings({ ...settings, trim_start_ms: Number(event.target.value) })}
              />
              <label>End <time>{formatTime(settings.trim_end_ms)}</time></label>
              <input
                type="range"
                min={settings.trim_start_ms + 100}
                max={duration}
                step="100"
                value={settings.trim_end_ms}
                onChange={(event) => setSettings({ ...settings, trim_end_ms: Number(event.target.value) })}
              />
            </div>

            <div className="source-specs">
              <span>Source</span>
              <dl>
                <div><dt>Format</dt><dd>{project.width} × {project.height}</dd></div>
                <div><dt>Frame rate</dt><dd>{project.fps?.toFixed(2) ?? '—'} fps</dd></div>
                <div><dt>Duration</dt><dd>{formatTime(project.duration_ms)}</dd></div>
              </dl>
            </div>
          </>
        ) : tab === 'captions' ? (
          <>
            <div className="caption-head">
              <label className="toggle-row">
                <span>Burn in captions</span>
                <input type="checkbox" checked={settings.captions_enabled} onChange={(event) => setSettings({ ...settings, captions_enabled: event.target.checked })} />
                <i />
              </label>
              <CaptionStylePicker
                value={settings.caption_style}
                position={settings.caption_position}
                captions={captions}
                onChange={(caption_style) => setSettings({ ...settings, caption_style })}
                onPositionChange={(caption_position) => setSettings({ ...settings, caption_position })}
              />
            </div>
            {captions.length ? (
              <div className="caption-list">
                {captions.map((segment, index) => (
                  <div className="caption-row" key={segment.id}>
                    <span>{formatTime(segment.start_ms)}</span>
                    <textarea
                      value={segment.text}
                      rows={2}
                      onChange={(event) => {
                        const next = captions.slice()
                        next[index] = { ...segment, text: event.target.value }
                        setCaptions(next)
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="caption-empty">
                <Captions size={28} />
                <span>{project.transcription_status === 'processing' ? 'Creating captions…' : 'No captions available'}</span>
                <button className="secondary-button" onClick={onTranscribe} disabled={project.transcription_status === 'processing'}>
                  <RefreshCw size={16} /> Retry
                </button>
              </div>
            )}
          </>
        ) : tab === 'social' ? (
          <div className="social-caption-editor">
            <div className="social-caption-editor__intro">
              <div>
                <span>Instagram caption draft</span>
                <strong>Post text travels with the clip.</strong>
              </div>
              <MessageSquareQuote size={25} />
            </div>
            <label className="social-caption-field">
              <span>Extracted from X</span>
              <textarea value={project.source_caption ?? ''} rows={5} readOnly placeholder="No post text was exposed by X." />
            </label>
            <label className="social-caption-field social-caption-field--draft">
              <span>Upload caption <output className={socialCaption.length > 2200 ? 'is-over' : ''}>{socialCaption.length} / 2,200</output></span>
              <textarea
                value={socialCaption}
                rows={8}
                maxLength={5000}
                onChange={(event) => setSocialCaption(event.target.value)}
                placeholder="Write the caption that will accompany the uploaded Reel."
              />
            </label>
            <p className="social-caption-editor__note">
              AI rewrites the surrounding text in brand-safe language and masks profanity. Text inside direct double quotes stays verbatim.
            </p>
            <label className="instagram-feed-option">
              <input
                type="checkbox"
                checked={shareToFeed}
                onChange={(event) => setShareToFeed(event.target.checked)}
              />
              <span><strong>Also share to feed</strong><small>Show the Reel in both your main feed and Reels tab.</small></span>
            </label>
            <div className="social-caption-editor__actions">
              <button className="secondary-button" onClick={() => {
                void navigator.clipboard.writeText(socialCaption).then(() => {
                  setCaptionCopied(true)
                  window.setTimeout(() => setCaptionCopied(false), 1500)
                }).catch(() => setCaptionCopied(false))
              }} disabled={!socialCaption.trim()}>
                {captionCopied ? <Check size={16} /> : <Copy size={16} />} {captionCopied ? 'Copied' : 'Copy'}
              </button>
              <button className="ai-caption-button" onClick={onRewriteCaption} disabled={rewritingCaption || !socialCaption.trim()}>
                {rewritingCaption ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                Rewrite &amp; censor
              </button>
            </div>
          </div>
        ) : selectedOverlay ? (
          <div className="image-editor">
            <div className="image-editor__selected">
              <img src={api.mediaUrl(selectedOverlay.url)} alt="" />
              <div>
                <strong>{selectedOverlay.name}</strong>
                <span>{formatBytes(selectedOverlay.size_bytes)}</span>
              </div>
              <button className="image-delete-button" onClick={() => onDeleteImage(selectedOverlay.id)} title="Remove image overlay">
                <Trash2 size={16} />
              </button>
            </div>
            <div className="image-editor__gesture-hint"><Move size={13} /> Drag in the preview to move · use the corner handle to resize</div>
            <div className="image-quick-tools" aria-label="Quick image tools">
              <button onClick={() => updateSelectedOverlay({ center_x: 50, center_y: 50 })}><Move size={14} /> Center</button>
              <button onClick={() => updateSelectedOverlay({ center_x: 50, center_y: 50, width_percent: 88 })}><Maximize2 size={14} /> Fit safe</button>
              <button onClick={() => updateSelectedOverlay({ center_x: 50, center_y: 50, width_percent: 65, rotation_deg: 0, opacity: 1 })}><RotateCcw size={14} /> Reset</button>
            </div>
            <div className="control-group image-time-controls">
              <div className="control-label"><span>On screen</span><output>{formatTime(selectedOverlay.end_ms - selectedOverlay.start_ms)}</output></div>
              <label>Start <time>{formatTime(selectedOverlay.start_ms)}</time></label>
              <input
                type="range"
                min="0"
                max={Math.max(0, selectedOverlay.end_ms - 100)}
                step="100"
                value={selectedOverlay.start_ms}
                onChange={(event) => updateSelectedOverlay({ start_ms: Number(event.target.value) })}
              />
              <label>End <time>{formatTime(selectedOverlay.end_ms)}</time></label>
              <input
                type="range"
                min={selectedOverlay.start_ms + 100}
                max={duration}
                step="100"
                value={selectedOverlay.end_ms}
                onChange={(event) => updateSelectedOverlay({ end_ms: Number(event.target.value) })}
              />
            </div>
            <div className="control-group">
              <div className="control-label"><span>Image size</span><output>{Math.round(selectedOverlay.width_percent)}%</output></div>
              <input type="range" min="10" max="100" value={selectedOverlay.width_percent} onChange={(event) => updateSelectedOverlay({ width_percent: Number(event.target.value) })} />
              <div className="image-transform-row">
                <label>Rotation <output>{Math.round(selectedOverlay.rotation_deg)}°</output></label>
                <input type="range" min="-180" max="180" step="1" value={selectedOverlay.rotation_deg} onChange={(event) => updateSelectedOverlay({ rotation_deg: Number(event.target.value) })} />
                <label>Opacity <output>{Math.round(selectedOverlay.opacity * 100)}%</output></label>
                <input type="range" min="0.1" max="1" step="0.05" value={selectedOverlay.opacity} onChange={(event) => updateSelectedOverlay({ opacity: Number(event.target.value) })} />
              </div>
            </div>
            <div className="control-group image-position-controls">
              <div className="control-label"><span>Position</span><output>{Math.round(selectedOverlay.center_x)} · {Math.round(selectedOverlay.center_y)}</output></div>
              <label>Horizontal</label>
              <input type="range" min="0" max="100" value={selectedOverlay.center_x} onChange={(event) => updateSelectedOverlay({ center_x: Number(event.target.value) })} />
              <label>Vertical</label>
              <input type="range" min="0" max="100" value={selectedOverlay.center_y} onChange={(event) => updateSelectedOverlay({ center_y: Number(event.target.value) })} />
              <div className="position-pad" aria-label="Position presets">
                {[20, 50, 80].flatMap((centerY) => [20, 50, 80].map((centerX) => (
                  <button
                    key={`${centerX}-${centerY}`}
                    aria-label={`Position image at ${centerX} percent horizontal, ${centerY} percent vertical`}
                    className={Math.abs(selectedOverlay.center_x - centerX) < 6 && Math.abs(selectedOverlay.center_y - centerY) < 6 ? 'is-active' : ''}
                    onClick={() => updateSelectedOverlay({ center_x: centerX, center_y: centerY })}
                  ><i /></button>
                )))}
              </div>
            </div>
            {imageOverlays.length > 1 && (
              <div className="image-layer-list">
                <span>Image clips</span>
                {imageOverlays.map((overlay) => (
                  <button key={overlay.id} className={overlay.id === selectedOverlay.id ? 'is-active' : ''} onClick={() => onSelectOverlay(overlay.id)}>
                    <img src={api.mediaUrl(overlay.url)} alt="" />
                    <span>{overlay.name}</span>
                    <time>{formatTime(overlay.start_ms)}</time>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="image-empty">
            <span><ImagePlus size={27} /></span>
            <strong>No image clips yet</strong>
            <p>Move the playhead under the preview, then choose <em>Add image here</em>.</p>
          </div>
        )}
      </div>

      <div className="editor-actions">
        <button className="icon-command" onClick={onSave} disabled={saving} title="Save edits">
          {saving ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}
        </button>
        {ownRender && (
          <button className="render-button" onClick={onRender} disabled={rendering || project.status !== 'ready'}>
            {rendering ? <LoaderCircle className="spin" size={18} /> : <Play size={18} fill="currentColor" />}
            Render vertical
          </button>
        )}
      </div>
    </section>
  )
}

function ImportFailure({ project }: { project: Project }) {
  const job = project.latest_job
  const error = job?.error_message || project.error_message || 'The importer did not provide an error message.'
  const failedAt = job?.completed_at

  return (
    <section className="fatal-state" role="alert" aria-labelledby="import-failure-title">
      <div className="failure-card__heading">
        <span className="failure-card__icon"><X size={22} /></span>
        <div>
          <p className="eyebrow">Video import</p>
          <h2 id="import-failure-title">{job?.message || 'Import failed'}</h2>
          <p>
            {project.source_post_id
              ? 'The video was not added. Review the diagnostics below, correct the issue, and import the post again.'
              : 'The video was not added. Review the diagnostics below, correct the issue, and upload the file again.'}
          </p>
        </div>
      </div>
      <dl className="failure-card__meta">
        <div>
          <dt>{project.source_post_id ? 'Post' : 'File'}</dt>
          <dd>{project.source_post_id || project.title}</dd>
        </div>
        {job && <div><dt>Attempts</dt><dd>{job.attempts}</dd></div>}
        {failedAt && <div><dt>Failed</dt><dd><time dateTime={failedAt}>{new Date(failedAt).toLocaleString()}</time></dd></div>}
      </dl>
      <details className="failure-card__details" open>
        <summary>Error details</summary>
        <pre>{error}</pre>
      </details>
    </section>
  )
}

export function ClipEditor({ clip: project, rail, collectionKey, ownRender = true }: {
  clip: Project
  /** The Mode's own sidebar, rendered beside the editor. */
  rail: ReactNode
  /**
   * Query key of the collection this Clip was loaded from, refetched whenever
   * an edit lands so the rail and grid outside the editor stay in step.
   */
  collectionKey: readonly unknown[]
  /**
   * Whether this Clip delivers a finished video of its own.
   *
   * False inside a Batch, where the Sequence is the deliverable and a per-Clip
   * Render would only ever be an intermediate. The editing controls are
   * identical either way — a Batch holds no edit settings of its own — so only
   * the output controls differ.
   */
  ownRender?: boolean
}) {
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState<ProjectSettings>(() => getSettings(project))
  const [captions, setCaptions] = useState<CaptionSegment[]>(project.captions)
  const [socialCaption, setSocialCaption] = useState(project.social_caption ?? project.source_caption ?? '')
  const [imageOverlays, setImageOverlays] = useState<ImageOverlay[]>(project.image_overlays)
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<'source' | 'output'>('source')
  const [jobId, setJobId] = useState<string | null>(null)
  const [shareToFeed, setShareToFeed] = useState(true)

  const connectionsQuery = useQuery({
    queryKey: ['platform-connections'],
    queryFn: api.listPlatformConnections,
    // Nothing here publishes when the Batch owns the output.
    enabled: ownRender,
  })

  useEffect(() => {
    setSettings(getSettings(project))
    setCaptions(project.captions)
    setSocialCaption(project.social_caption ?? project.source_caption ?? '')
    setImageOverlays(project.image_overlays)
    setSelectedOverlayId((current) => project.image_overlays.some((overlay) => overlay.id === current)
      ? current
      : null)
  }, [project.id, project.updated_at])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updated = await api.updateProject(project.id, settings)
      if (captions.length) await api.updateCaptions(project.id, captions)
      await api.updateSocialCaption(project.id, socialCaption)
      for (const overlay of imageOverlays) await api.updateImageOverlay(project.id, overlay)
      return updated
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: collectionKey }),
  })
  const renderMutation = useMutation({
    mutationFn: async () => {
      await saveMutation.mutateAsync()
      return api.render(project.id)
    },
    onSuccess: (job) => setJobId(job.id),
  })
  const transcribeMutation = useMutation({
    mutationFn: () => api.transcribe(project.id),
    onSuccess: (job) => setJobId(job.id),
  })
  const rewriteCaptionMutation = useMutation({
    mutationFn: () => api.rewriteSocialCaption(project.id, socialCaption),
    onSuccess: ({ text }) => {
      setSocialCaption(text)
      void queryClient.invalidateQueries({ queryKey: collectionKey })
    },
  })
  const publishMutation = useMutation({
    mutationFn: async ({ renderId }: { renderId: string }) => {
      await api.updateSocialCaption(project.id, socialCaption)
      return api.publishInstagram(renderId, socialCaption, shareToFeed)
    },
    onSuccess: (job) => setJobId(job.id),
  })
  const uploadImageMutation = useMutation({
    mutationFn: ({ file, startMs }: { file: File; startMs: number }) => api.uploadImageOverlay(project.id, file, startMs),
    onSuccess: (overlay) => {
      setImageOverlays((current) => [...current, overlay])
      setSelectedOverlayId(overlay.id)
      void queryClient.invalidateQueries({ queryKey: collectionKey })
    },
  })
  const deleteImageMutation = useMutation({
    mutationFn: (overlayId: string) => api.deleteImageOverlay(project.id, overlayId),
    onSuccess: (_result, overlayId) => {
      setImageOverlays((current) => current.filter((overlay) => overlay.id !== overlayId))
      setSelectedOverlayId((current) => current === overlayId ? null : current)
      void queryClient.invalidateQueries({ queryKey: collectionKey })
    },
  })
  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.getJob(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && ['complete', 'failed'].includes(status) ? false : 1000
    },
  })

  useEffect(() => {
    if (jobQuery.data?.status === 'complete') {
      void queryClient.invalidateQueries({ queryKey: collectionKey })
      if (jobQuery.data.kind === 'render') setPreviewMode('output')
    }
  }, [jobQuery.data?.status, jobQuery.data?.kind, queryClient])

  const completeRender = project.renders.find((render) => render.status === 'complete')
  const outputUrl = api.mediaUrl(completeRender?.download_url ?? null)
  const instagramAccount = connectionsQuery.data
    ?.find((connection) => connection.platform === 'instagram')?.account
  const instagramPublication = completeRender?.publications
    ?.find((publication) => publication.platform === 'instagram')
  const postingToInstagram = publishMutation.isPending
    || Boolean(instagramPublication && ['queued', 'processing', 'publishing'].includes(instagramPublication.status))

  return (
    <div className="workspace-shell">
      {rail}
      <main className="workspace">
        <div className="workspace-title">
          <div>
            <div className="workspace-title__meta">
              <Status value={project.status} />
              <span>{project.source_post_id ? `Post ${project.source_post_id}` : 'Uploaded video'}</span>
            </div>
            <h1>{project.title}</h1>
          </div>
          <div className="workspace-title__actions">
            {project.source_url && (
              <a className="icon-command" href={project.source_url} target="_blank" rel="noreferrer" title="Open source post"><ExternalLink size={18} /></a>
            )}
            {!ownRender ? null : completeRender && instagramPublication?.status === 'complete' ? (
              <a
                className="instagram-publish-button is-complete"
                href={instagramPublication.permalink ?? undefined}
                target={instagramPublication.permalink ? '_blank' : undefined}
                rel={instagramPublication.permalink ? 'noreferrer' : undefined}
                aria-disabled={!instagramPublication.permalink}
              ><Check size={17} /> Posted</a>
            ) : completeRender && instagramAccount?.status === 'connected' ? (
              <button
                className="instagram-publish-button"
                type="button"
                onClick={() => publishMutation.mutate({ renderId: completeRender.id })}
                disabled={postingToInstagram}
              >
                {postingToInstagram ? <LoaderCircle className="spin" size={17} /> : <Instagram size={17} />}
                {postingToInstagram ? 'Posting…' : instagramPublication?.status === 'failed' ? 'Retry Instagram' : 'Post to Instagram'}
              </button>
            ) : completeRender ? (
              <a className="instagram-publish-button is-connect" href="/settings"><Instagram size={17} /> Connect Instagram</a>
            ) : null}
            {ownRender && completeRender?.download_url && (
              <a className="download-button" href={outputUrl} download><Download size={18} /> Download <span>{formatBytes(completeRender.size_bytes)}</span></a>
            )}
          </div>
        </div>

        {project.status === 'failed' ? (
          <ImportFailure project={project} />
        ) : (
          <div className="editing-grid">
            <VideoStage
              project={project}
              settings={settings}
              captions={captions}
              outputUrl={outputUrl}
              previewMode={previewMode}
              onPreviewMode={setPreviewMode}
              imageOverlays={imageOverlays}
              selectedOverlayId={selectedOverlayId}
              onSelectOverlay={setSelectedOverlayId}
              onChangeOverlay={(id, update) => setImageOverlays((current) => current.map((overlay) => (
                overlay.id === id ? { ...overlay, ...update } : overlay
              )))}
              onUploadImage={(file, startMs) => uploadImageMutation.mutate({ file, startMs })}
              uploadingImage={uploadImageMutation.isPending}
            />
            <EditorPanel
              project={project}
              settings={settings}
              setSettings={setSettings}
              captions={captions}
              setCaptions={setCaptions}
              socialCaption={socialCaption}
              setSocialCaption={setSocialCaption}
              imageOverlays={imageOverlays}
              setImageOverlays={setImageOverlays}
              selectedOverlayId={selectedOverlayId}
              onSelectOverlay={setSelectedOverlayId}
              onDeleteImage={(id) => deleteImageMutation.mutate(id)}
              onSave={() => saveMutation.mutate()}
              onTranscribe={() => transcribeMutation.mutate()}
              onRewriteCaption={() => rewriteCaptionMutation.mutate()}
              onRender={() => renderMutation.mutate()}
              ownRender={ownRender}
              saving={saveMutation.isPending || deleteImageMutation.isPending}
              rendering={renderMutation.isPending || (jobQuery.data?.kind === 'render' && !['complete', 'failed'].includes(jobQuery.data.status))}
              rewritingCaption={rewriteCaptionMutation.isPending}
              shareToFeed={shareToFeed}
              setShareToFeed={setShareToFeed}
            />
          </div>
        )}
        {jobQuery.data && <JobBanner job={jobQuery.data} />}
        {renderMutation.error && <div className="toast-error">{renderMutation.error.message}</div>}
        {publishMutation.error && <div className="toast-error">{publishMutation.error.message}</div>}
        {uploadImageMutation.error && <div className="toast-error">{uploadImageMutation.error.message}</div>}
        {deleteImageMutation.error && <div className="toast-error">{deleteImageMutation.error.message}</div>}
        {rewriteCaptionMutation.error && <div className="toast-error">{rewriteCaptionMutation.error.message}</div>}
      </main>
    </div>
  )
}
