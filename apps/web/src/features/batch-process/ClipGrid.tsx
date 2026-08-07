import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check, Clapperboard, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import { Status } from '../../components/Status'
import { formatTime } from '../../lib/format'
import { artifact, projectIsBusy } from '../../lib/project'
import type { Project } from '../../types'

function ClipPreviewDialog({
  clip,
  onClose,
  onEdit,
}: {
  clip: Project
  onClose: () => void
  onEdit: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const preview = artifact(clip, 'preview')
  const poster = artifact(clip, 'thumbnail')

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousFocus = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
      previousFocus?.focus()
    }
  }, [onClose])

  return createPortal(
    <div
      className="clip-preview-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="clip-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clip-preview-title"
      >
        <header className="clip-preview-dialog__head">
          <div>
            <span>Clip preview</span>
            <h2 id="clip-preview-title">{clip.title}</h2>
          </div>
          <button
            ref={closeRef}
            className="clip-preview-dialog__close"
            type="button"
            onClick={onClose}
            aria-label="Close video preview"
            title="Close video preview (Esc)"
          >
            <X size={22} />
            <span>Close</span>
          </button>
        </header>
        <div className="clip-preview-dialog__stage">
          {preview ? (
            <video
              key={clip.id}
              src={preview}
              poster={poster || undefined}
              controls
              preload="metadata"
              aria-label={`${clip.title} preview`}
            />
          ) : poster ? (
            <img src={poster} alt="" />
          ) : (
            <span className="clip-preview-dialog__empty" aria-hidden="true">
              {projectIsBusy(clip)
                ? 'Preview preparing…'
                : clip.status === 'failed'
                  ? 'Preview unavailable'
                  : 'No preview available'}
            </span>
          )}
        </div>
        <footer className="clip-preview-dialog__meta">
          <Status value={clip.status} />
          {clip.duration_ms != null && <span>{formatTime(clip.duration_ms)}</span>}
          <small>Press Escape or click outside to close</small>
          <button
            className="clip-preview-dialog__edit"
            type="button"
            onClick={onEdit}
            disabled={projectIsBusy(clip) || clip.status === 'failed'}
          >
            <Pencil size={14} />
            Edit video
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}

/**
 * Every Clip in a Batch, with the progress of its own Import.
 *
 * Each Clip imports behind its own Job, so the list shows several bars moving
 * at once rather than one bar for the Batch. Clicking a Clip selects it without
 * leaving the Sequence. A newly selected Clip opens in the large preview
 * dialog, while every selection remains available for one add or delete action.
 *
 * It is a bin down the side, one row per Clip, and it scrolls: a Batch of
 * twenty is the case this Mode exists for, and twenty cards laid out as a grid
 * pushed the Player and the Timeline off the screen between them.
 *
 * Adding to the timeline is a separate action rather than part of selection:
 * being in a Batch and being in its Sequence are different decisions. The
 * per-row button places one Clip; the selection bar places several in list
 * order.
 *
 * That button is also the drag handle. Dragging from it drops the Clip at a
 * position on the Timeline; clicking appends. Putting both on one control
 * keeps the gesture discoverable and leaves the row's own click free to mean
 * "select this Clip", with no threshold to guess at.
 */
export function ClipGrid({
  clips,
  selectedIds,
  previewClipId,
  onToggle,
  onClosePreview,
  onEdit,
  onAdd,
  onAddSelected,
  onDragToTimeline,
  onDelete,
  onDeleteSelected,
  placedCounts,
  adding,
  deleting,
}: {
  clips: Project[]
  selectedIds: string[]
  previewClipId: string | null
  onToggle: (clip: Project) => void
  onClosePreview: () => void
  onEdit: (clip: Project) => void
  onAdd: (clip: Project) => void
  onAddSelected: (clips: Project[]) => void
  onDragToTimeline: (clip: Project) => void
  onDelete: (clip: Project) => void
  onDeleteSelected: (clips: Project[]) => void
  /** How many Shots each Clip has. A Clip can be placed more than once. */
  placedCounts: Map<string, number>
  adding: boolean
  deleting: boolean
}) {
  // Set once the pointer has travelled far enough for this to be a drag, so
  // releasing over the list does not also append the Clip.
  const dragging = useRef(false)
  const selected = clips.filter((clip) => selectedIds.includes(clip.id))
  const previewClip = clips.find((clip) => clip.id === previewClipId) ?? null
  const selectedCanBeAdded =
    selected.length > 0 && selected.every((clip) => !projectIsBusy(clip) && clip.status !== 'failed')

  return (
    <div className="clip-collection">
      {previewClip && (
        <ClipPreviewDialog
          clip={previewClip}
          onClose={onClosePreview}
          onEdit={() => onEdit(previewClip)}
        />
      )}

      {selected.length > 0 && (
        <div className="clip-selection" role="group" aria-label="Selected video actions">
          <span>{selected.length} selected</span>
          <button
            className="clip-selection__add"
            type="button"
            disabled={!selectedCanBeAdded || adding}
            onClick={() => onAddSelected(selected)}
            title={
              selectedCanBeAdded
                ? 'Add selected videos to the end of the timeline'
                : 'Wait for every selected video to finish importing'
            }
          >
            <Plus size={13} />
            Add {selected.length}
          </button>
          <button
            className="clip-selection__delete"
            type="button"
            disabled={deleting || selected.some(projectIsBusy)}
            onClick={() => onDeleteSelected(selected)}
            aria-label={`Delete ${selected.length} selected videos`}
            title={
              selected.some(projectIsBusy)
                ? 'Wait for selected videos to finish importing before deleting'
                : 'Delete selected videos'
            }
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}

      <ul className="clip-list" aria-label="Clips in this batch">
        {clips.map((clip) => {
          const thumbnail = artifact(clip, 'thumbnail')
          const busy = projectIsBusy(clip)
          const failed = clip.status === 'failed'
          const job = clip.latest_job
          const placed = placedCounts.get(clip.id) ?? 0
          const isSelected = selectedIds.includes(clip.id)
          return (
            <li className={`clip-row ${isSelected ? 'is-selected' : ''}`} key={clip.id}>
              <button
                className={`clip-row__select ${failed ? 'clip-row__select--failed' : ''}`}
                type="button"
                onClick={() => onToggle(clip)}
                aria-pressed={isSelected}
                aria-label={`${isSelected ? 'Deselect' : 'Select'} ${clip.title}`}
                title={`${isSelected ? 'Deselect' : 'Select'} ${clip.title}`}
              >
                <span className="clip-row__thumb">
                  {thumbnail
                    ? <img src={thumbnail} alt="" />
                    : failed
                      ? <TriangleAlert size={16} />
                      : <Clapperboard size={16} />}
                  {isSelected && (
                    <span className="clip-row__check" aria-hidden="true"><Check size={11} /></span>
                  )}
                </span>
                <span className="clip-row__body">
                  <strong>{clip.title}</strong>
                  <span className="clip-row__meta">
                    <Status value={clip.status} />
                    {clip.duration_ms != null && <small>{formatTime(clip.duration_ms)}</small>}
                    {placed > 0 && (
                      <small className="clip-row__placed">
                        {placed === 1 ? 'On the timeline' : `On the timeline ${placed}×`}
                      </small>
                    )}
                  </span>
                  {busy && job && (
                    <span className="clip-row__progress">
                      <span
                        className="clip-row__progress-bar"
                        style={{ width: `${job.progress}%` }}
                        role="progressbar"
                        aria-valuenow={job.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${clip.title} import progress`}
                      />
                      <small>{job.message}</small>
                    </span>
                  )}
                  {failed && (
                    <small className="clip-row__error">{job?.message || 'Import failed'}</small>
                  )}
                </span>
              </button>
              <button
                className="clip-row__add"
                type="button"
                disabled={busy || failed || adding}
                onPointerDown={(event) => {
                  if (busy || failed || adding) return
                  dragging.current = false
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event) => {
                  if (dragging.current || !event.currentTarget.hasPointerCapture(event.pointerId)) {
                    return
                  }
                  if (Math.abs(event.movementX) + Math.abs(event.movementY) > 0) {
                    dragging.current = true
                    onDragToTimeline(clip)
                  }
                }}
                // Still a click handler, so Enter and Space keep working — a
                // drag ends over the timeline, which does its own placing, and
                // only swallows the click that follows it.
                onClick={() => {
                  if (dragging.current) {
                    dragging.current = false
                    return
                  }
                  onAdd(clip)
                }}
                aria-label={`Add ${clip.title} to the timeline`}
                title={
                  busy
                    ? 'Wait for this clip to finish importing'
                    : failed
                      ? 'This clip failed to import'
                      : 'Click to append, or drag onto the timeline'
                }
              >
                <Plus size={15} />
              </button>
              <button
                className="clip-row__delete"
                type="button"
                disabled={busy || deleting}
                onClick={() => onDelete(clip)}
                aria-label={`Delete ${clip.title}`}
                title={busy ? 'Wait for this video to finish importing' : `Delete ${clip.title}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
