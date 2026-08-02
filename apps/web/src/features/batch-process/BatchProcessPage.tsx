import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, Layers, LoaderCircle, Pencil } from 'lucide-react'
import { api } from '../../api'
import { DeleteDialog } from '../../components/DeleteDialog'
import type { DeleteIntent } from '../../components/DeleteDialog'
import { ProjectRail } from '../../components/ProjectRail'
import { ClipEditor } from '../editor/ClipEditor'
import { BatchRail } from './BatchRail'
import { ClipDropZone } from './ClipDropZone'
import { ClipGrid } from './ClipGrid'
import { ExportPanel } from './ExportPanel'
import { Timeline, sequenceDurationMs } from './Timeline'
import type { Batch, BatchSummary, Project } from '../../types'

const BATCHES_KEY = ['batches'] as const
const batchKey = (id: string) => ['batch', id] as const

type SequenceEdit =
  | { kind: 'add'; clipId: string }
  | { kind: 'remove'; shotId: string }
  | { kind: 'move'; shotId: string; position: number }

const batchRoute = (id: string) => `/modes/batch-process/batches/${id}`
const clipRoute = (batchId: string, clipId: string) => `${batchRoute(batchId)}/clips/${clipId}`

function EmptyBatches({ onCreate, creating }: { onCreate: () => void; creating: boolean }) {
  return (
    <main className="empty-workspace">
      <div className="empty-workspace__mark" aria-hidden="true">
        <span>9:16</span>
        <Layers size={58} strokeWidth={1.2} />
      </div>
      <div className="empty-workspace__content">
        <p className="eyebrow">New batch</p>
        <h1>Work on many<br />clips at once.</h1>
        <p className="batch-lede">
          A batch holds a set of videos you are working through together. Start as many as you
          like — each one imports and renders on its own.
        </p>
        <button className="primary-button" type="button" onClick={onCreate} disabled={creating}>
          {creating ? <LoaderCircle className="spin" size={18} /> : <Layers size={18} />}
          Start a batch
        </button>
        <div className="permission-note">
          <Check size={15} />
          Authorized content only
        </div>
      </div>
    </main>
  )
}

function BatchTitle({ batch, onRename }: { batch: Batch; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(batch.name)

  useEffect(() => {
    setDraft(batch.name)
    setEditing(false)
  }, [batch.id, batch.name])

  function commit() {
    setEditing(false)
    const cleaned = draft.trim()
    if (cleaned && cleaned !== batch.name) onRename(cleaned)
    else setDraft(batch.name)
  }

  if (editing) {
    return (
      <input
        className="batch-title-input"
        value={draft}
        autoFocus
        aria-label="Batch name"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') {
            setDraft(batch.name)
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <h1 className="batch-title">
      {batch.name}
      <button
        className="icon-button"
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Rename ${batch.name}`}
        title="Rename batch"
      >
        <Pencil size={16} />
      </button>
    </h1>
  )
}

export function BatchProcessPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { batchId, clipId } = useParams<{ batchId: string; clipId: string }>()
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null)
  const [rejected, setRejected] = useState<string[]>([])

  const batchesQuery = useQuery({ queryKey: BATCHES_KEY, queryFn: api.listBatches })
  const batches = batchesQuery.data ?? []

  const batchQuery = useQuery({
    queryKey: batchKey(batchId ?? ''),
    queryFn: () => api.getBatch(batchId!),
    enabled: Boolean(batchId),
    // Imports run in parallel behind their own Jobs, so poll while any Clip in
    // this Batch is still moving.
    refetchInterval: (query) => {
      const current = query.state.data
      const importing = current?.clips?.some((clip) =>
        ['queued', 'processing'].includes(clip.status),
      )
      // A Sequence Render reports its own progress, not a Job's, so the Batch
      // is what gets polled while an export runs.
      const exporting =
        current?.sequence_render != null &&
        ['queued', 'running'].includes(current.sequence_render.status)
      return importing || exporting ? 1500 : false
    },
  })
  const batch = batchQuery.data ?? null
  const clips = batch?.clips ?? []
  const placedClipIds = new Set((batch?.shots ?? []).map((shot) => shot.clip_id))
  const activeClip = clipId ? clips.find((clip) => clip.id === clipId) ?? null : null

  const createMutation = useMutation({
    mutationFn: () => api.createBatch(),
    onSuccess: (created) => {
      queryClient.setQueryData(batchKey(created.id), created)
      void queryClient.invalidateQueries({ queryKey: BATCHES_KEY })
      navigate(batchRoute(created.id))
    },
  })

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => api.uploadClips(batchId!, files),
    onSuccess: (result) => {
      queryClient.setQueryData(batchKey(result.batch.id), result.batch)
      void queryClient.invalidateQueries({ queryKey: BATCHES_KEY })
      setRejected(result.rejected)
    },
  })

  const sequenceMutation = useMutation({
    mutationFn: (edit: SequenceEdit) => {
      if (edit.kind === 'add') return api.addShot(batchId!, edit.clipId)
      if (edit.kind === 'remove') return api.removeShot(batchId!, edit.shotId)
      return api.moveShot(batchId!, edit.shotId, edit.position)
    },
    // Every Sequence edit returns the whole Batch, so one response is enough.
    onSuccess: (updated) => {
      queryClient.setQueryData(batchKey(updated.id), updated)
      void queryClient.invalidateQueries({ queryKey: BATCHES_KEY })
    },
  })

  const exportMutation = useMutation({
    mutationFn: () => api.renderSequence(batchId!),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: batchKey(batchId!) }),
  })

  const renameMutation = useMutation({
    mutationFn: (name: string) => api.renameBatch(batchId!, name),
    onSuccess: (updated) => {
      queryClient.setQueryData(batchKey(updated.id), updated)
      void queryClient.invalidateQueries({ queryKey: BATCHES_KEY })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (intent: DeleteIntent) => {
      if (intent.kind === 'batch') return api.deleteBatch(intent.batch.id)
      if (intent.kind === 'project') return api.deleteProject(intent.project.id)
      throw new Error('Batch Process does not clear every clip at once')
    },
    onSuccess: (_result, intent) => {
      setDeleteIntent(null)
      void queryClient.invalidateQueries({ queryKey: BATCHES_KEY })
      if (intent.kind === 'batch') {
        queryClient.removeQueries({ queryKey: batchKey(intent.batch.id) })
        const next = batches.find((item) => item.id !== intent.batch.id)
        navigate(next ? batchRoute(next.id) : '/modes/batch-process', { replace: true })
        return
      }
      if (intent.kind !== 'project' || !batchId) return
      void queryClient.invalidateQueries({ queryKey: batchKey(batchId) })
      if (clipId === intent.project.id) navigate(batchRoute(batchId), { replace: true })
    },
  })

  // Rejections belong to the batch they were reported for.
  useEffect(() => setRejected([]), [batchId])

  // With no batch in the URL, open the most recent one rather than a dead end.
  useEffect(() => {
    if (!batchesQuery.isLoading && !batchId && batches.length) {
      navigate(batchRoute(batches[0].id), { replace: true })
    }
  }, [batchId, batches, batchesQuery.isLoading, navigate])

  // A batch deleted in another tab, or a stale bookmark.
  useEffect(() => {
    if (batchId && batchQuery.isError) navigate('/modes/batch-process', { replace: true })
  }, [batchId, batchQuery.isError, navigate])

  // A clip that finished importing is editable; one that never existed is not.
  useEffect(() => {
    if (clipId && batch && !activeClip) navigate(batchRoute(batch.id), { replace: true })
  }, [activeClip, batch, clipId, navigate])

  function askDeleteBatch(target: BatchSummary) {
    deleteMutation.reset()
    setDeleteIntent({ kind: 'batch', batch: target })
  }

  const batchList = (
    <BatchRail
      batches={batches}
      activeId={batchId ?? null}
      onSelect={(id) => navigate(batchRoute(id))}
      onNew={() => createMutation.mutate()}
      collapsed={railCollapsed}
      onToggle={() => setRailCollapsed((value) => !value)}
      onDelete={askDeleteBatch}
      creating={createMutation.isPending}
      deleting={deleteMutation.isPending}
    />
  )

  let content
  if (batchesQuery.isLoading) {
    content = <div className="app-loading"><LoaderCircle className="spin" size={30} /></div>
  } else if (!batches.length) {
    content = <EmptyBatches onCreate={() => createMutation.mutate()} creating={createMutation.isPending} />
  } else if (!batch) {
    content = <div className="app-loading"><LoaderCircle className="spin" size={30} /></div>
  } else if (activeClip) {
    content = (
      <ClipEditor
        clip={activeClip}
        collectionKey={batchKey(batch.id)}
        // The Batch delivers one video, so a per-Clip render here would only
        // ever be an intermediate. Editing is unchanged.
        ownRender={false}
        rail={(
          <ProjectRail
            projects={clips}
            activeId={activeClip.id}
            onSelect={(id) => navigate(clipRoute(batch.id, id))}
            onNew={() => navigate(batchRoute(batch.id))}
            collapsed={railCollapsed}
            onToggle={() => setRailCollapsed((value) => !value)}
            onDelete={(clip) => {
              deleteMutation.reset()
              setDeleteIntent({ kind: 'project', project: clip })
            }}
            deleting={deleteMutation.isPending}
            heading={batch.name}
            newLabel="Add videos"
            newTitle="Back to the batch to add more videos"
          />
        )}
      />
    )
  } else {
    content = (
      <div className="workspace-shell">
        {batchList}
        <main className="workspace">
          <div className="workspace-title">
            <div>
              <div className="workspace-title__meta">
                <span>{clips.length} {clips.length === 1 ? 'clip' : 'clips'}</span>
              </div>
              <BatchTitle batch={batch} onRename={(name) => renameMutation.mutate(name)} />
            </div>
          </div>

          <ClipDropZone
            onAdd={(files) => {
              setRejected([])
              uploadMutation.mutate(files)
            }}
            uploading={uploadMutation.isPending}
            compact={clips.length > 0}
          />

          {rejected.length > 0 && (
            <div className="toast-error" role="alert">
              {rejected.map((message) => <p key={message}>{message}</p>)}
            </div>
          )}
          {uploadMutation.error && <div className="toast-error">{uploadMutation.error.message}</div>}
          {renameMutation.error && <div className="toast-error">{renameMutation.error.message}</div>}

          {clips.length > 0 ? (
            <>
              <Timeline
                shots={batch.shots}
                clips={clips}
                onMove={(shot, position) =>
                  sequenceMutation.mutate({ kind: 'move', shotId: shot.id, position })
                }
                onRemove={(shot) => sequenceMutation.mutate({ kind: 'remove', shotId: shot.id })}
                busy={sequenceMutation.isPending}
              />
              <ExportPanel
                sequenceRender={batch.sequence_render}
                shotCount={batch.shots.length}
                totalMs={sequenceDurationMs(batch.shots, clips)}
                onExport={() => exportMutation.mutate()}
                starting={exportMutation.isPending}
                error={exportMutation.error}
              />
              {sequenceMutation.error && (
                <div className="toast-error" role="alert">{sequenceMutation.error.message}</div>
              )}
              <ClipGrid
                clips={clips}
                onOpen={(clip) => navigate(clipRoute(batch.id, clip.id))}
                onAdd={(clip) => sequenceMutation.mutate({ kind: 'add', clipId: clip.id })}
                placedClipIds={placedClipIds}
                adding={sequenceMutation.isPending}
              />
            </>
          ) : (
            <p className="batch-empty">
              No clips yet. Add videos above and each one imports on its own — you can start
              another batch while these run.
            </p>
          )}
        </main>
      </div>
    )
  }

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
