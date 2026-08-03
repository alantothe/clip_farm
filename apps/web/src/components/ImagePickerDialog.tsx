import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FileImage,
  HardDrive,
  ImagePlus,
  LoaderCircle,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { formatBytes } from '../lib/format'
import type { StoredImage } from '../types'

const STORAGE_IMAGES_KEY = ['storage', 'images'] as const
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024

export function ImagePickerDialog({
  eyebrow,
  title,
  description,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onCancel,
  onChoose,
}: {
  eyebrow: string
  title: string
  description: string
  confirmLabel: string
  pendingLabel: string
  pending: boolean
  error: Error | null
  onCancel: () => void
  onChoose: (image: StoredImage) => void
}) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'upload' | 'storage'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteIntentId, setDeleteIntentId] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const storageQuery = useQuery({ queryKey: STORAGE_IMAGES_KEY, queryFn: api.listStoredImages })
  const images = storageQuery.data ?? []

  const uploadMutation = useMutation({
    mutationFn: api.uploadStoredImage,
    onSuccess: (image) => {
      queryClient.setQueryData<StoredImage[]>(STORAGE_IMAGES_KEY, (current = []) => [
        image,
        ...current.filter((item) => item.id !== image.id),
      ])
      onChoose(image)
    },
  })
  const deleteMutation = useMutation({
    mutationFn: api.deleteStoredImage,
    onSuccess: (_result, imageId) => {
      queryClient.setQueryData<StoredImage[]>(STORAGE_IMAGES_KEY, (current = []) =>
        current.filter((item) => item.id !== imageId),
      )
      setSelectedId((current) => (current === imageId ? null : current))
      setDeleteIntentId(null)
    },
  })

  const busy = pending || uploadMutation.isPending || deleteMutation.isPending
  const selected = images.find((image) => image.id === selectedId) ?? null
  const deleteIntent = images.find((image) => image.id === deleteIntentId) ?? null

  function chooseFile(next: File | null) {
    setLocalError(null)
    uploadMutation.reset()
    if (!next) return
    if (!ACCEPTED.includes(next.type)) {
      setLocalError('Use a JPG, PNG, or WebP image.')
      return
    }
    if (next.size > MAX_BYTES) {
      setLocalError('Images must be 10 MB or smaller.')
      return
    }
    setFile(next)
  }

  useEffect(() => {
    if (tab === 'storage' && !selectedId && images[0]) setSelectedId(images[0].id)
  }, [images, selectedId, tab])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  const shownError =
    localError ??
    uploadMutation.error?.message ??
    deleteMutation.error?.message ??
    storageQuery.error?.message ??
    error?.message

  function confirm() {
    if (tab === 'upload' && file) uploadMutation.mutate(file)
    if (tab === 'storage' && selected) onChoose(selected)
  }

  return (
    <div className="delete-dialog-backdrop" role="presentation">
      <section
        className="add-media-dialog image-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-picker-title"
      >
        <button
          className="add-media-dialog__close"
          type="button"
          onClick={onCancel}
          disabled={busy}
          aria-label="Close image picker"
        >
          <X size={16} />
        </button>

        <p className="eyebrow">{eyebrow}</p>
        <h2 id="image-picker-title">{title}</h2>
        <p className="add-media-dialog__lede">{description}</p>

        <div className="image-picker__tabs" role="tablist" aria-label="Image source">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'upload'}
            className={tab === 'upload' ? 'is-active' : ''}
            onClick={() => setTab('upload')}
            disabled={busy}
          >
            <UploadCloud size={15} /> Upload
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'storage'}
            className={tab === 'storage' ? 'is-active' : ''}
            onClick={() => setTab('storage')}
            disabled={busy}
          >
            <HardDrive size={15} /> Storage
            {images.length > 0 && <span>{images.length}</span>}
          </button>
        </div>

        {tab === 'upload' ? (
          <div role="tabpanel" aria-label="Upload image">
            <button
              className={`add-media-drop ${file ? 'has-file' : ''}`}
              type="button"
              autoFocus
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                chooseFile(event.dataTransfer.files[0] ?? null)
              }}
              disabled={busy}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
                tabIndex={-1}
                aria-hidden="true"
              />
              <span className="add-media-drop__mark" aria-hidden="true">
                {file ? <FileImage size={28} /> : <UploadCloud size={28} />}
              </span>
              <span className="add-media-drop__copy">
                <strong>{file ? file.name : 'Drop an image here'}</strong>
                <small>
                  {file
                    ? `${formatBytes(file.size)} · click to replace`
                    : 'or click to browse · JPG, PNG, WebP · up to 10 MB'}
                </small>
              </span>
            </button>
            <p className="image-picker__storage-note">
              <HardDrive size={13} /> New uploads are saved to Storage for every editor.
            </p>
          </div>
        ) : (
          <div className="image-picker__storage" role="tabpanel" aria-label="Stored images">
            {storageQuery.isLoading ? (
              <div className="image-picker__state"><LoaderCircle className="spin" size={22} /> Loading Storage…</div>
            ) : images.length === 0 ? (
              <div className="image-picker__state">
                <HardDrive size={28} />
                <strong>Storage is empty</strong>
                <span>Upload an image once, then reuse it anywhere.</span>
                <button type="button" onClick={() => setTab('upload')}>Upload the first image</button>
              </div>
            ) : (
              <div className="image-picker__grid" role="list" aria-label="Images in Storage">
                {images.map((image) => (
                  <div
                    className={`image-picker__card ${selectedId === image.id ? 'is-selected' : ''}`}
                    role="listitem"
                    key={image.id}
                  >
                    <button
                      className="image-picker__select"
                      type="button"
                      onClick={() => setSelectedId(image.id)}
                      aria-label={`Use ${image.name}`}
                    >
                      <span className="image-picker__thumb">
                        <img src={api.mediaUrl(image.url)} alt="" loading="lazy" />
                      </span>
                      <span className="image-picker__name">{image.name}</span>
                      <small>{formatBytes(image.size_bytes)}</small>
                    </button>
                    <button
                      className="image-picker__delete"
                      type="button"
                      onClick={() => setDeleteIntentId(image.id)}
                      disabled={busy}
                      aria-label={`Delete ${image.name} from Storage`}
                      title="Delete from Storage"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {deleteIntent && (
              <div className="image-picker__delete-confirm" role="alert">
                <span>
                  Delete <strong>{deleteIntent.name}</strong>? Existing edits keep their copies.
                </span>
                <button type="button" onClick={() => setDeleteIntentId(null)} disabled={busy}>
                  Cancel
                </button>
                <button
                  className="is-danger"
                  type="button"
                  onClick={() => deleteMutation.mutate(deleteIntent.id)}
                  disabled={busy}
                >
                  {deleteMutation.isPending ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />}
                  Delete
                </button>
              </div>
            )}
          </div>
        )}

        {shownError && <p className="form-error" role="alert">{shownError}</p>}

        <div className="delete-dialog__actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={confirm}
            disabled={busy || (tab === 'upload' ? !file : !selected)}
          >
            {pending || uploadMutation.isPending ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <ImagePlus size={17} />
            )}
            {pending || uploadMutation.isPending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
