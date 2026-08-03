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
import { MIN_SPAN_MS, Timeline, sequenceDurationMs, shotTrim, sourceTimeMs } from './Timeline'
import { TitleInspector, lookOf } from './TitleInspector'
import type { TitleSpan } from './TitleTrack'
import { useSequencePlayer } from './useSequencePlayer'
import type {
  Batch,
  BatchSummary,
  Cutaway,
  Format,
  Project,
  Shot,
  ShotTrim,
  Title,
  TitlePatch,
  TitleStyle,
} from '../../types'

const BATCHES_KEY = ['batches'] as const
const batchKey = (id: string) => ['batch', id] as const
const TITLE_STYLES_KEY = ['title-styles'] as const
const FONTS_KEY = ['fonts'] as const

/** How long a new Title runs, before the operator drags either edge. */
const NEW_TITLE_MS = 3000

/** What a Title edit sends, alongside which one it is about. */
type TitleEdit =
  | { kind: 'add'; atMs: number }
  | { kind: 'patch'; titleId: string; patch: TitlePatch }
  | { kind: 'remove'; titleId: string }

/** Saving the selected Title's look under a name, or maintaining one saved. */
type StyleAction =
  | { kind: 'save'; name: string; look: Partial<Title> }
  | { kind: 'update'; style: TitleStyle; look: Partial<Title> }
  | { kind: 'delete'; style: TitleStyle }

type SequenceEdit =
  | { kind: 'add'; clipId: string; position?: number; trim?: ShotTrim }
  | { kind: 'remove'; shotId: string }
  | { kind: 'move'; shotId: string; position: number }
  | { kind: 'trim'; shotId: string; trim: ShotTrim }
  | { kind: 'cover'; clipId: string; baseShotId: string; offsetMs: number }
  | { kind: 'uncover'; cutawayId: string }
  | { kind: 'anchor'; cutawayId: string; baseShotId: string; offsetMs: number }
  | { kind: 'trim-cutaway'; cutawayId: string; trim: ShotTrim; offsetMs?: number }

/**
 * Trimming a Cutaway, with the offset that keeps its back where it was.
 *
 * A Shot is drawn from where it starts, so cutting its front simply makes
 * everything after it play earlier. A Cutaway has no such queue behind it: it
 * sits at an offset into the Shot it covers, and if that offset stays put while
 * its front is cut, what disappears is its back instead — the head trim would
 * take the tail, which is not the edit anyone dragged for. So the offset moves
 * along by exactly what was cut. Trimming the back moves nothing, and a reset
 * back to the Clip's Trim (`null`) moves nothing either.
 */
export function trimCutawayEdit(cutaway: Cutaway, clip: Project, trim: ShotTrim): SequenceEdit {
  const start = trim.trim_start_ms
  if (start === undefined || start === null) {
    return { kind: 'trim-cutaway', cutawayId: cutaway.id, trim }
  }
  const shiftMs = start - shotTrim(cutaway, clip).start
  return {
    kind: 'trim-cutaway',
    cutawayId: cutaway.id,
    trim,
    offsetMs: Math.max(0, cutaway.offset_ms + shiftMs),
  }
}

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
        : { ...edit.trim, ...(edit.offsetMs === undefined ? {} : { offset_ms: edit.offsetMs }) }
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

/**
 * A Title edit applied to the cached Batch, so a drag lands instantly.
 *
 * The same bargain `applySequenceEdit` makes, and for the same reason: the
 * gesture has already ended, and a Title snapping back to where it was dragged
 * from while the round trip finishes reads as a bug. An `add` is not predicted
 * — only the server can name the new Title.
 */
export function applyTitleEdit(batch: Batch, edit: TitleEdit): Batch {
  if (edit.kind === 'add') return batch
  if (edit.kind === 'remove') {
    return { ...batch, titles: batch.titles.filter((title) => title.id !== edit.titleId) }
  }
  return {
    ...batch,
    titles: batch.titles.map((title) =>
      title.id === edit.titleId ? { ...title, ...edit.patch } : title,
    ),
  }
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
  // A Title's selection is its own: a Title is not a Shot, and selecting one
  // should not make the Shot inspector's buttons act on something else.
  const [selectedTitleId, setSelectedTitleId] = useState<string | null>(null)
  // An inspector control still under the operator's finger. Local only, so the
  // stage follows a slider without a request per pixel.
  const [titlePreview, setTitlePreview] = useState<({ titleId: string } & TitlePatch) | null>(
    null,
  )

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
  // Styles and the font catalog belong to the app rather than to a Batch, so
  // they are fetched once and shared. The catalog never changes between
  // releases — the faces are vendored — so it is never refetched.
  const stylesQuery = useQuery({ queryKey: TITLE_STYLES_KEY, queryFn: api.listTitleStyles })
  const fontsQuery = useQuery({
    queryKey: FONTS_KEY,
    queryFn: api.getFontCatalog,
    staleTime: Infinity,
  })
  const titleStyles: TitleStyle[] = stylesQuery.data ?? []

  const batch = batchQuery.data ?? null
  const clips = batch?.clips ?? []
  const shots = batch?.shots ?? []
  const cutaways = batch?.cutaways ?? []
  const titles = batch?.titles ?? []
  const selectedTitle = titles.find((title) => title.id === selectedTitleId) ?? null
  // The playhead is shared: the Player and the Timeline both drive it, so the
  // hook lives here rather than inside either of them.
  const player = useSequencePlayer({
    shots,
    cutaways,
    clips,
    playheadMs,
    onScrub: setPlayheadMs,
    selectedShotId,
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

  /**
   * Whether the playhead is inside the Shot that is actually selected.
   *
   * Trimming to the playhead only means anything when the two agree — moving
   * the in-point of a Shot the playhead is nowhere near would silently make a
   * cut the operator never saw.
   */
  const trimTarget =
    player.current && player.current.item.shot.id === selectedShotId ? player.current : null

  /** Set the selected Shot's Trim to wherever the playhead is sitting. */
  function trimToPlayhead(edge: 'in' | 'out') {
    if (!trimTarget) return
    const atMs = Math.round(sourceTimeMs(trimTarget.item, trimTarget.intoShotMs))
    const { start, end } = shotTrim(trimTarget.item.shot, trimTarget.item.clip)
    // The same floor the Timeline's drag-to-trim enforces, so neither route
    // can leave a Shot too short to see.
    if (edge === 'in' && atMs > end - MIN_SPAN_MS) return
    if (edge === 'out' && atMs < start + MIN_SPAN_MS) return
    sequenceMutation.mutate({
      kind: 'trim',
      shotId: trimTarget.item.shot.id,
      trim: edge === 'in' ? { trim_start_ms: atMs } : { trim_end_ms: atMs },
    })
  }

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
        return api.updateCutaway(batchId!, edit.cutawayId, {
          ...edit.trim,
          ...(edit.offsetMs === undefined ? {} : { offset_ms: edit.offsetMs }),
        })
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

  const titleMutation = useMutation({
    mutationFn: (edit: TitleEdit) => {
      if (edit.kind === 'add') {
        return api.addTitle(batchId!, {
          text: 'Your text here',
          start_ms: Math.round(edit.atMs),
          end_ms: Math.round(edit.atMs) + NEW_TITLE_MS,
          // The first built-in Style, so a new Title arrives looking like
          // something rather than as unstyled default type.
          style_id: titleStyles[0]?.id,
        })
      }
      if (edit.kind === 'remove') return api.removeTitle(batchId!, edit.titleId)
      return api.updateTitle(batchId!, edit.titleId, edit.patch)
    },
    onMutate: async (edit) => {
      await queryClient.cancelQueries({ queryKey: batchKey(batchId!) })
      const previous = queryClient.getQueryData<Batch>(batchKey(batchId!))
      if (previous) {
        queryClient.setQueryData(batchKey(batchId!), applyTitleEdit(previous, edit))
      }
      return { previous }
    },
    onError: (_error, _edit, context) => {
      if (context?.previous) queryClient.setQueryData(batchKey(batchId!), context.previous)
    },
    onSuccess: (updated, edit) => {
      queryClient.setQueryData(batchKey(updated.id), updated)
      // The server named the new Title, so this is the first moment it can be
      // selected — and a Title added is a Title about to be typed into.
      if (edit.kind === 'add') {
        const added = updated.titles[updated.titles.length - 1]
        if (added) setSelectedTitleId(added.id)
      }
    },
  })

  const styleMutation = useMutation<TitleStyle | { deleted: number }, Error, StyleAction>({
    mutationFn: (action) => {
      if (action.kind === 'save') return api.createTitleStyle({ name: action.name, ...action.look })
      if (action.kind === 'update') {
        return api.updateTitleStyle(action.style.id, {
          name: action.style.name,
          ...action.look,
        })
      }
      return api.deleteTitleStyle(action.style.id)
    },
    onSuccess: (_result, action) => {
      void queryClient.invalidateQueries({ queryKey: TITLE_STYLES_KEY })
      // Deleting a Style leaves every Title made from it looking exactly as it
      // did — the look was copied, not linked — but the label it carried is
      // gone, so the Batch is refetched to drop it (ADR 0008).
      if (action.kind === 'delete') {
        void queryClient.invalidateQueries({ queryKey: batchKey(batchId!) })
      }
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
    setSelectedTitleId(null)
    setTitlePreview(null)
    setUndoRemoval(null)
    setPlayheadMs(0)
  }, [batchId])

  // One selection at a time. A Shot and a Title are edited by different
  // inspectors, and two open at once would leave the dock arguing with itself.
  function selectShot(shotId: string | null) {
    setSelectedShotId(shotId)
    if (shotId) setSelectedTitleId(null)
  }

  function selectTitle(titleId: string | null) {
    setSelectedTitleId(titleId)
    setTitlePreview(null)
    if (titleId) setSelectedShotId(null)
  }

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
      /*
       * The editor is a fixed-height shell, not a page that scrolls: the
       * Player and the Timeline are read together — you scrub one while
       * watching the other — so neither may be pushed off the bottom by the
       * things around them. Everything that grows scrolls inside its own box.
       */
      <div className="workspace-shell workspace-shell--editor">
        {batchList}
        <main className="workspace workspace--editor">
          <header className="editor-bar">
            <div className="editor-bar__id">
              <BatchTitle batch={batch} onRename={(name) => renameMutation.mutate(name)} />
              {/* Plain text, not a control: the Format was settled when this
                  Batch was created and does not change (ADR 0006). */}
              <span className="editor-bar__meta">
                {clips.length} {clips.length === 1 ? 'clip' : 'clips'} ·{' '}
                {formatDefinition(batch.format).platform} ·{' '}
                {formatDefinition(batch.format).name} {formatDefinition(batch.format).ratio}
              </span>
            </div>
            <ExportPanel
              sequenceRender={batch.sequence_render}
              shotCount={shots.length}
              totalMs={sequenceDurationMs(shots, clips)}
              onExport={() => exportMutation.mutate()}
              starting={exportMutation.isPending}
              error={exportMutation.error}
            />
          </header>

          <div className="editor-body">
            <aside className="clip-bin">
              <ClipDropZone
                onAdd={(files) => {
                  setRejected([])
                  uploadMutation.mutate(files)
                }}
                uploading={uploadMutation.isPending}
              />

              {rejected.length > 0 && (
                <div className="toast-error" role="alert">
                  {rejected.map((message) => <p key={message}>{message}</p>)}
                </div>
              )}
              {uploadMutation.error && (
                <div className="toast-error">{uploadMutation.error.message}</div>
              )}
              {renameMutation.error && (
                <div className="toast-error">{renameMutation.error.message}</div>
              )}

              {clips.length > 0 ? (
                <ClipGrid
                  clips={clips}
                  onOpen={(clip) => navigate(clipRoute(batch.id, clip.id))}
                  onAdd={(clip) => sequenceMutation.mutate({ kind: 'add', clipId: clip.id })}
                  onDragToTimeline={(clip) => setPlacingClipId(clip.id)}
                  placedCounts={placedCounts}
                  adding={sequenceMutation.isPending}
                />
              ) : (
                <p className="batch-empty">
                  No clips yet. Add videos above and each one imports on its own — you can
                  start another batch while these run.
                  <small>MP4, MOV, M4V, WebM, MKV, or AVI · up to 25 at a time</small>
                </p>
              )}
            </aside>

            <div className="editor-view">
              <Player
                player={player}
                format={batch.format}
                titles={titles}
                fontCatalog={fontsQuery.data ?? null}
                selectedTitleId={selectedTitleId}
                titlePreview={titlePreview}
                onSelectTitle={selectTitle}
                onEditTitle={(title, patch) =>
                  titleMutation.mutate({ kind: 'patch', titleId: title.id, patch })
                }
                onTrimToPlayhead={trimToPlayhead}
                canTrim={trimTarget !== null}
              />

              {/*
               * The Title's controls sit beside the stage rather than under it.
               * A 9:16 stage in a landscape frame leaves most of its width
               * unused, so this costs the picture almost nothing — while the
               * same panel in the dock came out of the stage's *height*, which
               * is the axis a vertical Format actually needs (ADR 0007). It is
               * also the panel you are looking at the picture while using.
               */}
              {selectedTitle && (
                <TitleInspector
                  title={selectedTitle}
                  catalog={fontsQuery.data ?? null}
                  styles={titleStyles}
                  onEdit={(patch) => {
                    setTitlePreview(null)
                    titleMutation.mutate({ kind: 'patch', titleId: selectedTitle.id, patch })
                  }}
                  onPreview={(patch) =>
                    setTitlePreview(patch ? { titleId: selectedTitle.id, ...patch } : null)
                  }
                  onRemove={() => {
                    setSelectedTitleId(null)
                    titleMutation.mutate({ kind: 'remove', titleId: selectedTitle.id })
                  }}
                  onSaveStyle={(name) =>
                    styleMutation.mutate({ kind: 'save', name, look: lookOf(selectedTitle) })
                  }
                  onUpdateStyle={(style) =>
                    styleMutation.mutate({ kind: 'update', style, look: lookOf(selectedTitle) })
                  }
                  onDeleteStyle={(style) => styleMutation.mutate({ kind: 'delete', style })}
                  busy={titleMutation.isPending || styleMutation.isPending}
                />
              )}
            </div>
          </div>

          <div className="editor-dock">
            {(titleMutation.error || styleMutation.error) && (
              <div className="toast-error" role="alert">
                {(titleMutation.error ?? styleMutation.error)?.message}
              </div>
            )}

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
                      ? trimCutawayEdit(selectedCutaway, selectedClip, trim)
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

            {sequenceMutation.error && (
              <div className="toast-error" role="alert">{sequenceMutation.error.message}</div>
            )}
            <Timeline
              shots={shots}
              cutaways={cutaways}
              clips={clips}
              titles={titles}
              selectedShotId={selectedShotId}
              selectedTitleId={selectedTitleId}
              placingClipId={placingClipId}
              playheadMs={playheadMs}
              onScrub={setPlayheadMs}
              onSelect={selectShot}
              onSelectTitle={selectTitle}
              onMoveTitle={(title, span) =>
                titleMutation.mutate({ kind: 'patch', titleId: title.id, patch: span })
              }
              onTrimTitle={(title, span: TitleSpan) =>
                titleMutation.mutate({ kind: 'patch', titleId: title.id, patch: span })
              }
              onAddTitle={(atMs) => titleMutation.mutate({ kind: 'add', atMs })}
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
              onTrimCutaway={(cutaway, trim) => {
                const clip = clips.find((item) => item.id === cutaway.clip_id)
                if (clip) sequenceMutation.mutate(trimCutawayEdit(cutaway, clip, trim))
              }}
              onPlaceCutaway={(clipId, baseShotId, offsetMs) =>
                sequenceMutation.mutate({ kind: 'cover', clipId, baseShotId, offsetMs })
              }
              onPlaceEnd={() => setPlacingClipId(null)}
              busy={sequenceMutation.isPending}
            />
          </div>
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
