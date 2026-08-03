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
 *
 * It is a strip at the head of the bin, a line high. Adding videos is the
 * first thing done in a Batch and rarely the next one, and the panel it used
 * to be held its height all session — height the Player is the better owner of.
 */
export function ClipDropZone({
  onAdd,
  uploading,
}: {
  onAdd: (files: File[]) => void
  uploading: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function add(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (files.length) onAdd(files)
  }

  return (
    <div
      className={`clip-drop ${dragging ? 'is-dragging' : ''}`}
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
        {uploading ? <LoaderCircle className="spin" size={16} /> : <UploadCloud size={16} />}
      </span>
      <div className="clip-drop__copy">
        <strong>{uploading ? 'Adding videos…' : 'Drop videos'}</strong>
      </div>
      <button
        className="text-button"
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        // The visible word is inside the spoken one, so the strip can be a
        // line high without the button going nameless.
        aria-label="Choose videos"
        title="Choose videos"
      >
        <FolderOpen size={14} />
        Choose
      </button>
    </div>
  )
}
