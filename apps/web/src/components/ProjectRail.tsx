import { ChevronLeft, Clapperboard, Plus, Trash2 } from 'lucide-react'
import { formatTime } from '../lib/format'
import { artifact, projectIsBusy } from '../lib/project'
import type { Project } from '../types'

/**
 * The rail of Clips beside the editor.
 *
 * Both Modes show the same rows; only the words around them differ, so the
 * headings and the two buttons are supplied by the caller. Batch Process omits
 * `onClearAll` entirely — a Batch is cleared by deleting the Batch.
 */
export function ProjectRail({
  projects,
  activeId,
  onSelect,
  onNew,
  collapsed,
  onToggle,
  onDelete,
  onClearAll,
  deleting,
  heading = 'Recent clips',
  newLabel = 'New clip',
  newTitle = 'Import another X post',
  clearLabel = 'Clear all',
}: {
  projects: Project[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  collapsed: boolean
  onToggle: () => void
  onDelete: (project: Project) => void
  onClearAll?: () => void
  deleting: boolean
  heading?: string
  newLabel?: string
  newTitle?: string
  clearLabel?: string
}) {
  const hasBusyProjects = projects.some(projectIsBusy)

  return (
    <aside className={`project-rail ${collapsed ? 'project-rail--collapsed' : ''}`}>
      <div className="project-rail__head">
        {!collapsed && <span>{heading}</span>}
        <button className="icon-button" onClick={onToggle} title={collapsed ? 'Open project rail' : 'Close project rail'}>
          <ChevronLeft size={18} />
        </button>
      </div>
      <button className="new-project-button" onClick={onNew} title={newTitle}>
        <Plus size={18} />
        {!collapsed && newLabel}
      </button>
      <div className="project-list">
        {projects.map((project) => {
          const thumbnail = artifact(project, 'thumbnail')
          const busy = projectIsBusy(project)
          return (
            <div className={`project-list__row ${activeId === project.id ? 'is-active' : ''}`} key={project.id}>
              <button
                className="project-list__item"
                onClick={() => onSelect(project.id)}
                title={project.title}
              >
                <span className="project-list__thumb">
                  {thumbnail ? <img src={thumbnail} alt="" /> : <Clapperboard size={20} />}
                </span>
                {!collapsed && (
                  <span className="project-list__meta">
                    <strong>{project.title}</strong>
                    <small>{formatTime(project.duration_ms)} · {project.layout === 'smart_crop' ? 'Crop' : 'Fit'}</small>
                  </span>
                )}
              </button>
              <button
                className="project-list__delete"
                onClick={() => onDelete(project)}
                disabled={deleting || busy}
                aria-label={`Delete ${project.title}`}
                title={busy ? 'Wait for processing to finish before deleting' : `Delete ${project.title}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          )
        })}
      </div>
      {onClearAll && (
        <button
          className="clear-projects-button"
          onClick={onClearAll}
          disabled={deleting || hasBusyProjects || projects.length === 0}
          title={hasBusyProjects ? 'Wait for all processing to finish before clearing videos' : 'Delete all videos'}
        >
          <Trash2 size={15} />
          {!collapsed && clearLabel}
        </button>
      )}
    </aside>
  )
}
