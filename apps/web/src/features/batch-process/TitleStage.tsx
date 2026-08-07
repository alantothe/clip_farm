import { useRef, useState } from 'react'
import { resolveFace, titleCss, titleIsVisible } from '../../lib/titles'
import type { FontCatalog, Title, TitlePatch } from '../../types'
import { CentreLines, NOT_CENTRED, magnetOn, snappedCentre } from './snapping'
import type { Centred } from './snapping'

/** The same bounds the API enforces, so a drag cannot ask for a rejected edit. */
const SIZE_LIMITS = { min: 1, max: 40 }
const WIDTH_LIMITS = { min: 5, max: 100 }

type Gesture =
  | { kind: 'move'; titleId: string; grabX: number; grabY: number }
  | { kind: 'size'; titleId: string; startSize: number; startDistance: number }
  | { kind: 'width'; titleId: string; startWidth: number; originX: number }

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/**
 * Where a drag puts a Title's centre, as a percent of the frame.
 *
 * Exported because it is the whole of the arithmetic, and testable here without
 * the layout jsdom does not have. The magnet in `snapping` is applied to what
 * this returns, so the placement and the pull to the centre stay separable.
 */
export function centreAt(
  pointer: { x: number; y: number },
  grab: { x: number; y: number },
  stage: { left: number; top: number; width: number; height: number },
): { center_x: number; center_y: number } {
  return {
    center_x: clamp(((pointer.x - stage.left - grab.x) / stage.width) * 100, 0, 100),
    center_y: clamp(((pointer.y - stage.top - grab.y) / stage.height) * 100, 0, 100),
  }
}

/**
 * The Titles on the Player's stage, and the handles that place them.
 *
 * Drawn from the same numbers the renderer burns in, in container query units
 * so nothing here has to measure the stage to size a font: `6cqh` is 6% of the
 * stage's height at any stage size, which is the same 6% of 1920 the export
 * uses (ADR 0008).
 *
 * Measuring is needed for the *gestures* only — turning a pointer at a screen
 * position into a percent of the frame — and it happens per gesture rather than
 * per frame.
 */
export function TitleStage({
  titles,
  catalog,
  playheadMs,
  selectedTitleId,
  onSelect,
  onEdit,
  editable,
}: {
  titles: Title[]
  catalog: FontCatalog | null
  playheadMs: number
  selectedTitleId: string | null
  onSelect: (titleId: string, additive?: boolean) => void
  onEdit: (title: Title, patch: TitlePatch) => void
  /** False in the Source view, which shows the whole frame and burns nothing. */
  editable: boolean
}) {
  const [draft, setDraft] = useState<({ titleId: string } & TitlePatch) | null>(null)
  const [centred, setCentred] = useState<Centred>(NOT_CENTRED)
  const stageRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)

  const visible = titles.filter((title) => titleIsVisible(title, playheadMs))
  const drafted = visible.map((title) =>
    draft?.titleId === title.id ? { ...title, ...draft } : title,
  )

  function stageRect() {
    return stageRef.current?.getBoundingClientRect() ?? null
  }

  function begin(event: React.PointerEvent<HTMLElement>, next: Gesture) {
    event.preventDefault()
    event.stopPropagation()
    // Optional like its sibling on the image stage: jsdom has no pointer
    // capture, and a drag it cannot claim is still a drag worth following.
    event.currentTarget.setPointerCapture?.(event.pointerId)
    gesture.current = next
    onSelect(next.titleId, event.shiftKey)
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const current = gesture.current
    const rect = stageRect()
    if (!current || !rect) return
    const title = titles.find((item) => item.id === current.titleId)
    if (!title) return

    if (current.kind === 'move') {
      // Placed by the pointer, then pulled to the frame's centre if it came
      // close enough — with the lines that say which axis it landed on.
      const { centred: axes, ...placed } = snappedCentre(
        centreAt(
          { x: event.clientX, y: event.clientY },
          { x: current.grabX, y: current.grabY },
          rect,
        ),
        rect,
        magnetOn(event),
      )
      setDraft({ titleId: title.id, ...placed })
      setCentred(axes)
      return
    }

    if (current.kind === 'width') {
      // The box is centred, so its right edge moves at half the rate its width
      // grows — dragging the edge one stage-width doubles the box, not adds one.
      const delta = ((event.clientX - current.originX) / rect.width) * 200
      setDraft({
        titleId: title.id,
        width_percent: clamp(
          current.startWidth + delta,
          WIDTH_LIMITS.min,
          WIDTH_LIMITS.max,
        ),
      })
      return
    }

    // Size scales with the pointer's distance from the Title's centre, so the
    // corner keeps following the finger rather than drifting off it.
    const centre = {
      x: rect.left + (title.center_x / 100) * rect.width,
      y: rect.top + (title.center_y / 100) * rect.height,
    }
    const distance = Math.hypot(event.clientX - centre.x, event.clientY - centre.y)
    setDraft({
      titleId: title.id,
      font_size_percent: clamp(
        (current.startSize * distance) / current.startDistance,
        SIZE_LIMITS.min,
        SIZE_LIMITS.max,
      ),
    })
  }

  function onPointerUp() {
    const current = gesture.current
    gesture.current = null
    setCentred(NOT_CENTRED)
    if (!current || !draft) {
      setDraft(null)
      return
    }
    const title = titles.find((item) => item.id === current.titleId)
    const { titleId: _ignored, ...patch } = draft
    // The gesture already ended, so this commits once rather than per frame.
    if (title && Object.keys(patch).length) onEdit(title, patch)
    setDraft(null)
  }

  if (!drafted.length) return null

  return (
    <div className="player__titles" ref={stageRef} aria-hidden="true">
      <CentreLines centred={centred} />
      {drafted.map((title) => {
        const { box, text } = titleCss(title, resolveFace(catalog, title.font_family, title.font_weight))
        const selected = editable && title.id === selectedTitleId
        return (
          <div
            key={title.id}
            className={`player__title ${selected ? 'is-selected' : ''} ${
              editable ? 'is-editable' : ''
            }`}
            style={box}
            onPointerDown={
              editable
                ? (event) => {
                    const rect = stageRect()
                    if (!rect) return
                    begin(event, {
                      kind: 'move',
                      titleId: title.id,
                      // Where inside the Title the pointer landed, so it does
                      // not jump its centre under the cursor on the first pixel.
                      grabX: event.clientX - rect.left - (title.center_x / 100) * rect.width,
                      grabY: event.clientY - rect.top - (title.center_y / 100) * rect.height,
                    })
                  }
                : undefined
            }
            onPointerMove={editable ? onPointerMove : undefined}
            onPointerUp={editable ? onPointerUp : undefined}
          >
            <span className="player__title-text" style={text}>
              {title.text}
            </span>

            {selected && (
              <>
                {/* The wrap box, which is otherwise invisible until the text is
                    long enough to reach it. */}
                <span className="player__title-frame" />
                <span
                  className="player__title-grip player__title-grip--width"
                  title="Drag to change how wide the text runs before it wraps"
                  onPointerDown={(event) =>
                    begin(event, {
                      kind: 'width',
                      titleId: title.id,
                      startWidth: title.width_percent,
                      originX: event.clientX,
                    })
                  }
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                />
                <span
                  className="player__title-grip player__title-grip--size"
                  title="Drag to resize the text"
                  onPointerDown={(event) => {
                    const rect = stageRect()
                    if (!rect) return
                    const centre = {
                      x: rect.left + (title.center_x / 100) * rect.width,
                      y: rect.top + (title.center_y / 100) * rect.height,
                    }
                    begin(event, {
                      kind: 'size',
                      titleId: title.id,
                      startSize: title.font_size_percent,
                      // Guarded against zero: grabbing exactly the centre would
                      // otherwise divide by it on the next move.
                      startDistance: Math.max(
                        1,
                        Math.hypot(event.clientX - centre.x, event.clientY - centre.y),
                      ),
                    })
                  }}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
