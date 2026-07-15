export type Layout = 'smart_crop' | 'fit_background'
export type CaptionStyle = 'bold' | 'classic' | 'minimal'

export interface Artifact {
  id: string
  kind: string
  mime_type: string
  size_bytes: number
  url: string | null
}

export interface CaptionSegment {
  id: string
  sequence: number
  start_ms: number
  end_ms: number
  text: string
  edited: boolean
}

export interface Render {
  id: string
  status: string
  size_bytes: number | null
  duration_ms: number | null
  layout: Layout
  error_message: string | null
  created_at: string
  download_url: string | null
}

export interface Project {
  id: string
  source_url: string
  source_post_id: string
  title: string
  status: string
  transcription_status: string
  error_message: string | null
  duration_ms: number | null
  width: number | null
  height: number | null
  fps: number | null
  trim_start_ms: number
  trim_end_ms: number | null
  layout: Layout
  crop_center_x: number
  captions_enabled: boolean
  caption_style: CaptionStyle
  created_at: string
  updated_at: string
  artifacts: Artifact[]
  captions: CaptionSegment[]
  renders: Render[]
}

export interface Job {
  id: string
  project_id: string
  render_id: string | null
  kind: string
  status: string
  progress: number
  message: string
  attempts: number
  error_message: string | null
  created_at: string
}

export interface ProjectSettings {
  trim_start_ms: number
  trim_end_ms: number
  layout: Layout
  crop_center_x: number
  captions_enabled: boolean
  caption_style: CaptionStyle
}

