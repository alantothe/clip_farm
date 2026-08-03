import { useState } from 'react'
import { Check, LoaderCircle, Plus } from 'lucide-react'
import { DEFAULT_FORMAT, FORMATS } from '../../formats/registry'
import type { Format } from '../../types'

/**
 * The one moment a Batch's Format is chosen.
 *
 * There is exactly one Format today, so this dialog could have been skipped and
 * the value defaulted. It is not, because the choice is real and permanent: a
 * Sequence joins its Shots into one file, so the shape holds for every Clip in
 * the Batch and cannot be changed once work has started. Asking once, plainly,
 * is cheaper than a Batch discovered to be the wrong shape after an import
 * (ADR 0006).
 */
export function NewBatchDialog({
  pending,
  error,
  onCancel,
  onCreate,
}: {
  pending: boolean
  error: Error | null
  onCancel: () => void
  onCreate: (batch: { name: string; format: Format }) => void
}) {
  const [name, setName] = useState('')
  const [format, setFormat] = useState<Format>(DEFAULT_FORMAT)

  return (
    <div className="delete-dialog-backdrop" role="presentation">
      <section
        className="new-batch-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-batch-title"
      >
        <p className="eyebrow">New batch</p>
        <h2 id="new-batch-title">What are you making?</h2>

        <label className="new-batch-dialog__name">
          Name
          <input
            value={name}
            autoFocus
            maxLength={120}
            placeholder="Untitled batch"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !pending) onCreate({ name, format })
            }}
          />
        </label>

        <fieldset className="new-batch-dialog__formats">
          <legend>Format</legend>
          {FORMATS.map((option) => {
            const selected = option.id === format
            return (
              <button
                key={option.id}
                type="button"
                className={`format-card ${selected ? 'is-selected' : ''}`}
                aria-pressed={selected}
                onClick={() => setFormat(option.id)}
              >
                <span className="format-card__frame" aria-hidden="true">
                  <i style={{ aspectRatio: `${option.width} / ${option.height}` }} />
                </span>
                <span className="format-card__copy">
                  <strong>
                    {option.platform} · {option.surface}
                  </strong>
                  <small>
                    {option.name} {option.ratio} · {option.width}×{option.height}
                  </small>
                  <small>{option.blurb}</small>
                </span>
                {selected && (
                  <span className="format-card__tick" aria-hidden="true">
                    <Check size={14} />
                  </span>
                )}
              </button>
            )
          })}
        </fieldset>

        <p className="new-batch-dialog__note">
          The format is fixed once the batch is made. Every clip in it renders to
          this shape.
        </p>

        {error && (
          <p className="form-error" role="alert">
            {error.message}
          </p>
        )}

        <div className="delete-dialog__actions">
          <button className="secondary-button" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => onCreate({ name, format })}
            disabled={pending}
          >
            {pending ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}
            Create batch
          </button>
        </div>
      </section>
    </div>
  )
}
