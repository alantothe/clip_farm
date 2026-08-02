import type { Job } from '../types'
import { request } from './client'

/**
 * The API route is /renders/{id}/publish/{platform}, so every destination the
 * backend registers a publisher for is reachable without a new client method.
 */
export const publish = (renderId: string, platform: string, caption: string, shareToFeed: boolean) =>
  request<Job>(`/api/renders/${renderId}/publish/${platform}`, {
    method: 'POST',
    body: JSON.stringify({ caption, share_to_feed: shareToFeed }),
  })

export const publishInstagram = (renderId: string, caption: string, shareToFeed: boolean) =>
  publish(renderId, 'instagram', caption, shareToFeed)
