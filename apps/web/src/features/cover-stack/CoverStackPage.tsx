import {
  Check,
  Download,
  ImagePlus,
  Images,
  Move,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Upload,
  X,
  ZoomIn,
} from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'

const COVER_WIDTH = 1080
const COVER_HEIGHT = 1920
const PANEL_HEIGHT = COVER_HEIGHT / 4
const PANEL_ASPECT = COVER_WIDTH / PANEL_HEIGHT
const MAX_ZOOM = 4

interface FramedPhoto {
  id: string
  file: File
  url: string
  width: number
  height: number
  zoom: number
  positionX: number
  positionY: number
}

type Gesture = {
  pointers: Map<number, { x: number; y: number }>
  dragStart?: { x: number; y: number; positionX: number; positionY: number }
  pinchStart?: { distance: number; zoom: number }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function distance(points: Array<{ x: number; y: number }>) {
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
}

function loadPhoto(file: File): Promise<FramedPhoto> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve({
      id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      url,
      width: image.naturalWidth,
      height: image.naturalHeight,
      zoom: 1,
      positionX: 50,
      positionY: 50,
    })
    image.onerror = () => {
      URL.revokeObjectURL?.(url)
      reject(new Error(`${file.name} could not be opened.`))
    }
    image.src = url
  })
}

function photoStyle(photo: FramedPhoto): CSSProperties {
  const sourceAspect = photo.width / photo.height
  return {
    backgroundImage: `url("${photo.url}")`,
    backgroundPosition: `${photo.positionX}% ${photo.positionY}%`,
    backgroundSize: sourceAspect > PANEL_ASPECT
      ? `auto ${photo.zoom * 100}%`
      : `${photo.zoom * 100}% auto`,
  }
}

function loadDrawable(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('One of the photos could not be prepared.'))
    image.src = url
  })
}

export function drawCoverPanel(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  photo: Pick<FramedPhoto, 'width' | 'height' | 'zoom' | 'positionX' | 'positionY'>,
  index: number,
) {
  const scale = Math.max(COVER_WIDTH / photo.width, PANEL_HEIGHT / photo.height) * photo.zoom
  const drawnWidth = photo.width * scale
  const drawnHeight = photo.height * scale
  const x = (COVER_WIDTH - drawnWidth) * (photo.positionX / 100)
  const y = index * PANEL_HEIGHT + (PANEL_HEIGHT - drawnHeight) * (photo.positionY / 100)
  context.save()
  context.beginPath()
  context.rect(0, index * PANEL_HEIGHT, COVER_WIDTH, PANEL_HEIGHT)
  context.clip()
  context.drawImage(source, x, y, drawnWidth, drawnHeight)
  context.restore()
}

function Panel({
  photo,
  index,
  active = false,
  onClick,
}: {
  photo: FramedPhoto | null
  index: number
  active?: boolean
  onClick?: () => void
}) {
  const contents = <>
      {!photo && <span><ImagePlus size={18} />Add photo {index + 1}</span>}
      {photo && onClick && (
        <span className="cover-stack-panel__edit"><Move size={15} />Adjust framing</span>
      )}
      <b className="cover-stack-panel__number">{String(index + 1).padStart(2, '0')}</b>
    </>
  const className = `cover-stack-panel ${photo ? 'has-photo' : ''} ${active ? 'is-active' : ''}`
  if (onClick) return (
    <button
      className={className}
      style={photo ? photoStyle(photo) : undefined}
      onClick={onClick}
      type="button"
      aria-label={photo ? `Edit photo ${index + 1}: ${photo.file.name}` : `Add photo ${index + 1}`}
    >
      {contents}
    </button>
  )
  return <div className={className} style={photo ? photoStyle(photo) : undefined}>{contents}</div>
}

function CoverEditor({
  photos,
  activeIndex,
  onActiveIndexChange,
  onChange,
  onReplace,
  onClose,
}: {
  photos: Array<FramedPhoto | null>
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  onChange: (index: number, update: Partial<FramedPhoto>) => void
  onReplace: (index: number) => void
  onClose: () => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture>({ pointers: new Map() })
  const activePhoto = photos[activeIndex]

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  if (!activePhoto) return null
  const currentPhoto = activePhoto

  function updatePosition(deltaX: number, deltaY: number, startX: number, startY: number) {
    if (!activePhoto || !editorRef.current) return
    const bounds = editorRef.current.getBoundingClientRect()
    const coverScale = Math.max(bounds.width / activePhoto.width, bounds.height / activePhoto.height)
      * activePhoto.zoom
    const overflowX = bounds.width - activePhoto.width * coverScale
    const overflowY = bounds.height - activePhoto.height * coverScale
    onChange(activeIndex, {
      positionX: Math.abs(overflowX) < 0.5 ? 50 : clamp(startX + (deltaX / overflowX) * 100, 0, 100),
      positionY: Math.abs(overflowY) < 0.5 ? 50 : clamp(startY + (deltaY / overflowY) * 100, 0, 100),
    })
  }

  function finishPointer(pointerId: number) {
    const gesture = gestureRef.current
    gesture.pointers.delete(pointerId)
    gesture.pinchStart = undefined
    const remaining = [...gesture.pointers.values()][0]
    gesture.dragStart = remaining ? {
      x: remaining.x,
      y: remaining.y,
      positionX: currentPhoto.positionX,
      positionY: currentPhoto.positionY,
    } : undefined
  }

  return (
    <div className="cover-editor-backdrop" role="presentation">
      <section className="cover-editor" role="dialog" aria-modal="true" aria-labelledby="cover-editor-title">
        <header className="cover-editor__header">
          <div>
            <span className="cover-editor__step">Panel {activeIndex + 1} of 4</span>
            <h2 id="cover-editor-title">Frame this strip</h2>
          </div>
          <p><Check size={14} />The other three panels are locked</p>
          <button type="button" onClick={onClose} aria-label="Close photo editor" autoFocus>
            <X size={20} /><span>Done</span>
          </button>
        </header>

        <div className="cover-editor__body">
          <aside className="cover-editor__cover">
            <div className="cover-editor__cover-head">
              <span>Whole cover · live</span>
              <small>1080 × 1920</small>
            </div>
            <div className="cover-editor__stack" aria-label="Live whole cover preview">
              {photos.map((photo, index) => (
                <Panel key={photo?.id ?? index} photo={photo} index={index} active={index === activeIndex} onClick={photo ? () => onActiveIndexChange(index) : undefined} />
              ))}
            </div>
            <p>Tap another strip to switch without closing the editor.</p>
          </aside>

          <main className="cover-editor__stage">
            <div className="cover-editor__stage-head">
              <div><span className="status-dot" />Editing photo {activeIndex + 1}</div>
              <small>{activePhoto.file.name}</small>
            </div>
            <div
              ref={editorRef}
              className="cover-editor__viewport"
              style={photoStyle(activePhoto)}
              role="img"
              aria-label={`Framing editor for photo ${activeIndex + 1}`}
              onWheel={(event) => {
                event.preventDefault()
                onChange(activeIndex, { zoom: clamp(activePhoto.zoom - event.deltaY * 0.002, 1, MAX_ZOOM) })
              }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                const gesture = gestureRef.current
                gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
                if (gesture.pointers.size === 1) {
                  gesture.dragStart = {
                    x: event.clientX,
                    y: event.clientY,
                    positionX: activePhoto.positionX,
                    positionY: activePhoto.positionY,
                  }
                } else if (gesture.pointers.size === 2) {
                  gesture.pinchStart = {
                    distance: distance([...gesture.pointers.values()]),
                    zoom: activePhoto.zoom,
                  }
                }
              }}
              onPointerMove={(event) => {
                const gesture = gestureRef.current
                if (!gesture.pointers.has(event.pointerId)) return
                gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
                if (gesture.pointers.size >= 2 && gesture.pinchStart) {
                  const nextDistance = distance([...gesture.pointers.values()])
                  onChange(activeIndex, {
                    zoom: clamp(gesture.pinchStart.zoom * nextDistance / gesture.pinchStart.distance, 1, MAX_ZOOM),
                  })
                } else if (gesture.dragStart) {
                  updatePosition(
                    event.clientX - gesture.dragStart.x,
                    event.clientY - gesture.dragStart.y,
                    gesture.dragStart.positionX,
                    gesture.dragStart.positionY,
                  )
                }
              }}
              onPointerUp={(event) => finishPointer(event.pointerId)}
              onPointerCancel={(event) => finishPointer(event.pointerId)}
            >
              <div className="cover-editor__thirds" aria-hidden="true"><i /><i /><i /><i /></div>
              <div className="cover-editor__drag-hint"><Move size={18} />Drag to reposition · pinch or scroll to zoom</div>
            </div>

            <div className="cover-editor__controls">
              <label>
                <span><ZoomIn size={16} />Zoom</span>
                <input
                  type="range"
                  min="1"
                  max={MAX_ZOOM}
                  step="0.01"
                  value={activePhoto.zoom}
                  onChange={(event) => onChange(activeIndex, { zoom: Number(event.target.value) })}
                  aria-label={`Photo ${activeIndex + 1} zoom`}
                />
                <output>{activePhoto.zoom.toFixed(2)}×</output>
              </label>
              <div className="cover-editor__control-actions">
                <button type="button" onClick={() => onChange(activeIndex, { zoom: 1, positionX: 50, positionY: 50 })}>
                  <RotateCcw size={15} />Reset
                </button>
                <button type="button" onClick={() => onReplace(activeIndex)}>
                  <RefreshCw size={15} />Replace photo
                </button>
              </div>
            </div>
          </main>
        </div>
      </section>
    </div>
  )
}

export function CoverStackPage({
  onUseCover,
}: {
  onUseCover?: (file: File) => Promise<void>
} = {}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const replaceIndexRef = useRef<number | null>(null)
  const urlsRef = useRef(new Set<string>())
  const [photos, setPhotos] = useState<Array<FramedPhoto | null>>([null, null, null, null])
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isUsingCover, setIsUsingCover] = useState(false)
  const photoCount = photos.filter(Boolean).length
  const isReady = photoCount === 4

  useEffect(() => () => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL?.(url))
  }, [])

  function openPicker(index: number | null = null) {
    replaceIndexRef.current = index
    if (inputRef.current) {
      inputRef.current.multiple = index === null
      inputRef.current.click()
    }
  }

  async function acceptFiles(fileList: FileList | null) {
    const files = [...(fileList ?? [])]
    if (!files.length) return
    setError(null)
    const invalid = files.find((file) => !file.type.startsWith('image/'))
    if (invalid) {
      setError('Choose image files only.')
      return
    }
    const replaceIndex = replaceIndexRef.current
    try {
      const available = replaceIndex === null ? 4 - photoCount : 1
      const chosen = files.slice(0, available)
      const loaded = await Promise.all(chosen.map(loadPhoto))
      loaded.forEach((photo) => urlsRef.current.add(photo.url))
      setPhotos((current) => {
        const next = [...current]
        if (replaceIndex !== null) {
          const previous = next[replaceIndex]
          if (previous) {
            URL.revokeObjectURL?.(previous.url)
            urlsRef.current.delete(previous.url)
          }
          next[replaceIndex] = loaded[0]
        } else {
          const emptySlots = next.map((photo, index) => photo ? -1 : index).filter((index) => index >= 0)
          loaded.forEach((photo, index) => { next[emptySlots[index]] = photo })
        }
        return next
      })
      if (files.length > available) setError(`Only ${available} more photo${available === 1 ? '' : 's'} could be added.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Those photos could not be opened.')
    } finally {
      replaceIndexRef.current = null
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function updatePhoto(index: number, update: Partial<FramedPhoto>) {
    setPhotos((current) => current.map((photo, photoIndex) => (
      photoIndex === index && photo ? { ...photo, ...update } : photo
    )))
  }

  async function createCoverBlob() {
    const completePhotos = photos as FramedPhoto[]
    const images = await Promise.all(completePhotos.map((photo) => loadDrawable(photo.url)))
    const canvas = document.createElement('canvas')
    canvas.width = COVER_WIDTH
    canvas.height = COVER_HEIGHT
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Cover export is not available in this browser.')
    context.fillStyle = '#111411'
    context.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT)
    completePhotos.forEach((photo, index) => drawCoverPanel(context, images[index], photo, index))
    return new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('The cover could not be created.')),
      'image/png',
    ))
  }

  async function downloadCover() {
    if (!isReady) return
    setIsDownloading(true)
    setError(null)
    try {
      const blob = await createCoverBlob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'clip-farm-instagram-cover.png'
      link.click()
      URL.revokeObjectURL?.(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The cover could not be downloaded.')
    } finally {
      setIsDownloading(false)
    }
  }

  async function useCover() {
    if (!isReady || !onUseCover) return
    setIsUsingCover(true)
    setError(null)
    try {
      const blob = await createCoverBlob()
      await onUseCover(new File([blob], 'four-photo-instagram-cover.png', { type: 'image/png' }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The cover could not be saved.')
    } finally {
      setIsUsingCover(false)
    }
  }

  return (
    <main className="cover-stack-page">
      <input
        ref={inputRef}
        className="cover-stack-page__file-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => acceptFiles(event.target.files)}
      />

      <section className="cover-stack-page__intro">
        <div>
          <p className="eyebrow">Mode 03 · Four-photo cover</p>
          <h1>Four moments.<br /><em>One clean cover.</em></h1>
        </div>
        <div className="cover-stack-page__promise">
          <span><Sparkles size={16} />No awkward crops</span>
          <p>Stack four photos into an exact Instagram cover, then frame every strip independently.</p>
        </div>
      </section>

      <section className="cover-stack-workspace" aria-labelledby="cover-workspace-title">
        <div className="cover-stack-workspace__copy">
          <div className="cover-stack-workspace__status">
            <span>{String(photoCount).padStart(2, '0')} / 04 photos</span>
            {isReady && <b><Check size={13} />Ready to frame</b>}
          </div>
          <h2 id="cover-workspace-title">Build your<br />cover stack</h2>
          <p>Choose four photos. We’ll crop each one into an equal 1080 × 480 strip—automatically.</p>

          <ol className="cover-stack-workspace__steps">
            <li className={photoCount > 0 ? 'is-done' : 'is-current'}><b>1</b><span><strong>Choose four photos</strong><small>JPG, PNG or WebP</small></span></li>
            <li className={isReady ? 'is-current' : ''}><b>2</b><span><strong>Fine-tune each strip</strong><small>Tap, zoom and reposition</small></span></li>
            <li><b>3</b><span><strong>Download the cover</strong><small>Exact 1080 × 1920 PNG</small></span></li>
          </ol>

          <button className="cover-stack-workspace__upload" type="button" onClick={() => openPicker()} disabled={isReady}>
            <Upload size={18} />
            {photoCount === 0 ? 'Select 4 photos' : `Add ${4 - photoCount} more`}
          </button>
          <small className="cover-stack-workspace__privacy">Photos stay in your browser until you download.</small>
          {error && <p className="cover-stack-workspace__error" role="alert">{error}</p>}
        </div>

        <div className="cover-stack-workspace__canvas-wrap">
          <div className="cover-stack-workspace__measure cover-stack-workspace__measure--top"><span>1080 px</span></div>
          <div className="cover-stack-workspace__measure cover-stack-workspace__measure--side"><span>1920 px</span></div>
          <div className="cover-stack-canvas" aria-label="Instagram cover preview">
            {photos.map((photo, index) => (
              <Panel
                key={photo?.id ?? index}
                photo={photo}
                index={index}
                onClick={() => photo ? setActiveIndex(index) : openPicker(index)}
              />
            ))}
          </div>
        </div>

        <aside className="cover-stack-workspace__finish">
          <div><Images size={23} /><span><strong>4 equal panels</strong><small>1080 × 480 each</small></span></div>
          <div><Move size={23} /><span><strong>Independent framing</strong><small>Every crop stays separate</small></span></div>
          <button type="button" onClick={downloadCover} disabled={!isReady || isDownloading}>
            <Download size={19} />{isDownloading ? 'Preparing…' : 'Download cover'}
          </button>
          {onUseCover && (
            <button
              className="cover-stack-workspace__use"
              type="button"
              onClick={useCover}
              disabled={!isReady || isUsingCover}
            >
              <Check size={19} />{isUsingCover ? 'Saving…' : 'Use as cover'}
            </button>
          )}
          <p><Sparkles size={13} />Ready for Instagram—or your favorite AI finisher.</p>
        </aside>
      </section>

      {activeIndex !== null && photos[activeIndex] && (
        <CoverEditor
          photos={photos}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
          onChange={updatePhoto}
          onReplace={openPicker}
          onClose={() => setActiveIndex(null)}
        />
      )}
    </main>
  )
}
