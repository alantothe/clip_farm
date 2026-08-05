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

/**
 * `replace` clears the layers a previous apply left on this Batch; `add`
 * writes alongside them. Layers made by hand survive either way (ADR 0013).
 */
export const applyLayerProfile = (
  batchId: string,
  profileId: string,
  mode: 'add' | 'replace' = 'add',
) =>
  request<Batch>(`/api/batches/${batchId}/layer-profiles/${profileId}/apply`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  })

export const deleteLayerProfile = (profileId: string) =>
  request<{ deleted: number }>(`/api/layer-profiles/${profileId}`, { method: 'DELETE' })
