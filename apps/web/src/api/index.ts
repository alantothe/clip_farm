import { mediaUrl } from './client'
import * as jobs from './jobs'
import * as platforms from './platforms'
import * as projects from './projects'
import * as publishing from './publishing'

export { API_BASE, mediaUrl, request } from './client'
export * as jobsApi from './jobs'
export * as platformsApi from './platforms'
export * as projectsApi from './projects'
export * as publishingApi from './publishing'

/**
 * Flat aggregate kept so call sites read `api.listProjects()` regardless of
 * which module a call actually lives in.
 */
export const api = {
  ...platforms,
  ...projects,
  ...publishing,
  ...jobs,
  mediaUrl,
}
