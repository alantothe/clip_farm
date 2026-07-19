import type { CaptionSegment, ImageOverlay, Job, PlatformConnection, Project, ProjectSettings } from './types'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(!isFormData && init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const detail = payload?.detail
    const message = typeof detail === 'string' ? detail : detail?.message
    throw new Error(message ?? `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export const api = {
  listPlatformConnections: () => request<PlatformConnection[]>('/api/platforms'),
  platformConnectUrl: (platform: string) => `${API_BASE}/api/platforms/${platform}/connect`,
  disconnectInstagram: () =>
    request<{ deleted: number }>('/api/platforms/instagram', { method: 'DELETE' }),
  listProjects: () => request<Project[]>('/api/projects'),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  deleteProject: (id: string) =>
    request<{ deleted: number }>(`/api/projects/${id}`, { method: 'DELETE' }),
  deleteAllProjects: () =>
    request<{ deleted: number }>('/api/projects', { method: 'DELETE' }),
  importProject: (url: string) =>
    request<Project>('/api/projects/import', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  updateProject: (id: string, settings: Partial<ProjectSettings>) =>
    request<Project>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(settings),
    }),
  updateCaptions: (id: string, segments: CaptionSegment[]) =>
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
    }),
  updateSocialCaption: (id: string, text: string) =>
    request<Project>(`/api/projects/${id}/social-caption`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    }),
  rewriteSocialCaption: (id: string, text: string) =>
    request<{ text: string }>(`/api/projects/${id}/social-caption/rewrite`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  uploadImageOverlay: (id: string, image: File, startMs: number) => {
    const body = new FormData()
    body.append('image', image)
    body.append('start_ms', String(Math.round(startMs)))
    return request<ImageOverlay>(`/api/projects/${id}/image-overlays`, {
      method: 'POST',
      body,
    })
  },
  updateImageOverlay: (projectId: string, overlay: ImageOverlay) =>
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
    }),
  deleteImageOverlay: (projectId: string, overlayId: string) =>
    request<{ deleted: number }>(`/api/projects/${projectId}/image-overlays/${overlayId}`, {
      method: 'DELETE',
    }),
  transcribe: (id: string) => request<Job>(`/api/projects/${id}/transcribe`, { method: 'POST' }),
  render: (id: string) => request<Job>(`/api/projects/${id}/render`, { method: 'POST' }),
  publishInstagram: (renderId: string, caption: string, shareToFeed: boolean) =>
    request<Job>(`/api/renders/${renderId}/publish/instagram`, {
      method: 'POST',
      body: JSON.stringify({ caption, share_to_feed: shareToFeed }),
    }),
  getJob: (id: string) => request<Job>(`/api/jobs/${id}`),
  mediaUrl: (path: string | null) => (path ? `${API_BASE}${path}` : ''),
}
