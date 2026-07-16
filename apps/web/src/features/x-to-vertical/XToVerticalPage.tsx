import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Captions,
  Check,
  ChevronLeft,
  Clapperboard,
  Crop,
  Download,
  ExternalLink,
  Film,
  Focus,
  Import,
  LoaderCircle,
  PanelTop,
  Play,
  Plus,
  RefreshCw,
  Save,
  Scissors,
  Trash2,
  X,
} from 'lucide-react'
import { api } from '../../api'
import type { CaptionSegment, CaptionStyle, Job, Layout, Project, ProjectSettings } from '../../types'

function formatTime(ms: number | null | undefined): string {
  if (ms == null) return '00:00.0'
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  const tenths = Math.floor((ms % 1000) / 100)
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${tenths}`
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function artifact(project: Project, kind: string): string {
  return api.mediaUrl(project.artifacts.find((item) => item.kind === kind)?.url ?? null)
}

function getSettings(project: Project): ProjectSettings {
  return {
    trim_start_ms: project.trim_start_ms,
    trim_end_ms: project.trim_end_ms ?? project.duration_ms ?? 1,
    layout: project.layout,
    crop_center_x: project.crop_center_x,
    captions_enabled: project.captions_enabled,
    caption_style: project.caption_style,
  }
}

const captionStyleDetails: Record<CaptionStyle, { label: string; font: string; size: number; color: string; placement: string }> = {
  bold: { label: 'Bold', font: 'DejaVu Sans', size: 72, color: '#FFFFFF', placement: 'Bottom · 15%' },
  classic: { label: 'Classic', font: 'DejaVu Sans', size: 60, color: '#FFFFFF', placement: 'Bottom · 14%' },
  minimal: { label: 'Minimal', font: 'DejaVu Sans', size: 56, color: '#F5F6F0', placement: 'Bottom · 13%' },
}

function captionSample(captions: CaptionSegment[]): string {
  const text = captions.find((caption) => caption.text.trim())?.text.trim()
  if (!text) return 'Your captions, in frame.'
  const words = text.split(/\s+/)
  return words.length > 7 ? `${words.slice(0, 7).join(' ')}…` : text
}

function Status({ value }: { value: string }) {
  return (
    <span className={`status status--${value}`}>
      <i />
      {value.replace('_', ' ')}
    </span>
  )
}

function projectIsBusy(project: Project): boolean {
  return ['queued', 'processing'].includes(project.status)
    || Boolean(project.latest_job && ['queued', 'running'].includes(project.latest_job.status))
}

type DeleteIntent =
  | { kind: 'project'; project: Project }
  | { kind: 'all'; count: number }

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

function ProjectRail({
  projects,
  activeId,
  onSelect,
  onNew,
  collapsed,
  onToggle,
  onDelete,
  onClearAll,
  deleting,
}: {
  projects: Project[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  collapsed: boolean
  onToggle: () => void
  onDelete: (project: Project) => void
  onClearAll: () => void
  deleting: boolean
}) {
  const hasBusyProjects = projects.some(projectIsBusy)

  return (
    <aside className={`project-rail ${collapsed ? 'project-rail--collapsed' : ''}`}>
      <div className="project-rail__head">
        {!collapsed && <span>Recent clips</span>}
        <button className="icon-button" onClick={onToggle} title={collapsed ? 'Open project rail' : 'Close project rail'}>
          <ChevronLeft size={18} />
        </button>
      </div>
      <button className="new-project-button" onClick={onNew} title="Import another X post">
        <Plus size={18} />
        {!collapsed && 'New clip'}
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
      <button
        className="clear-projects-button"
        onClick={onClearAll}
        disabled={deleting || hasBusyProjects || projects.length === 0}
        title={hasBusyProjects ? 'Wait for all processing to finish before clearing videos' : 'Delete all videos'}
      >
        <Trash2 size={15} />
        {!collapsed && 'Clear all'}
      </button>
    </aside>
  )
}

function DeleteDialog({
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

function VideoStage({
  project,
  settings,
  captions,
  outputUrl,
  previewMode,
  onPreviewMode,
}: {
  project: Project
  settings: ProjectSettings
  captions: CaptionSegment[]
  outputUrl: string
  previewMode: 'source' | 'output'
  onPreviewMode: (mode: 'source' | 'output') => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [timeMs, setTimeMs] = useState(settings.trim_start_ms)
  const previewUrl = artifact(project, 'preview') || artifact(project, 'source')
  const thumbnail = artifact(project, 'thumbnail')
  const shownUrl = previewMode === 'output' && outputUrl ? outputUrl : previewUrl
  const activeCaption = captions.find(
    (segment) => timeMs >= segment.start_ms && timeMs <= segment.end_ms,
  )

  useEffect(() => {
    if (videoRef.current && previewMode === 'source') {
      videoRef.current.currentTime = settings.trim_start_ms / 1000
    }
  }, [settings.trim_start_ms, previewMode])

  return (
    <section className="stage-column">
      <div className="stage-toolbar">
        <div className="view-tabs" role="tablist" aria-label="Preview source">
          <button className={previewMode === 'source' ? 'is-active' : ''} onClick={() => onPreviewMode('source')}>Source</button>
          <button disabled={!outputUrl} className={previewMode === 'output' ? 'is-active' : ''} onClick={() => onPreviewMode('output')}>Output</button>
        </div>
        <span>{previewMode === 'output' ? '1080 × 1920' : `${project.width ?? '—'} × ${project.height ?? '—'}`}</span>
      </div>
      <div
        className={`video-stage video-stage--${settings.layout}`}
        style={{ '--crop-x': `${settings.crop_center_x}%`, '--stage-thumb': `url("${thumbnail}")` } as React.CSSProperties}
      >
        {settings.layout === 'fit_background' && previewMode === 'source' && <div className="video-stage__backdrop" />}
        {shownUrl ? (
          <video
            ref={videoRef}
            key={shownUrl}
            src={shownUrl}
            controls
            playsInline
            onTimeUpdate={(event) => {
              const video = event.currentTarget
              const current = video.currentTime * 1000
              setTimeMs(current)
              if (previewMode === 'source' && current > settings.trim_end_ms) {
                video.currentTime = settings.trim_start_ms / 1000
                if (!video.paused) void video.play()
              }
            }}
          />
        ) : (
          <LoaderCircle className="spin stage-loader" size={36} />
        )}
        {previewMode === 'source' && settings.captions_enabled && activeCaption?.text && (
          <div className={`caption-preview caption-preview--${settings.caption_style}`}>{activeCaption.text}</div>
        )}
        <div className="safe-area" aria-hidden="true" />
      </div>
      <div className="stage-footer">
        <span>{formatTime(settings.trim_start_ms)}</span>
        <span className="stage-footer__track"><i style={{ width: `${((settings.trim_end_ms - settings.trim_start_ms) / (project.duration_ms || 1)) * 100}%` }} /></span>
        <span>{formatTime(settings.trim_end_ms)}</span>
      </div>
    </section>
  )
}

function CaptionStylePicker({
  value,
  captions,
  onChange,
}: {
  value: CaptionStyle
  captions: CaptionSegment[]
  onChange: (value: CaptionStyle) => void
}) {
  const selected = captionStyleDetails[value]
  const sample = captionSample(captions)

  return (
    <div className="caption-style-control">
      <div className="caption-style-options" role="radiogroup" aria-label="Caption style">
        {(Object.keys(captionStyleDetails) as CaptionStyle[]).map((style) => {
          const details = captionStyleDetails[style]
          return (
            <button
              type="button"
              role="radio"
              aria-checked={value === style}
              aria-label={`${details.label}, ${details.font}, ${details.size} pixels, ${details.color}`}
              className={`caption-style-option ${value === style ? 'is-active' : ''}`}
              key={style}
              onClick={() => onChange(style)}
            >
              <span className={`caption-style-option__sample caption-style-option__sample--${style}`}>Aa</span>
              <span>{details.label}</span>
              <small>{details.size} px</small>
            </button>
          )
        })}
      </div>
      <div className={`caption-style-preview caption-style-preview--${value}`}>
        <div className="caption-style-preview__head">
          <span>Style preview</span>
          <small>{selected.placement} safe</small>
        </div>
        <div className="caption-style-preview__frame">
          <span className={`caption-style-preview__text caption-style-preview__text--${value}`}>{sample}</span>
        </div>
        <dl>
          <div><dt>Font</dt><dd>{selected.font}</dd></div>
          <div><dt>Size</dt><dd>{selected.size} px</dd></div>
          <div><dt>Color</dt><dd><i style={{ background: selected.color }} />{selected.color}</dd></div>
        </dl>
      </div>
      <p className="caption-placement-note">Bottom-centered with side margins and automatic line wrapping inside the 9:16 safe area.</p>
    </div>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon?: React.ReactNode }[]; onChange: (value: T) => void }) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button key={option.value} className={value === option.value ? 'is-active' : ''} onClick={() => onChange(option.value)}>
          {option.icon}{option.label}
        </button>
      ))}
    </div>
  )
}

function EditorPanel({
  project,
  settings,
  setSettings,
  captions,
  setCaptions,
  onSave,
  onTranscribe,
  onRender,
  saving,
  rendering,
}: {
  project: Project
  settings: ProjectSettings
  setSettings: (next: ProjectSettings) => void
  captions: CaptionSegment[]
  setCaptions: (next: CaptionSegment[]) => void
  onSave: () => void
  onTranscribe: () => void
  onRender: () => void
  saving: boolean
  rendering: boolean
}) {
  const [tab, setTab] = useState<'frame' | 'captions'>('frame')
  const duration = project.duration_ms ?? 1

  return (
    <section className="editor-panel">
      <div className="editor-tabs" role="tablist">
        <button className={tab === 'frame' ? 'is-active' : ''} onClick={() => setTab('frame')}><Crop size={17} /> Frame</button>
        <button className={tab === 'captions' ? 'is-active' : ''} onClick={() => setTab('captions')}><Captions size={17} /> Captions <span>{captions.length}</span></button>
      </div>

      <div className="editor-panel__body">
        {tab === 'frame' ? (
          <>
            <div className="control-group">
              <div className="control-label"><span>Layout</span></div>
              <Segmented<Layout>
                value={settings.layout}
                onChange={(layout) => setSettings({ ...settings, layout })}
                options={[
                  { value: 'smart_crop', label: 'Smart crop', icon: <Focus size={16} /> },
                  { value: 'fit_background', label: 'Full frame', icon: <PanelTop size={16} /> },
                ]}
              />
            </div>

            {settings.layout === 'smart_crop' && (
              <div className="control-group">
                <div className="control-label"><span>Fallback focus</span><output>{Math.round(settings.crop_center_x)}%</output></div>
                <input type="range" min="0" max="100" value={settings.crop_center_x} onChange={(event) => setSettings({ ...settings, crop_center_x: Number(event.target.value) })} />
                <div className="range-labels"><span>Left</span><span>Center</span><span>Right</span></div>
              </div>
            )}

            <div className="control-group trim-group">
              <div className="control-label"><span><Scissors size={15} /> Trim</span><output>{formatTime(settings.trim_end_ms - settings.trim_start_ms)}</output></div>
              <label>Start <time>{formatTime(settings.trim_start_ms)}</time></label>
              <input
                type="range"
                min="0"
                max={Math.max(1, settings.trim_end_ms - 100)}
                step="100"
                value={settings.trim_start_ms}
                onChange={(event) => setSettings({ ...settings, trim_start_ms: Number(event.target.value) })}
              />
              <label>End <time>{formatTime(settings.trim_end_ms)}</time></label>
              <input
                type="range"
                min={settings.trim_start_ms + 100}
                max={duration}
                step="100"
                value={settings.trim_end_ms}
                onChange={(event) => setSettings({ ...settings, trim_end_ms: Number(event.target.value) })}
              />
            </div>

            <div className="source-specs">
              <span>Source</span>
              <dl>
                <div><dt>Format</dt><dd>{project.width} × {project.height}</dd></div>
                <div><dt>Frame rate</dt><dd>{project.fps?.toFixed(2) ?? '—'} fps</dd></div>
                <div><dt>Duration</dt><dd>{formatTime(project.duration_ms)}</dd></div>
              </dl>
            </div>
          </>
        ) : (
          <>
            <div className="caption-head">
              <label className="toggle-row">
                <span>Burn in captions</span>
                <input type="checkbox" checked={settings.captions_enabled} onChange={(event) => setSettings({ ...settings, captions_enabled: event.target.checked })} />
                <i />
              </label>
              <CaptionStylePicker
                value={settings.caption_style}
                captions={captions}
                onChange={(caption_style) => setSettings({ ...settings, caption_style })}
              />
            </div>
            {captions.length ? (
              <div className="caption-list">
                {captions.map((segment, index) => (
                  <div className="caption-row" key={segment.id}>
                    <span>{formatTime(segment.start_ms)}</span>
                    <textarea
                      value={segment.text}
                      rows={2}
                      onChange={(event) => {
                        const next = captions.slice()
                        next[index] = { ...segment, text: event.target.value }
                        setCaptions(next)
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="caption-empty">
                <Captions size={28} />
                <span>{project.transcription_status === 'processing' ? 'Creating captions…' : 'No captions available'}</span>
                <button className="secondary-button" onClick={onTranscribe} disabled={project.transcription_status === 'processing'}>
                  <RefreshCw size={16} /> Retry
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="editor-actions">
        <button className="icon-command" onClick={onSave} disabled={saving} title="Save edits">
          {saving ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}
        </button>
        <button className="render-button" onClick={onRender} disabled={rendering || project.status !== 'ready'}>
          {rendering ? <LoaderCircle className="spin" size={18} /> : <Play size={18} fill="currentColor" />}
          Render vertical
        </button>
      </div>
    </section>
  )
}

function JobBanner({ job }: { job: Job }) {
  return (
    <div className={`job-banner job-banner--${job.status}`}>
      <div className="job-banner__icon">
        {job.status === 'complete' ? <Check size={18} /> : job.status === 'failed' ? <X size={18} /> : <LoaderCircle className="spin" size={18} />}
      </div>
      <div>
        <strong>{job.message}</strong>
        {job.error_message && <span>{job.error_message}</span>}
      </div>
      <div className="job-progress"><i style={{ width: `${job.progress}%` }} /></div>
      <output>{job.progress}%</output>
    </div>
  )
}

function ImportFailure({ project }: { project: Project }) {
  const job = project.latest_job
  const error = job?.error_message || project.error_message || 'The importer did not provide an error message.'
  const failedAt = job?.completed_at

  return (
    <section className="fatal-state" role="alert" aria-labelledby="import-failure-title">
      <div className="failure-card__heading">
        <span className="failure-card__icon"><X size={22} /></span>
        <div>
          <p className="eyebrow">Video import</p>
          <h2 id="import-failure-title">{job?.message || 'Import failed'}</h2>
          <p>The video was not added. Review the diagnostics below, correct the issue, and import the post again.</p>
        </div>
      </div>
      <dl className="failure-card__meta">
        <div><dt>Post</dt><dd>{project.source_post_id}</dd></div>
        {job && <div><dt>Attempts</dt><dd>{job.attempts}</dd></div>}
        {failedAt && <div><dt>Failed</dt><dd><time dateTime={failedAt}>{new Date(failedAt).toLocaleString()}</time></dd></div>}
      </dl>
      <details className="failure-card__details" open>
        <summary>Error details</summary>
        <pre>{error}</pre>
      </details>
    </section>
  )
}

function Workspace({ project, projects, activeId, onSelect, onNew, onDelete, onClearAll, deleting }: { project: Project; projects: Project[]; activeId: string; onSelect: (id: string) => void; onNew: () => void; onDelete: (project: Project) => void; onClearAll: () => void; deleting: boolean }) {
  const queryClient = useQueryClient()
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [settings, setSettings] = useState<ProjectSettings>(() => getSettings(project))
  const [captions, setCaptions] = useState<CaptionSegment[]>(project.captions)
  const [previewMode, setPreviewMode] = useState<'source' | 'output'>('source')
  const [jobId, setJobId] = useState<string | null>(null)

  useEffect(() => {
    setSettings(getSettings(project))
    setCaptions(project.captions)
  }, [project.id, project.updated_at])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updated = await api.updateProject(project.id, settings)
      if (captions.length) await api.updateCaptions(project.id, captions)
      return updated
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  })
  const renderMutation = useMutation({
    mutationFn: async () => {
      await saveMutation.mutateAsync()
      return api.render(project.id)
    },
    onSuccess: (job) => setJobId(job.id),
  })
  const transcribeMutation = useMutation({
    mutationFn: () => api.transcribe(project.id),
    onSuccess: (job) => setJobId(job.id),
  })
  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.getJob(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && ['complete', 'failed'].includes(status) ? false : 1000
    },
  })

  useEffect(() => {
    if (jobQuery.data?.status === 'complete') {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      if (jobQuery.data.kind === 'render') setPreviewMode('output')
    }
  }, [jobQuery.data?.status, jobQuery.data?.kind, queryClient])

  const completeRender = project.renders.find((render) => render.status === 'complete')
  const outputUrl = api.mediaUrl(completeRender?.download_url ?? null)

  return (
    <div className="workspace-shell">
      <ProjectRail
        projects={projects}
        activeId={activeId}
        onSelect={onSelect}
        onNew={onNew}
        collapsed={railCollapsed}
        onToggle={() => setRailCollapsed((value) => !value)}
        onDelete={onDelete}
        onClearAll={onClearAll}
        deleting={deleting}
      />
      <main className="workspace">
        <div className="workspace-title">
          <div>
            <div className="workspace-title__meta"><Status value={project.status} /><span>Post {project.source_post_id}</span></div>
            <h1>{project.title}</h1>
          </div>
          <div className="workspace-title__actions">
            <a className="icon-command" href={project.source_url} target="_blank" rel="noreferrer" title="Open source post"><ExternalLink size={18} /></a>
            {completeRender?.download_url && (
              <a className="download-button" href={outputUrl} download><Download size={18} /> Download <span>{formatBytes(completeRender.size_bytes)}</span></a>
            )}
          </div>
        </div>

        {project.status === 'failed' ? (
          <ImportFailure project={project} />
        ) : (
          <div className="editing-grid">
            <VideoStage project={project} settings={settings} captions={captions} outputUrl={outputUrl} previewMode={previewMode} onPreviewMode={setPreviewMode} />
            <EditorPanel
              project={project}
              settings={settings}
              setSettings={setSettings}
              captions={captions}
              setCaptions={setCaptions}
              onSave={() => saveMutation.mutate()}
              onTranscribe={() => transcribeMutation.mutate()}
              onRender={() => renderMutation.mutate()}
              saving={saveMutation.isPending}
              rendering={renderMutation.isPending || (jobQuery.data?.kind === 'render' && !['complete', 'failed'].includes(jobQuery.data.status))}
            />
          </div>
        )}
        {jobQuery.data && <JobBanner job={jobQuery.data} />}
        {renderMutation.error && <div className="toast-error">{renderMutation.error.message}</div>}
      </main>
    </div>
  )
}

export function XToVerticalPage({ createNew = false }: { createNew?: boolean }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null)
  const projectsQuery = useQuery({
    queryKey: ['projects'],
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
    mutationFn: (intent: DeleteIntent) => intent.kind === 'all'
      ? api.deleteAllProjects()
      : api.deleteProject(intent.project.id),
    onSuccess: (_result, intent) => {
      const nextProjects = intent.kind === 'all'
        ? []
        : projects.filter((project) => project.id !== intent.project.id)
      queryClient.setQueryData<Project[]>(['projects'], nextProjects)
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
    queryClient.setQueryData<Project[]>(['projects'], (current = []) => [project, ...current.filter((item) => item.id !== project.id)])
    selectProject(project.id)
  }

  const content = (
    projectsQuery.isLoading ? (
      <div className="app-loading"><LoaderCircle className="spin" size={30} /></div>
    ) : createNew || !activeProject ? (
      <EmptyWorkspace onImported={imported} />
    ) : (
      <Workspace
        project={activeProject}
        projects={projects}
        activeId={activeProject.id}
        onSelect={selectProject}
        onNew={() => navigate('/modes/x-to-vertical/new')}
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
