import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, Layers, LoaderCircle, Pencil } from 'lucide-react'
import { api } from '../../api'
import { DeleteDialog } from '../../components/DeleteDialog'
import { formatDefinition } from '../../formats/registry'
import type { DeleteIntent } from '../../components/DeleteDialog'
import { ProjectRail } from '../../components/ProjectRail'
import { ClipEditor } from '../editor/ClipEditor'
import { BatchRail } from './BatchRail'
import { ClipDropZone } from './ClipDropZone'
import { ClipGrid } from './ClipGrid'
import { ExportPanel } from './ExportPanel'
import { NewBatchDialog } from './NewBatchDialog'
import { Player } from './Player'
import { ShotInspector } from './ShotInspector'
import { Timeline, sequenceDurationMs } from './Timeline'
import { useSequencePlayer } from './useSequencePlayer'
import type { Batch, BatchSummary, Cutaway, Format, Project, Shot, ShotTrim } from '../../types'

const BATCHES_KEY = ['batches'] as const
const batchKey = (id: string) => ['batch', id] as const

type SequenceEdit =
  | { kind: 'add'; clipId: string; position?: number; trim?: ShotTrim }
  | { kind: 'remove'; shotId: string }
  | { kind: 'move'; shotId: string; position: number }
  | { kind: 'trim'; shotId: string; trim: ShotTrim }
  | { kind: 'cover'; clipId: string; baseShotId: string; offsetMs: number }
  | { kind: 'uncover'; cutawayId: string }
  | { kind: 'anchor'; cutawayId: string; baseShotId: string; offsetMs: number }
  | { kind: 'trim-cutaway'; cutawayId: string; trim: ShotTrim }

/**
 * A Sequence edit applied to the cached Batch, so a drag lands instantly.
 *
 * Every edit round-trips and comes back as the whole Batch, but waiting for
 * that means a Shot visibly snapping back to where it was dragged from. An
 * `add` is not predicted — only the server can name the new Shot.
 */
export function applySequenceEdit(batch: Batch, edit: SequenceEdit): Batch {
  if (edit.kind === 'add' || edit.kind === 'cover') return batch

  if (edit.kind === 'uncover') {
    return { ...batch, cutaways: batch.cutaways.filter((item) => item.id !== edit.cutawayId) }
  }
  if (edit.kind === 'anchor' || edit.kind === 'trim-cutaway') {
    const patch =
      edit.kind === 'anchor'
        ? { base_shot_id: edit.baseShotId, offset_ms: edit.offsetMs }
        : edit.trim
    return {
      ...batch,
      cutaways: batch.cutaways.map((item) =>
        item.id === edit.cutawayId ? { ...item, ...patch } : item,
      ),
    }
  }

  let shots = [...batch.shots]

  if (edit.kind === 'remove') {
    shots = shots.filter((shot) => shot.id !== edit.shotId)
  } else if (edit.kind === 'move') {
    const from = shots.findIndex((shot) => shot.id === edit.shotId)
    if (from < 0) return batch
    const [moved] = shots.splice(from, 1)
    shots.splice(Math.min(edit.position, shots.length), 0, moved)
  } else {
    shots = shots.map((shot) => (shot.id === edit.shotId ? { ...shot, ...edit.trim } : shot))
  }

  return { ...batch, shots: shots.map((shot, position) => ({ ...shot, position })) }
}

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
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [placingClipId, setPlacingClipId] = useState<string | null>(null)
  // Removing is the one gesture that loses work a re-drag would not restore:
  // the Shot's own trim goes with it. So it, alone, offers an undo.
  const [undoRemoval, setUndoRemoval] = useState<{ shot: Shot; title: string } | null>(null)
  const [playheadMs, setPlayheadMs] = useState(0)
  // A Batch's Format is chosen once, in a dialog, and never edited (ADR 0006).
  const [newBatchOpen, setNewBatchOpen] = useState(false)

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
  const shots = batch?.shots ?? []
  const cutaways = batch?.cutaways ?? []
  // The playhead is shared: the Player and the Timeline both drive it, so the
  // hook lives here rather than inside either of them.
  const player = useSequencePlayer({
    shots,
    cutaways,
    clips,
    playheadMs,
    onScrub: setPlayheadMs,
  })
  // A Clip can be placed more than once, so this counts rather than flags.
  const placedCounts = shots.reduce(
    (counts, shot) => counts.set(shot.clip_id, (counts.get(shot.clip_id) ?? 0) + 1),
    new Map<string, number>(),
  )
  const activeClip = clipId ? clips.find((clip) => clip.id === clipId) ?? null : null
  const selectedIndex = shots.findIndex((shot) => shot.id === selectedShotId)
  const selectedShot = selectedIndex >= 0 ? shots[selectedIndex] : null
  // A Cutaway is a Shot too, so one selection covers both lanes.
  const selectedCutaway = cutaways.find((item) => item.id === selectedShotId) ?? null
  const selectedClip = (() => {
    const clipId = selectedShot?.clip_id ?? selectedCutaway?.clip_id
    return clipId ? clips.find((clip) => clip.id === clipId) ?? null : null
  })()
  const coveredTitle = selectedCutaway
    ? clips.find(
        (clip) =>
          clip.id === shots.find((shot) => shot.id === selectedCutaway.base_shot_id)?.clip_id,
      )?.title ?? null
    : null

  const createMutation = useMutation({
    mutationFn: (batch: { name: string; format: Format }) => api.createBatch(batch),
    onSuccess: (created) => {
      setNewBatchOpen(false)
      queryClient.setQueryData(batchKey(created.id), created)
      void queryClient.invalidateQueries({ queryKey: BATCHES_KEY })
      navigate(batchRoute(created.id))
    },
  })

  /** Open the dialog on a clean slate: a stale error must not greet the next try. */
  function askNewBatch() {
    createMutation.reset()
    setNewBatchOpen(true)
  }

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
      if (edit.kind === 'add') {
        return api.addShot(batchId!, edit.clipId, { position: edit.position, ...edit.trim })
      }
      if (edit.kind === 'remove') return api.removeShot(batchId!, edit.shotId)
      if (edit.kind === 'trim') return api.trimShot(batchId!, edit.shotId, edit.trim)
      if (edit.kind === 'cover') {
        return api.addCutaway(batchId!, {
          clip_id: edit.clipId,
          base_shot_id: edit.baseShotId,
          offset_ms: edit.offsetMs,
        })
      }
      if (edit.kind === 'uncover') return api.removeCutaway(batchId!, edit.cutawayId)
      if (edit.kind === 'anchor') {
        return api.updateCutaway(batchId!, edit.cutawayId, {
          base_shot_id: edit.baseShotId,
          offset_ms: edit.offsetMs,
        })
      }
      if (edit.kind === 'trim-cutaway') {
        return api.updateCutaway(batchId!, edit.cutawayId, edit.trim)
      }
      return api.moveShot(batchId!, edit.shotId, edit.position)
    },
    // The gesture already ended, so the cache moves now and rolls back if the
    // server disagrees. Without this a dropped Shot snaps back mid-flight.
    onMutate: async (edit) => {
      await queryClient.cancelQueries({ queryKey: batchKey(batchId!) })
      const previous = queryClient.getQueryData<Batch>(batchKey(batchId!))
      if (previous) {
        queryClient.setQueryData(batchKey(batchId!), applySequenceEdit(previous, edit))
      }
      return { previous }
    },
    onError: (_error, _edit, context) => {
      if (context?.previous) queryClient.setQueryData(batchKey(batchId!), context.previous)
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

  // Rejections, a selection, and an offered undo all belong to the batch they
  // came from.
  useEffect(() => {
    setRejected([])
    setSelectedShotId(null)
    setUndoRemoval(null)
    setPlayheadMs(0)
  }, [batchId])

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
      onNew={askNewBatch}
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
    content = <EmptyBatches onCreate={askNewBatch} creating={createMutation.isPending} />
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
                {/* Plain text, not a control: the Format was settled when this
                    Batch was created and does not change (ADR 0006). */}
                <span>
                  {formatDefinition(batch.format).platform} ·{' '}
                  {formatDefinition(batch.format).name} {formatDefinition(batch.format).ratio}
                </span>
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
            <div className="batch-editor">
              <div className="batch-editor__player">
                <Player player={player} format={batch.format} />
              </div>
              <div className="batch-editor__timeline">
              <Timeline
                shots={shots}
                cutaways={cutaways}
                clips={clips}
                selectedShotId={selectedShotId}
                placingClipId={placingClipId}
                playheadMs={playheadMs}
                onScrub={setPlayheadMs}
                onSelect={setSelectedShotId}
                onMove={(shot, position) =>
                  sequenceMutation.mutate({ kind: 'move', shotId: shot.id, position })
                }
                onTrim={(shot, trim) =>
                  sequenceMutation.mutate({ kind: 'trim', shotId: shot.id, trim })
                }
                onPlace={(clipId, position) =>
                  sequenceMutation.mutate({ kind: 'add', clipId, position })
                }
                onMoveCutaway={(cutaway, baseShotId, offsetMs) =>
                  sequenceMutation.mutate({
                    kind: 'anchor',
                    cutawayId: cutaway.id,
                    baseShotId,
                    offsetMs,
                  })
                }
                onTrimCutaway={(cutaway, trim) =>
                  sequenceMutation.mutate({ kind: 'trim-cutaway', cutawayId: cutaway.id, trim })
                }
                onPlaceCutaway={(clipId, baseShotId, offsetMs) =>
                  sequenceMutation.mutate({ kind: 'cover', clipId, baseShotId, offsetMs })
                }
                onPlaceEnd={() => setPlacingClipId(null)}
                busy={sequenceMutation.isPending}
              />
              </div>
              <div className="batch-editor__panels">
              {selectedClip && (selectedShot || selectedCutaway) && (
                <ShotInspector
                  shot={selectedShot ?? selectedCutaway!}
                  clip={selectedClip}
                  index={selectedIndex}
                  count={shots.length}
                  covering={coveredTitle}
                  onMove={(shot, position) =>
                    sequenceMutation.mutate({ kind: 'move', shotId: shot.id, position })
                  }
                  onTrim={(shot, trim) =>
                    sequenceMutation.mutate(
                      selectedCutaway
                        ? { kind: 'trim-cutaway', cutawayId: shot.id, trim }
                        : { kind: 'trim', shotId: shot.id, trim },
                    )
                  }
                  onRemove={(shot) => {
                    setSelectedShotId(null)
                    if (selectedCutaway) {
                      sequenceMutation.mutate({ kind: 'uncover', cutawayId: shot.id })
                      return
                    }
                    setUndoRemoval({ shot: shot as Shot, title: selectedClip.title })
                    sequenceMutation.mutate({ kind: 'remove', shotId: shot.id })
                  }}
                  busy={sequenceMutation.isPending}
                />
              )}
              {undoRemoval && (
                <div className="undo-toast" role="status">
                  Removed {undoRemoval.title} from the timeline
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      const { shot } = undoRemoval
                      setUndoRemoval(null)
                      sequenceMutation.mutate({
                        kind: 'add',
                        clipId: shot.clip_id,
                        position: shot.position,
                        trim: {
                          trim_start_ms: shot.trim_start_ms,
                          trim_end_ms: shot.trim_end_ms,
                        },
                      })
                    }}
                  >
                    Undo
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setUndoRemoval(null)}
                    aria-label="Dismiss"
                  >
                    Dismiss
                  </button>
                </div>
              )}
              <ExportPanel
                sequenceRender={batch.sequence_render}
                shotCount={shots.length}
                totalMs={sequenceDurationMs(shots, clips)}
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
                onDragToTimeline={(clip) => setPlacingClipId(clip.id)}
                placedCounts={placedCounts}
                adding={sequenceMutation.isPending}
              />
              </div>
            </div>
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
      {newBatchOpen && (
        <NewBatchDialog
          pending={createMutation.isPending}
          error={createMutation.error}
          onCancel={() => {
            createMutation.reset()
            setNewBatchOpen(false)
          }}
          onCreate={(created) => createMutation.mutate(created)}
        />
      )}
    </>
  )
}
