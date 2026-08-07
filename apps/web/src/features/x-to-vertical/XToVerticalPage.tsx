import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, Film, Import, LoaderCircle, X } from 'lucide-react'
import { api } from '../../api'
import { DeleteDialog } from '../../components/DeleteDialog'
import type { DeleteIntent } from '../../components/DeleteDialog'
import { ProjectRail } from '../../components/ProjectRail'
import { ClipEditor } from '../editor/ClipEditor'
import type { Project } from '../../types'

/** Loose Clips — the ones that belong to no Batch. */
const CLIPS_KEY = ['projects'] as const

function ImportBar({ compact = false, onImported }: { compact?: boolean; onImported: (project: Project) => void }) {
  const [url, setUrl] = useState('')
  const mutation = useMutation({ mutationFn: api.importProject, onSuccess: onImported })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (url.trim()) mutation.mutate(url.trim())
  }

  return (
    <form className={compact ? 'import-bar import-bar--compact' : 'import-bar'} onSubmit={submit}>
      <label htmlFor={compact ? 'x-url-compact' : 'x-url'}>X post URL</label>
      <div className="import-bar__row">
        <div className="url-input">
          <span aria-hidden="true">X</span>
          <input
            id={compact ? 'x-url-compact' : 'x-url'}
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://x.com/account/status/…"
            required
            autoFocus={!compact}
          />
          {url && (
            <button type="button" className="icon-button" onClick={() => setUrl('')} title="Clear URL">
              <X size={16} />
            </button>
          )}
        </div>
        <button className="primary-button" disabled={mutation.isPending || !url.trim()}>
          {mutation.isPending ? <LoaderCircle className="spin" size={18} /> : <Import size={18} />}
          Import
        </button>
      </div>
      {mutation.error && <p className="form-error">{mutation.error.message}</p>}
    </form>
  )
}

function EmptyWorkspace({ onImported }: { onImported: (project: Project) => void }) {
  return (
    <main className="empty-workspace">
      <div className="empty-workspace__mark" aria-hidden="true">
        <span>9:16</span>
        <Film size={58} strokeWidth={1.2} />
      </div>
      <div className="empty-workspace__content">
        <p className="eyebrow">New vertical</p>
        <h1>Bring the frame<br />upright.</h1>
        <ImportBar onImported={onImported} />
        <div className="permission-note">
          <Check size={15} />
          Authorized content only
        </div>
      </div>
    </main>
  )
}

export function XToVerticalPage({ createNew = false }: { createNew?: boolean }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const projectsQuery = useQuery({
    queryKey: CLIPS_KEY,
    queryFn: api.listProjects,
    refetchInterval: (query) => query.state.data?.some((project) => ['queued', 'processing'].includes(project.status)) ? 1500 : 5000,
  })
  const projects = projectsQuery.data ?? []
  const activeProject = useMemo(
    () => {
      if (projectId) return projects.find((project) => project.id === projectId) ?? null
      const rememberedId = localStorage.getItem('clip-farm-active')
      return projects.find((project) => project.id === rememberedId) ?? projects[0] ?? null
    },
    [projects, projectId],
  )
  const deleteMutation = useMutation({
    mutationFn: (intent: DeleteIntent) => {
      if (intent.kind === 'all') return api.deleteAllProjects()
      if (intent.kind === 'project') return api.deleteProject(intent.project.id)
      throw new Error('The X mode does not delete batches')
    },
    onSuccess: (_result, intent) => {
      if (intent.kind === 'batch' || intent.kind === 'projects') return
      const nextProjects = intent.kind === 'all'
        ? []
        : projects.filter((project) => project.id !== intent.project.id)
      queryClient.setQueryData<Project[]>(CLIPS_KEY, nextProjects)
      setDeleteIntent(null)

      if (intent.kind === 'all' || activeProject?.id === intent.project.id) {
        localStorage.removeItem('clip-farm-active')
        const nextProject = nextProjects[0]
        if (nextProject) {
          localStorage.setItem('clip-farm-active', nextProject.id)
          navigate(`/modes/x-to-vertical/projects/${nextProject.id}`, { replace: true })
        } else {
          navigate('/modes/x-to-vertical/new', { replace: true })
        }
      }
    },
  })

  useEffect(() => {
    if (!projectsQuery.isLoading && projectId && !activeProject) {
      navigate(projects.length ? '/modes/x-to-vertical' : '/modes/x-to-vertical/new', { replace: true })
    }
  }, [activeProject, navigate, projectId, projects.length, projectsQuery.isLoading])

  useEffect(() => {
    if (!projectsQuery.isLoading && !createNew && !projectId && activeProject) {
      navigate(`/modes/x-to-vertical/projects/${activeProject.id}`, { replace: true })
    }
  }, [activeProject, createNew, navigate, projectId, projectsQuery.isLoading])

  function selectProject(id: string) {
    localStorage.setItem('clip-farm-active', id)
    navigate(`/modes/x-to-vertical/projects/${id}`)
  }

  function imported(project: Project) {
    queryClient.setQueryData<Project[]>(CLIPS_KEY, (current = []) => [project, ...current.filter((item) => item.id !== project.id)])
    selectProject(project.id)
  }

  const content = (
    projectsQuery.isLoading ? (
      <div className="app-loading"><LoaderCircle className="spin" size={30} /></div>
    ) : createNew || !activeProject ? (
      <EmptyWorkspace onImported={imported} />
    ) : (
      <ClipEditor
        clip={activeProject}
        collectionKey={CLIPS_KEY}
        rail={(
          <ProjectRail
            projects={projects}
            activeId={activeProject.id}
            onSelect={selectProject}
            onNew={() => navigate('/modes/x-to-vertical/new')}
            collapsed={railCollapsed}
            onToggle={() => setRailCollapsed((value) => !value)}
            onDelete={(project) => {
              deleteMutation.reset()
              setDeleteIntent({ kind: 'project', project })
            }}
            onClearAll={() => {
              deleteMutation.reset()
              setDeleteIntent({ kind: 'all', count: projects.length })
            }}
            deleting={deleteMutation.isPending}
          />
        )}
      />
    )
  )

  return (
    <>
      {content}
      {deleteIntent && (
        <DeleteDialog
          intent={deleteIntent}
          pending={deleteMutation.isPending}
          error={deleteMutation.error}
          onCancel={() => {
            deleteMutation.reset()
            setDeleteIntent(null)
          }}
          onConfirm={() => deleteMutation.mutate(deleteIntent)}
        />
      )}
    </>
  )
}
