export type Layout = 'smart_crop' | 'fit_background'
export type CaptionStyle = 'bold' | 'classic' | 'minimal'
export type CaptionPosition = 'top' | 'middle' | 'bottom'
/**
 * The shape of the finished video. The stored value is the shape alone —
 * Instagram is a Platform, not part of a Format (ADR 0006).
 */
export type Format = 'vertical'

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

/** A Shot's picture placement inside the finished Format. */
export interface ShotFraming {
  frame_zoom: number
  frame_center_x: number
  frame_center_y: number
}

/** One Clip's placement in a Sequence. The Clip itself is in `Batch.clips`. */
export interface Shot extends ShotFraming {
  id: string
  clip_id: string
  position: number
  /** Null means this Shot plays its Clip's Trim rather than one of its own. */
  trim_start_ms: number | null
  trim_end_ms: number | null
}

/**
 * A Shot that covers another for a span, showing its picture while the covered
 * Shot's audio keeps playing. It is a Shot too, so it carries a Trim the same
 * way — but it sits at an offset into its Base Shot rather than in the running
 * order, which is why it travels apart from `shots`.
 */
export interface Cutaway extends ShotFraming {
  id: string
  clip_id: string
  base_shot_id: string
  offset_ms: number
  trim_start_ms: number | null
  trim_end_ms: number | null
}

export type TitleAlign = 'left' | 'center' | 'right'
/** How a Title is set off from the picture: outlined glyphs, or a filled panel. */
export type TitleBackground = 'none' | 'box'

/**
 * A Title's look and placement — everything about it but its words and timing.
 *
 * Sizes that scale with the type are fractions of the font size, and everything
 * measured against the frame is a percent of it, so the same numbers drive the
 * stage and the export (ADR 0008).
 */
export interface TitleLook {
  /** A family id from the font catalog, not a face name. */
  font_family: string
  font_weight: number
  italic: boolean
  uppercase: boolean
  /** A percent of the frame's height. */
  font_size_percent: number
  /** Tracking, as a fraction of the font size. */
  letter_spacing: number
  color: string
  opacity: number
  align: TitleAlign
  outline_color: string
  /** A fraction of the font size. Zero is no outline. */
  outline_width: number
  shadow_color: string
  shadow_offset: number
  background: TitleBackground
  background_color: string
  background_opacity: number
  background_padding: number
  center_x: number
  center_y: number
  /** How wide the text may run before it wraps, as a percent of the frame. */
  width_percent: number
  rotation_deg: number
}

/**
 * Text drawn over the picture for a span of a Batch's Sequence.
 *
 * Its times are Sequence milliseconds, not an offset into a Shot: reordering
 * the Sequence moves the Shots underneath and leaves the Title where it was
 * written (ADR 0008).
 */
export interface Title extends TitleLook {
  id: string
  batch_id: string
  text: string
  start_ms: number
  end_ms: number
  /** Which Style this look came from, for its label. Not a live link. */
  style_id: string | null
}

/** A saved look a Title can be made from, reusable across every Batch. */
export interface TitleStyle extends TitleLook {
  id: string
  name: string
  /** Clip Farm's own, which cannot be edited or deleted. */
  builtin: boolean
}

/**
 * Words saved whole — the text with its look and its place — to write again.
 *
 * A Style saves the look without the words; a Phrase saves both. It has no
 * name because the words are the label, and no timing because where it lands
 * in a Sequence is a fact about that Sequence (ADR 0008).
 */
export interface Phrase extends TitleLook {
  id: string
  text: string
}

/** What a Title edit sends: only what changed. */
export type TitlePatch = Partial<TitleLook> &
  Partial<{ text: string; start_ms: number; end_ms: number; style_id: string }>

export interface FontFamily {
  id: string
  name: string
  category: string
  /** Only the weights actually vendored, so the picker offers no near misses. */
  weights: number[]
}

export interface FontFace {
  id: string
  family: string
  weight: number
  weight_label: string
  file: string
  url: string
}

export interface FontCatalog {
  families: FontFamily[]
  faces: FontFace[]
}

/** What a trim drag sends: only the edge that moved, so the other stays as it was. */
export type ShotTrim = Partial<{
  trim_start_ms: number | null
  trim_end_ms: number | null
}>

/** The finished video a Sequence produces: every Shot in order, joined. */
export interface SequenceRender {
  id: string
  batch_id: string
  status: 'queued' | 'running' | 'complete' | 'failed'
  progress: number
  message: string
  size_bytes: number | null
  duration_ms: number | null
  shot_count: number
  error_message: string | null
  created_at: string
  completed_at: string | null
  download_url: string | null
}

/** A named set of Clips imported and worked on together. */
export interface Batch {
  id: string
  name: string
  /** Fixed when the Batch is created and never edited afterwards (ADR 0006). */
  format: Format
  created_at: string
  updated_at: string
  clips: Project[]
  /** The Sequence, in play order. A Clip can be in a Batch without a Shot. */
  shots: Shot[]
  /** Cutaways are not in the running order — each covers a Shot at an offset. */
  cutaways: Cutaway[]
  /** Timed against the Sequence, and owned by the Batch rather than a Clip. */
  titles: Title[]
  sequence_render: SequenceRender | null
}

/** A Batch without its Clips, for the list that picks between Batches. */
export interface BatchSummary {
  id: string
  name: string
  format: Format
  created_at: string
  updated_at: string
  clip_count: number
  importing_count: number
  failed_count: number
  shot_count: number
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
