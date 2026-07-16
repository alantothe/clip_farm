import type { CaptionSegment, Job, Project, ProjectSettings } from './types'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.detail ?? `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export const api = {
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
  transcribe: (id: string) => request<Job>(`/api/projects/${id}/transcribe`, { method: 'POST' }),
  render: (id: string) => request<Job>(`/api/projects/${id}/render`, { method: 'POST' }),
  getJob: (id: string) => request<Job>(`/api/jobs/${id}`),
  mediaUrl: (path: string | null) => (path ? `${API_BASE}${path}` : ''),
}
