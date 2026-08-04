import { Crosshair, Maximize2, Move } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../../api'
import type { BatchMedia, BatchMediaPatch } from '../../types'
import { CentreLines, NOT_CENTRED, magnetOn, snappedCentre } from './snapping'
import type { Centred } from './snapping'

const WIDTH_LIMITS = { min: 10, max: 100 }

type Gesture =
  | { kind: 'move'; mediaId: string; grabX: number; grabY: number }
  | { kind: 'resize'; mediaId: string; startWidth: number; startDistance: number }

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/** Turn a pointer position into the image centre used by the API and renderer. */
export function mediaCentreAt(
  pointer: { x: number; y: number },
  grab: { x: number; y: number },
  stage: { left: number; top: number; width: number; height: number },
): Pick<BatchMedia, 'center_x' | 'center_y'> {
  return {
    center_x: clamp(((pointer.x - stage.left - grab.x) / stage.width) * 100, 0, 100),
    center_y: clamp(((pointer.y - stage.top - grab.y) / stage.height) * 100, 0, 100),
  }
}

/** Keep a corner under the pointer while preserving the image's aspect ratio. */
export function mediaWidthAt(startWidth: number, startDistance: number, distance: number) {
  if (startDistance <= 0) return startWidth
  return clamp((startWidth * distance) / startDistance, WIDTH_LIMITS.min, WIDTH_LIMITS.max)
}

/** Sequence images and their direct-manipulation furniture on the Player stage. */
export function MediaStage({
  media,
  playheadMs,
  selectedMediaId,
  onSelect,
  onEdit,
  editable,
}: {
  media: BatchMedia[]
  playheadMs: number
  selectedMediaId: string | null
  onSelect: (mediaId: string) => void
  onEdit: (media: BatchMedia, patch: BatchMediaPatch) => void
  editable: boolean
}) {
  const [draft, setDraft] = useState<({ mediaId: string } & BatchMediaPatch) | null>(null)
  const [centred, setCentred] = useState<Centred>(NOT_CENTRED)
  const stageRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)

  const visible = media.filter(
    (item) => playheadMs >= item.start_ms && playheadMs < item.end_ms,
  )
  const drafted = visible.map((item) =>
    draft?.mediaId === item.id ? { ...item, ...draft } : item,
  )

  function stageRect() {
    return stageRef.current?.getBoundingClientRect() ?? null
  }

  function begin(event: React.PointerEvent<HTMLElement>, next: Gesture) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    gesture.current = next
    onSelect(next.mediaId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const current = gesture.current
    const rect = stageRect()
    if (!current || !rect?.width || !rect.height) return
    const item = media.find((entry) => entry.id === current.mediaId)
    if (!item) return

    if (current.kind === 'move') {
      // The pointer places it; the magnet takes it to the frame's centre if it
      // came within reach, and says which axis so the line can be drawn.
      const { centred: axes, ...placed } = snappedCentre(
        mediaCentreAt(
          { x: event.clientX, y: event.clientY },
          { x: current.grabX, y: current.grabY },
          rect,
        ),
        rect,
        magnetOn(event),
      )
      setDraft({ mediaId: item.id, ...placed })
      setCentred(axes)
      return
    }

    const centre = {
      x: rect.left + (item.center_x / 100) * rect.width,
      y: rect.top + (item.center_y / 100) * rect.height,
    }
    setDraft({
      mediaId: item.id,
      width_percent: mediaWidthAt(
        current.startWidth,
        current.startDistance,
        Math.hypot(event.clientX - centre.x, event.clientY - centre.y),
      ),
    })
  }

  function finish() {
    const current = gesture.current
    gesture.current = null
    setCentred(NOT_CENTRED)
    if (!current || !draft || draft.mediaId !== current.mediaId) {
      setDraft(null)
      return
    }
    const item = media.find((entry) => entry.id === current.mediaId)
    const { mediaId: _ignored, ...patch } = draft
    if (item && Object.keys(patch).length) onEdit(item, patch)
    setDraft(null)
  }

  function cancel() {
    gesture.current = null
    setCentred(NOT_CENTRED)
    setDraft(null)
  }

  if (!drafted.length) return null

  return (
    <div className="player__media" ref={stageRef}>
      <CentreLines centred={centred} />
      {drafted.map((item) => {
        const selected = editable && item.id === selectedMediaId
        return (
          <div
            key={item.id}
            role={editable ? 'button' : undefined}
            tabIndex={editable ? 0 : undefined}
            aria-label={editable ? `Move ${item.name}` : undefined}
            className={`player__overlay player__overlay--sequence ${
              selected ? 'is-selected' : ''
            } ${editable ? 'is-editable' : ''}`}
            style={{
              left: `${item.center_x}%`,
              top: `${item.center_y}%`,
              width: `${item.width_percent}%`,
              transform: `translate(-50%, -50%) rotate(${item.rotation_deg}deg)`,
            }}
            onPointerDown={
              editable
                ? (event) => {
                    const rect = stageRect()
                    if (!rect) return
                    begin(event, {
                      kind: 'move',
                      mediaId: item.id,
                      // Preserve where inside the image it was grabbed so the
                      // image does not jump under the pointer on the first move.
                      grabX: event.clientX - rect.left - (item.center_x / 100) * rect.width,
                      grabY: event.clientY - rect.top - (item.center_y / 100) * rect.height,
                    })
                  }
                : undefined
            }
            onPointerMove={editable ? onPointerMove : undefined}
            onPointerUp={editable ? finish : undefined}
            onPointerCancel={editable ? cancel : undefined}
            onKeyDown={
              editable
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(item.id)
                    }
                  }
                : undefined
            }
          >
            <img
              src={api.mediaUrl(item.url)}
              alt=""
              draggable={false}
              style={{ opacity: item.opacity }}
            />

            {selected && (
              <>
                <span className="player__media-hint">
                  {centred.x || centred.y ? (
                    <>
                      <Crosshair size={10} /> Centred · Alt to slip past
                    </>
                  ) : (
                    <>
                      <Move size={10} /> Drag image
                    </>
                  )}
                </span>
                {(['nw', 'ne', 'se', 'sw'] as const).map((corner) => (
                  <span
                    key={corner}
                    className={`player__media-grip player__media-grip--${corner}`}
                    title="Drag to resize the image"
                    onPointerDown={(event) => {
                      const rect = stageRect()
                      if (!rect) return
                      const centre = {
                        x: rect.left + (item.center_x / 100) * rect.width,
                        y: rect.top + (item.center_y / 100) * rect.height,
                      }
                      begin(event, {
                        kind: 'resize',
                        mediaId: item.id,
                        startWidth: item.width_percent,
                        startDistance: Math.max(
                          1,
                          Math.hypot(event.clientX - centre.x, event.clientY - centre.y),
                        ),
                      })
                    }}
                    onPointerMove={onPointerMove}
                    onPointerUp={finish}
                    onPointerCancel={cancel}
                  >
                    {corner === 'se' && <Maximize2 size={10} />}
                  </span>
                ))}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
