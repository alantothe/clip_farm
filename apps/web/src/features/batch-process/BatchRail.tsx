import { ChevronLeft, Layers, Plus, Trash2 } from 'lucide-react'
import type { BatchSummary } from '../../types'

/**
 * The list of Batches. Its job is to make parallel work legible: each row says
 * how many Clips a Batch holds and how many are still importing, so the
 * operator can leave one Batch churning and go work in another.
 */
export function BatchRail({
  batches,
  activeId,
  onSelect,
  onNew,
  collapsed,
  onToggle,
  onDelete,
  creating,
  deleting,
}: {
  batches: BatchSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  collapsed: boolean
  onToggle: () => void
  onDelete: (batch: BatchSummary) => void
  creating: boolean
  deleting: boolean
}) {
  return (
    <aside className={`project-rail ${collapsed ? 'project-rail--collapsed' : ''}`}>
      <div className="project-rail__head">
        {!collapsed && <span>Batches</span>}
        <button
          className="icon-button"
          onClick={onToggle}
          title={collapsed ? 'Open batch rail' : 'Close batch rail'}
        >
          <ChevronLeft size={18} />
        </button>
      </div>
      <button
        className="new-project-button"
        onClick={onNew}
        disabled={creating}
        title="Start another batch"
      >
        <Plus size={18} />
        {!collapsed && 'New batch'}
      </button>
      <div className="project-list">
        {batches.map((batch) => {
          const busy = batch.importing_count > 0
          return (
            <div
              className={`project-list__row ${activeId === batch.id ? 'is-active' : ''}`}
              key={batch.id}
            >
              <button
                className="project-list__item"
                onClick={() => onSelect(batch.id)}
                title={batch.name}
              >
                <span className="project-list__thumb"><Layers size={20} /></span>
                {!collapsed && (
                  <span className="project-list__meta">
                    <strong>{batch.name}</strong>
                    <small>
                      {batch.clip_count} {batch.clip_count === 1 ? 'clip' : 'clips'}
                      {busy && ` · ${batch.importing_count} importing`}
                      {batch.failed_count > 0 && ` · ${batch.failed_count} failed`}
                    </small>
                  </span>
                )}
              </button>
              <button
                className="project-list__delete"
                onClick={() => onDelete(batch)}
                disabled={deleting || busy}
                aria-label={`Delete ${batch.name}`}
                title={busy ? 'Wait for this batch to finish importing' : `Delete ${batch.name}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
