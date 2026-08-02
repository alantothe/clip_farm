import { useRef, useState } from 'react'
import { FolderOpen, LoaderCircle, UploadCloud } from 'lucide-react'

/** Kept in step with ALLOWED_SUFFIXES in the API's upload service. */
const ACCEPTED = '.mp4,.mov,.m4v,.webm,.mkv,.avi'

/**
 * Where videos enter a Batch, by drag-and-drop or by the file picker.
 *
 * Both routes end in the same call, and both accept several files at once,
 * because picking twelve files one at a time is the thing this Mode exists to
 * avoid.
 */
export function ClipDropZone({
  onAdd,
  uploading,
  compact = false,
}: {
  onAdd: (files: File[]) => void
  uploading: boolean
  compact?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function add(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (files.length) onAdd(files)
  }

  return (
    <div
      className={`clip-drop ${compact ? 'clip-drop--compact' : ''} ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        if (!uploading) add(event.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        hidden
        onChange={(event) => {
          add(event.target.files)
          // Cleared so choosing the same file twice still fires a change.
          event.target.value = ''
        }}
      />
      <span className="clip-drop__mark" aria-hidden="true">
        {uploading ? <LoaderCircle className="spin" size={compact ? 20 : 30} /> : <UploadCloud size={compact ? 20 : 30} />}
      </span>
      <div className="clip-drop__copy">
        <strong>{uploading ? 'Adding videos…' : 'Drop videos here'}</strong>
        {!compact && <small>MP4, MOV, M4V, WebM, MKV, or AVI · up to 25 at a time</small>}
      </div>
      <button
        className="primary-button"
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        <FolderOpen size={18} />
        Choose videos
      </button>
    </div>
  )
}
