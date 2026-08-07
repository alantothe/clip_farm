import { Crop, FileImage, LoaderCircle, UploadCloud, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { formatBytes } from '../../lib/format'
import type { StoredImage } from '../../types'

const OUTPUT_WIDTH = 1080
const OUTPUT_HEIGHT = 1920
const MAX_BYTES = 10 * 1024 * 1024
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

type Point = { x: number; y: number }
type Size = { width: number; height: number }

export function clampCoverOffset(
  offset: Point,
  source: Size,
  viewport: Size,
  zoom: number,
): Point {
  const scale = Math.max(viewport.width / source.width, viewport.height / source.height) * zoom
  const maxX = Math.max(0, (source.width * scale - viewport.width) / 2)
  const maxY = Math.max(0, (source.height * scale - viewport.height) / 2)
  return {
    x: maxX === 0 ? 0 : Math.max(-maxX, Math.min(maxX, offset.x)),
    y: maxY === 0 ? 0 : Math.max(-maxY, Math.min(maxY, offset.y)),
  }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The cropped image could not be created.'))),
      'image/jpeg',
      0.92,
    )
  })
}

export function CoverImageCropper({
  onCancel,
  onChoose,
}: {
  onCancel: () => void
  onChoose: (image: StoredImage) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{ pointer: number; start: Point; offset: Point } | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [source, setSource] = useState<Size | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl)
  }, [sourceUrl])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel, saving])

  function chooseFile(next: File | null) {
    setError(null)
    if (!next) return
    if (!ACCEPTED.includes(next.type)) {
      setError('Use a JPG, PNG, or WebP image.')
      return
    }
    if (next.size > MAX_BYTES) {
      setError('Images must be 10 MB or smaller.')
      return
    }
    setFile(next)
    setSource(null)
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    setSourceUrl(URL.createObjectURL(next))
  }

  function viewportSize(): Size {
    const box = viewportRef.current?.getBoundingClientRect()
    return { width: box?.width || 270, height: box?.height || 480 }
  }

  function setNextZoom(next: number) {
    if (!source) return
    setZoom(next)
    setOffset((current) => clampCoverOffset(current, source, viewportSize(), next))
  }

  async function save() {
    const image = imageRef.current
    if (!image || !source || !file) return
    setSaving(true)
    setError(null)
    try {
      const viewport = viewportSize()
      const scale = Math.max(viewport.width / source.width, viewport.height / source.height) * zoom
      const outputScale = OUTPUT_WIDTH / viewport.width
      const canvas = document.createElement('canvas')
      canvas.width = OUTPUT_WIDTH
      canvas.height = OUTPUT_HEIGHT
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Image cropping is not available in this browser.')
      const drawnWidth = source.width * scale * outputScale
      const drawnHeight = source.height * scale * outputScale
      context.fillStyle = '#000'
      context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
      context.drawImage(
        image,
        (OUTPUT_WIDTH - drawnWidth) / 2 + offset.x * outputScale,
        (OUTPUT_HEIGHT - drawnHeight) / 2 + offset.y * outputScale,
        drawnWidth,
        drawnHeight,
      )
      const blob = await canvasBlob(canvas)
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 90) || 'cover'
      const cropped = new File([blob], `${baseName}-instagram-cover.jpg`, { type: 'image/jpeg' })
      onChoose(await api.uploadStoredImage(cropped))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The cover image could not be saved.')
      setSaving(false)
    }
  }

  const viewport = viewportSize()
  const scale = source
    ? Math.max(viewport.width / source.width, viewport.height / source.height) * zoom
    : 1

  return (
    <div className="delete-dialog-backdrop cover-crop-backdrop" role="presentation">
      <section className="cover-cropper" role="dialog" aria-modal="true" aria-labelledby="cover-crop-title">
        <button className="cover-cropper__close" type="button" onClick={onCancel} disabled={saving} aria-label="Close cover image editor">
          <X size={17} />
        </button>
        <p className="eyebrow">Instagram cover</p>
        <h2 id="cover-crop-title">{file ? 'Crop the image' : 'Add an image'}</h2>
        <p className="cover-cropper__lede">
          {file
            ? 'Drag to position it inside the finished 9:16 cover. Use the slider to zoom.'
            : 'Choose a JPG, PNG, or WebP image. You’ll crop it to the exact 1080 × 1920 size next.'}
        </p>

        {!file ? (
          <button className="cover-cropper__drop" type="button" autoFocus onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault()
            chooseFile(event.dataTransfer.files[0] ?? null)
          }}>
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} tabIndex={-1} aria-hidden="true" />
            <span><UploadCloud size={28} /></span>
            <strong>Drop an image here</strong>
            <small>or click to browse · up to 10 MB</small>
          </button>
        ) : (
          <div className="cover-cropper__workspace">
            <div
              ref={viewportRef}
              className="cover-cropper__viewport"
              onPointerDown={(event) => {
                if (!source) return
                event.currentTarget.setPointerCapture(event.pointerId)
                dragRef.current = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, offset }
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current
                if (!drag || drag.pointer !== event.pointerId || !source) return
                setOffset(clampCoverOffset({
                  x: drag.offset.x + event.clientX - drag.start.x,
                  y: drag.offset.y + event.clientY - drag.start.y,
                }, source, viewportSize(), zoom))
              }}
              onPointerUp={(event) => {
                if (dragRef.current?.pointer === event.pointerId) dragRef.current = null
              }}
              onPointerCancel={() => { dragRef.current = null }}
            >
              <img
                ref={imageRef}
                src={sourceUrl}
                alt="Cover crop"
                draggable={false}
                onLoad={(event) => setSource({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                onError={() => setError('This image could not be opened. Try another file.')}
                style={source ? {
                  width: source.width * scale,
                  height: source.height * scale,
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                } : undefined}
              />
              <div className="cover-cropper__grid" aria-hidden="true" />
              <span className="cover-cropper__size">1080 × 1920</span>
            </div>
            <div className="cover-cropper__controls">
              <div className="cover-cropper__file">
                <FileImage size={15} />
                <span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
              </div>
              <label>
                <span>Zoom</span>
                <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setNextZoom(Number(event.target.value))} aria-label="Cover image zoom" />
                <output>{zoom.toFixed(2)}×</output>
              </label>
              <button type="button" onClick={() => { setFile(null); setSource(null); setError(null) }} disabled={saving}>
                Choose another image
              </button>
            </div>
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="cover-cropper__actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          {file && (
            <button className="primary-button" type="button" onClick={save} disabled={saving || !source}>
              {saving ? <LoaderCircle className="spin" size={17} /> : <Crop size={17} />}
              {saving ? 'Saving cover…' : 'Use cropped image'}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
