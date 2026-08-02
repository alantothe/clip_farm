import { api } from '../api'
import type { Project } from '../types'

export function artifact(project: Project, kind: string): string {
  return api.mediaUrl(project.artifacts.find((item) => item.kind === kind)?.url ?? null)
}

export function projectIsBusy(project: Project): boolean {
  return ['queued', 'processing'].includes(project.status)
    || Boolean(project.latest_job && ['queued', 'running'].includes(project.latest_job.status))
}
