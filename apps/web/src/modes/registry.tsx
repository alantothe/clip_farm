import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * The mode library. Each entry is one focused workflow with its own crop,
 * format, and finishing tools.
 *
 * `id` matches Project.mode on the backend, so a project row can be traced
 * back to the workflow that produced it. Adding a mode means adding an entry
 * here plus its route in App.tsx — the home page needs no edit.
 */
export interface ModeDefinition {
  id: string
  /** Display number on the card, e.g. "01". */
  number: string
  route: string
  /** Split across lines so the card title wraps where it was designed to. */
  titleLines: string[]
  /** Accessible single-line name, used for the card's aria-label. */
  name: string
  blurb: string
  steps: string[]
  /** Prose description of the steps for screen readers; the step chips are terse. */
  stepsLabel: string
  visual: ReactNode
  status: 'available' | 'planned'
}

const xToVerticalVisual = (
  <span className="mode-card__visual" aria-hidden="true">
    <span className="mode-card__source">
      <span className="mode-card__x">X</span>
      <span className="mode-card__horizon"><i /><i /></span>
      <small>16:9 source</small>
    </span>
    <span className="mode-card__transfer"><ArrowRight size={23} /></span>
    <span className="mode-card__output">
      <span className="mode-card__crop"><i /><i /></span>
      <small>9:16 ready</small>
    </span>
  </span>
)

const batchProcessVisual = (
  <span className="mode-card__visual" aria-hidden="true">
    <span className="mode-card__source mode-card__source--stack">
      <span className="mode-card__stack"><i /><i /><i /></span>
      <small>Many files</small>
    </span>
    <span className="mode-card__transfer"><ArrowRight size={23} /></span>
    <span className="mode-card__output">
      <span className="mode-card__crop"><i /><i /></span>
      <small>9:16 each</small>
    </span>
  </span>
)

const coverStackVisual = (
  <span className="mode-card__visual mode-card__visual--cover-stack" aria-hidden="true">
    <span className="mode-card__photo-pile"><i /><i /><i /><i /></span>
    <span className="mode-card__transfer"><ArrowRight size={23} /></span>
    <span className="mode-card__cover-stack"><i /><i /><i /><i /></span>
  </span>
)

export const MODES: ModeDefinition[] = [
  {
    id: 'x-to-vertical',
    number: '01',
    route: '/modes/x-to-vertical',
    titleLines: ['Landscape X', 'to Vertical'],
    name: 'Landscape X to Vertical',
    blurb:
      'Take a landscape video from an X post and turn it into a polished 9:16 MP4, ready to upload to TikTok, Instagram Reels, or YouTube Shorts.',
    steps: ['Paste X link', 'Crop + caption', 'Export vertical'],
    stepsLabel: 'Workflow: paste an X link, crop and caption, export vertical',
    visual: xToVerticalVisual,
    status: 'available',
  },
  {
    id: 'batch-process',
    number: '02',
    route: '/modes/batch-process',
    titleLines: ['Batch', 'Process'],
    name: 'Batch Process',
    blurb:
      'Upload a set of videos at once and turn each into a vertical clip. Keep several batches going at the same time and work through them in any order.',
    steps: ['Start a batch', 'Drop in videos', 'Edit each clip'],
    stepsLabel: 'Workflow: start a batch, drop in videos, edit each clip',
    visual: batchProcessVisual,
    status: 'available',
  },
  {
    id: 'cover-stack',
    number: '03',
    route: '/modes/cover-stack',
    titleLines: ['Four-photo', 'Cover'],
    name: 'Four-photo Instagram Cover',
    blurb:
      'Stack four photos into an exact 1080 × 1920 Instagram cover. Zoom and position each strip independently, then download the finished image.',
    steps: ['Choose 4 photos', 'Frame each strip', 'Download cover'],
    stepsLabel: 'Workflow: choose four photos, frame each strip, download the cover',
    visual: coverStackVisual,
    status: 'available',
  },
]

export const availableModes = (): ModeDefinition[] =>
  MODES.filter((mode) => mode.status === 'available')

/** Zero-padded count for the "Mode library · NN available" eyebrow. */
export const availableModeCount = (): string =>
  String(availableModes().length).padStart(2, '0')
