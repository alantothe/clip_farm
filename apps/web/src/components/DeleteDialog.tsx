import { LoaderCircle, Trash2 } from 'lucide-react'
import type { Project } from '../types'

export type DeleteIntent =
  | { kind: 'project'; project: Project }
  | { kind: 'all'; count: number }

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
  const all = intent.kind === 'all'
  const label = all ? `${intent.count} video${intent.count === 1 ? '' : 's'}` : `“${intent.project.title}”`

  return (
    <div className="delete-dialog-backdrop" role="presentation">
      <section className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
        <span className="delete-dialog__mark"><Trash2 size={22} /></span>
        <p className="eyebrow">Permanent action</p>
        <h2 id="delete-dialog-title">{all ? 'Clear every video?' : 'Delete this video?'}</h2>
        <p>
          {label} and {all ? 'their' : 'its'} source files, captions, and rendered clips will be permanently removed.
        </p>
        {error && <p className="form-error" role="alert">{error.message}</p>}
        <div className="delete-dialog__actions">
          <button className="secondary-button" onClick={onCancel} disabled={pending} autoFocus>Keep {all ? 'videos' : 'video'}</button>
          <button className="danger-button" onClick={onConfirm} disabled={pending}>
            {pending ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}
            {all ? 'Clear all' : 'Delete video'}
          </button>
        </div>
      </section>
    </div>
  )
}
