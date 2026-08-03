import type { Batch, FontCatalog, TitleLook, TitlePatch, TitleStyle } from '../types'
import { request } from './client'

// A Title edit returns the whole Batch, as a Sequence edit does: the Title
// Track, the stage and the inspector all read from it, so one response settles
// every one of them.

export const addTitle = (batchId: string, title: TitlePatch) =>
  request<Batch>(`/api/batches/${batchId}/titles`, {
    method: 'POST',
    body: JSON.stringify(title),
  })

export const updateTitle = (batchId: string, titleId: string, patch: TitlePatch) =>
  request<Batch>(`/api/batches/${batchId}/titles/${titleId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const removeTitle = (batchId: string, titleId: string) =>
  request<Batch>(`/api/batches/${batchId}/titles/${titleId}`, { method: 'DELETE' })

// Styles are global rather than per-Batch: saving one is how a look reaches the
// next Batch, which is the whole point of saving it.

export const listTitleStyles = () => request<TitleStyle[]>('/api/title-styles')

export const createTitleStyle = (style: { name: string } & Partial<TitleLook>) =>
  request<TitleStyle>('/api/title-styles', {
    method: 'POST',
    body: JSON.stringify(style),
  })

export const updateTitleStyle = (
  styleId: string,
  style: { name: string } & Partial<TitleLook>,
) =>
  request<TitleStyle>(`/api/title-styles/${styleId}`, {
    method: 'PATCH',
    body: JSON.stringify(style),
  })

export const deleteTitleStyle = (styleId: string) =>
  request<{ deleted: number }>(`/api/title-styles/${styleId}`, { method: 'DELETE' })

export const getFontCatalog = () => request<FontCatalog>('/api/fonts')
