import type { Job } from '../types'
import { request } from './client'

export const getJob = (id: string) => request<Job>(`/api/jobs/${id}`)
