export type Layout = 'smart_crop' | 'fit_background'
export type CaptionStyle = 'bold' | 'classic' | 'minimal'
export type CaptionPosition = 'top' | 'middle' | 'bottom'

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

export interface ImageOverlay {
  id: string
  name: string
  start_ms: number
  end_ms: number
  center_x: number
  center_y: number
  width_percent: number
  rotation_deg: number
  opacity: number
  mime_type: string
  size_bytes: number
  url: string
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
  publications?: Publication[]
}

export interface Publication {
  id: string
  job_id: string | null
  platform: string
  status: 'queued' | 'processing' | 'publishing' | 'complete' | 'failed'
  share_to_feed: boolean
  remote_media_id: string | null
  permalink: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

export type OriginKind = 'x' | 'upload'

export interface Project {
  id: string
  mode: string
  origin_kind: OriginKind
  /** Null unless the Clip belongs to a Batch. */
  batch_id: string | null
  /** Null for uploads, which have no Origin URL. */
  source_url: string | null
  source_post_id: string | null
  title: string
  source_caption: string | null
  social_caption: string | null
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
  caption_position: CaptionPosition
  created_at: string
  updated_at: string
  artifacts: Artifact[]
  captions: CaptionSegment[]
  image_overlays: ImageOverlay[]
  renders: Render[]
  latest_job: Job | null
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
  started_at: string | null
  completed_at: string | null
}

/** A named set of Clips imported and worked on together. */
export interface Batch {
  id: string
  name: string
  created_at: string
  updated_at: string
  clips: Project[]
}

/** A Batch without its Clips, for the list that picks between Batches. */
export interface BatchSummary {
  id: string
  name: string
  created_at: string
  updated_at: string
  clip_count: number
  importing_count: number
  failed_count: number
}

export interface BatchUploadResult {
  batch: Batch
  accepted: number
  /** One message per file that could not become a Clip. */
  rejected: string[]
}

export interface ProjectSettings {
  trim_start_ms: number
  trim_end_ms: number
  layout: Layout
  crop_center_x: number
  captions_enabled: boolean
  caption_style: CaptionStyle
  caption_position: CaptionPosition
}

export interface ConnectedAccount {
  id: string
  platform: string
  remote_user_id: string
  username: string
  display_name: string | null
  scopes: string[]
  status: string
  token_expires_at: string | null
  connected_at: string
  updated_at: string
}

export interface PlatformConnection {
  platform: string
  display_name: string
  configured: boolean
  missing_configuration: string[]
  account: ConnectedAccount | null
}
