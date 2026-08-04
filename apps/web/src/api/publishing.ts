import type { Job, PublishOptions, SequencePublication } from '../types'
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

/** Rewrite a Caption that has no row of its own yet, like a Batch's. */
export const rewriteCaption = (text: string) =>
  request<{ text: string }>('/api/captions/rewrite', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })

/**
 * Posting a Batch's export, one Platform per call.
 *
 * Picking three destinations is three requests, not one: each Platform gets its
 * own row, its own progress, and its own retry, so a TikTok failure does not
 * un-post the Instagram Reel that already went out (ADR 0012).
 */
export const publishSequence = (
  batchId: string,
  platform: string,
  caption: string,
  options: PublishOptions,
) =>
  request<SequencePublication>(`/api/batches/${batchId}/publish/${platform}`, {
    method: 'POST',
    body: JSON.stringify({ caption, options }),
  })
