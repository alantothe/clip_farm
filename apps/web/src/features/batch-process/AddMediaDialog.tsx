import { ImagePickerDialog } from '../../components/ImagePickerDialog'
import type { StoredImage } from '../../types'

export function AddMediaDialog({
  pending,
  error,
  onCancel,
  onChoose,
}: {
  pending: boolean
  error: Error | null
  onCancel: () => void
  onChoose: (image: StoredImage) => void
}) {
  return (
    <ImagePickerDialog
      eyebrow="Sequence media"
      title="Add an image"
      description="Upload a new image or reuse one from Storage. It will fill the Sequence from beginning to end."
      confirmLabel="Add to timeline"
      pendingLabel="Adding image…"
      pending={pending}
      error={error}
      onCancel={onCancel}
      onChoose={onChoose}
    />
  )
}
