import type { PlatformConnection } from '../types'
import { API_BASE, request } from './client'

export const listPlatformConnections = () => request<PlatformConnection[]>('/api/platforms')

export const platformConnectUrl = (platform: string) =>
  `${API_BASE}/api/platforms/${platform}/connect`

export const disconnectInstagram = () =>
  request<{ deleted: number }>('/api/platforms/instagram', { method: 'DELETE' })
