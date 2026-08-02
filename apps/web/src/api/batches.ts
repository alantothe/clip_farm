import type { Batch, BatchSummary, BatchUploadResult } from '../types'
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

export const uploadClips = (id: string, videos: File[]) => {
  const body = new FormData()
  for (const video of videos) body.append('videos', video)
  return request<BatchUploadResult>(`/api/batches/${id}/uploads`, {
    method: 'POST',
    body,
  })
}
