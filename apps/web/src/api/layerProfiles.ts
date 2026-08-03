import type { Batch, LayerProfile } from '../types'
import { request } from './client'

export const listLayerProfiles = () => request<LayerProfile[]>('/api/layer-profiles')

export const createLayerProfile = (
  batchId: string,
  profile: { name: string; title_ids: string[]; media_ids: string[] },
) =>
  request<LayerProfile>(`/api/batches/${batchId}/layer-profiles`, {
    method: 'POST',
    body: JSON.stringify(profile),
  })

export const applyLayerProfile = (batchId: string, profileId: string) =>
  request<Batch>(`/api/batches/${batchId}/layer-profiles/${profileId}/apply`, {
    method: 'POST',
  })

export const deleteLayerProfile = (profileId: string) =>
  request<{ deleted: number }>(`/api/layer-profiles/${profileId}`, { method: 'DELETE' })
