import { Check, LoaderCircle, X } from 'lucide-react'
import type { Job } from '../types'

export function JobBanner({ job }: { job: Job }) {
  return (
    <div className={`job-banner job-banner--${job.status}`}>
      <div className="job-banner__icon">
        {job.status === 'complete' ? <Check size={18} /> : job.status === 'failed' ? <X size={18} /> : <LoaderCircle className="spin" size={18} />}
      </div>
      <div>
        <strong>{job.message}</strong>
        {job.error_message && <span>{job.error_message}</span>}
      </div>
      <div className="job-progress"><i style={{ width: `${job.progress}%` }} /></div>
      <output>{job.progress}%</output>
    </div>
  )
}
