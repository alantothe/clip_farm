import type { Batch, BatchMediaPatch } from '../types'
import { request } from './client'

export const uploadBatchMedia = (batchId: string, image: File, endMs: number) => {
  const body = new FormData()
  body.append('image', image)
  body.append('end_ms', String(Math.round(endMs)))
  return request<Batch>(`/api/batches/${batchId}/media`, { method: 'POST', body })
}

export const addStoredBatchMedia = (
  batchId: string,
  storageImageId: string,
  endMs: number,
) =>
  request<Batch>(`/api/batches/${batchId}/media/from-storage`, {
    method: 'POST',
    body: JSON.stringify({ storage_image_id: storageImageId, end_ms: Math.round(endMs) }),
  })

export const updateBatchMedia = (
  batchId: string,
  mediaId: string,
  patch: BatchMediaPatch,
) =>
  request<Batch>(`/api/batches/${batchId}/media/${mediaId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const removeBatchMedia = (batchId: string, mediaId: string) =>
  request<Batch>(`/api/batches/${batchId}/media/${mediaId}`, { method: 'DELETE' })
