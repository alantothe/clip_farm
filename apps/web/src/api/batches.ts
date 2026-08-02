import type { Batch, BatchSummary, BatchUploadResult, SequenceRender } from '../types'
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

export const addShot = (batchId: string, clipId: string) =>
  request<Batch>(`/api/batches/${batchId}/shots`, {
    method: 'POST',
    body: JSON.stringify({ clip_id: clipId }),
  })

export const removeShot = (batchId: string, shotId: string) =>
  request<Batch>(`/api/batches/${batchId}/shots/${shotId}`, { method: 'DELETE' })

export const moveShot = (batchId: string, shotId: string, position: number) =>
  request<Batch>(`/api/batches/${batchId}/shots/${shotId}`, {
    method: 'PATCH',
    body: JSON.stringify({ position }),
  })

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
