import { LoaderCircle, Trash2 } from 'lucide-react'
import type { BatchSummary, Project } from '../types'

export type DeleteIntent =
  | { kind: 'project'; project: Project }
  | { kind: 'projects'; projects: Project[] }
  | { kind: 'all'; count: number }
  | { kind: 'batch'; batch: BatchSummary }

type Copy = {
  title: string
  subject: string
  possessive: string
  keep: string
  confirm: string
}

function copyFor(intent: DeleteIntent): Copy {
  if (intent.kind === 'projects') {
    return {
      title: `Delete ${intent.projects.length} videos?`,
      subject: `${intent.projects.length} selected videos`,
      possessive: 'their',
      keep: 'Keep videos',
      confirm: 'Delete selected',
    }
  }
  if (intent.kind === 'all') {
    return {
      title: 'Clear every video?',
      subject: `${intent.count} video${intent.count === 1 ? '' : 's'}`,
      possessive: 'their',
      keep: 'Keep videos',
      confirm: 'Clear all',
    }
  }
  if (intent.kind === 'batch') {
    const count = intent.batch.clip_count
    return {
      title: 'Delete this batch?',
      subject: `“${intent.batch.name}” and its ${count} clip${count === 1 ? '' : 's'}`,
      possessive: 'their',
      keep: 'Keep batch',
      confirm: 'Delete batch',
    }
  }
  return {
    title: 'Delete this video?',
    subject: `“${intent.project.title}”`,
    possessive: 'its',
    keep: 'Keep video',
    confirm: 'Delete video',
  }
}

export function DeleteDialog({
  intent,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  intent: DeleteIntent
  pending: boolean
  error: Error | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const copy = copyFor(intent)

  return (
    <div className="delete-dialog-backdrop" role="presentation">
      <section className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
        <span className="delete-dialog__mark"><Trash2 size={22} /></span>
        <p className="eyebrow">Permanent action</p>
        <h2 id="delete-dialog-title">{copy.title}</h2>
        <p>
          {copy.subject} and {copy.possessive} source files, captions, and rendered clips will be permanently removed.
        </p>
        {error && <p className="form-error" role="alert">{error.message}</p>}
        <div className="delete-dialog__actions">
          <button className="secondary-button" onClick={onCancel} disabled={pending} autoFocus>{copy.keep}</button>
          <button className="danger-button" onClick={onConfirm} disabled={pending}>
            {pending ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}
            {copy.confirm}
          </button>
        </div>
      </section>
    </div>
  )
}
