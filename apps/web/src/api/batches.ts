import type { Batch, BatchSummary, BatchUploadResult, SequenceRender, ShotTrim } from '../types'
import { request } from './client'

export const listBatches = () => request<BatchSummary[]>('/api/batches')

export const getBatch = (id: string) => request<Batch>(`/api/batches/${id}`)

export const createBatch = (name?: string) =>
  request<Batch>('/api/batches', {
    method: 'POST',
    body: JSON.stringify(name ? { name } : {}),
  })

export const renameBatch = (id: string, name: string) =>
  request<Batch>(`/api/batches/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })

export const deleteBatch = (id: string) =>
  request<{ deleted: number }>(`/api/batches/${id}`, { method: 'DELETE' })

// Every Sequence edit returns the whole Batch, so one response re-renders both
// the timeline and the grid that feeds it.

/**
 * Place a Clip in the Sequence.
 *
 * `position` and the trim are what undoing a removal sends, so the Shot comes
 * back where it was and trimmed as it was rather than appended fresh.
 */
export const addShot = (
  batchId: string,
  clipId: string,
  placement: { position?: number } & ShotTrim = {},
) =>
  request<Batch>(`/api/batches/${batchId}/shots`, {
    method: 'POST',
    body: JSON.stringify({ clip_id: clipId, ...placement }),
  })

export const removeShot = (batchId: string, shotId: string) =>
  request<Batch>(`/api/batches/${batchId}/shots/${shotId}`, { method: 'DELETE' })

export const moveShot = (batchId: string, shotId: string, position: number) =>
  request<Batch>(`/api/batches/${batchId}/shots/${shotId}`, {
    method: 'PATCH',
    body: JSON.stringify({ position }),
  })

/**
 * Trim a Shot on the Timeline.
 *
 * Only the edge that moved is sent: an omitted field leaves that end alone,
 * while an explicit null resets it to following the Clip's Trim.
 */
export const trimShot = (batchId: string, shotId: string, trim: ShotTrim) =>
  request<Batch>(`/api/batches/${batchId}/shots/${shotId}`, {
    method: 'PATCH',
    body: JSON.stringify(trim),
  })

/**
 * Cover a Shot with a Clip for a span.
 *
 * A Cutaway is anchored to the Shot it covers rather than to a clock time, so
 * what travels is a base shot id and an offset into it.
 */
export const addCutaway = (
  batchId: string,
  cutaway: { clip_id: string; base_shot_id: string; offset_ms: number } & ShotTrim,
) =>
  request<Batch>(`/api/batches/${batchId}/cutaways`, {
    method: 'POST',
    body: JSON.stringify(cutaway),
  })

export const updateCutaway = (
  batchId: string,
  cutawayId: string,
  patch: { base_shot_id?: string; offset_ms?: number } & ShotTrim,
) =>
  request<Batch>(`/api/batches/${batchId}/cutaways/${cutawayId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const removeCutaway = (batchId: string, cutawayId: string) =>
  request<Batch>(`/api/batches/${batchId}/cutaways/${cutawayId}`, { method: 'DELETE' })

export const renderSequence = (batchId: string) =>
  request<SequenceRender>(`/api/batches/${batchId}/render`, { method: 'POST' })

export const getSequenceRender = (batchId: string) =>
  request<SequenceRender>(`/api/batches/${batchId}/render`)

export const uploadClips = (id: string, videos: File[]) => {
  const body = new FormData()
  for (const video of videos) body.append('videos', video)
  return request<BatchUploadResult>(`/api/batches/${id}/uploads`, {
    method: 'POST',
    body,
  })
}
