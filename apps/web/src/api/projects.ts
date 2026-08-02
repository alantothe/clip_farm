import type { CaptionSegment, ImageOverlay, Job, Project, ProjectSettings } from '../types'
import { request } from './client'

export const listProjects = () => request<Project[]>('/api/projects')

export const getProject = (id: string) => request<Project>(`/api/projects/${id}`)

export const deleteProject = (id: string) =>
  request<{ deleted: number }>(`/api/projects/${id}`, { method: 'DELETE' })

export const deleteAllProjects = () =>
  request<{ deleted: number }>('/api/projects', { method: 'DELETE' })

export const importProject = (url: string) =>
  request<Project>('/api/projects/import', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })

export const updateProject = (id: string, settings: Partial<ProjectSettings>) =>
  request<Project>(`/api/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(settings),
  })

export const updateCaptions = (id: string, segments: CaptionSegment[]) =>
  request<Project>(`/api/projects/${id}/captions`, {
    method: 'PUT',
    body: JSON.stringify({
      segments: segments.map(({ id: segmentId, text, start_ms, end_ms }) => ({
        id: segmentId,
        text,
        start_ms,
        end_ms,
      })),
    }),
  })

export const updateSocialCaption = (id: string, text: string) =>
  request<Project>(`/api/projects/${id}/social-caption`, {
    method: 'PUT',
    body: JSON.stringify({ text }),
  })

export const rewriteSocialCaption = (id: string, text: string) =>
  request<{ text: string }>(`/api/projects/${id}/social-caption/rewrite`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })

export const uploadImageOverlay = (id: string, image: File, startMs: number) => {
  const body = new FormData()
  body.append('image', image)
  body.append('start_ms', String(Math.round(startMs)))
  return request<ImageOverlay>(`/api/projects/${id}/image-overlays`, {
    method: 'POST',
    body,
  })
}

export const updateImageOverlay = (projectId: string, overlay: ImageOverlay) =>
  request<ImageOverlay>(`/api/projects/${projectId}/image-overlays/${overlay.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      start_ms: overlay.start_ms,
      end_ms: overlay.end_ms,
      center_x: overlay.center_x,
      center_y: overlay.center_y,
      width_percent: overlay.width_percent,
      rotation_deg: overlay.rotation_deg,
      opacity: overlay.opacity,
    }),
  })

export const deleteImageOverlay = (projectId: string, overlayId: string) =>
  request<{ deleted: number }>(`/api/projects/${projectId}/image-overlays/${overlayId}`, {
    method: 'DELETE',
  })

export const transcribe = (id: string) =>
  request<Job>(`/api/projects/${id}/transcribe`, { method: 'POST' })

export const render = (id: string) => request<Job>(`/api/projects/${id}/render`, { method: 'POST' })
