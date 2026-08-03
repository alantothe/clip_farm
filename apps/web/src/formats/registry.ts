import type { Format } from '../types'

/**
 * The Formats a Batch can be created in.
 *
 * A Format is the *shape* of the finished video and nothing else. `platform`
 * here is a signpost for the operator — "this is the shape Reels wants" — and
 * is deliberately not part of the stored value: Instagram is a Platform, and
 * lives in `platform_accounts` and `publications`. Folding it into the Format
 * would mean a second Format for an identical 1080x1920 render the day a
 * second Platform wants one, which is the compound `mode` string ADR 0001
 * removed (ADR 0006).
 *
 * Adding a Format means an entry here, the matching value in `Format`, and the
 * renderer learning the shape — the creation dialog needs no edit.
 */
export interface FormatDefinition {
  id: Format
  /** What the operator picks: "Vertical". */
  name: string
  /** Where a video of this shape is meant to go. Signpost only. */
  platform: string
  /** The surface on that Platform, e.g. "Reels". */
  surface: string
  ratio: string
  width: number
  height: number
  blurb: string
}

export const FORMATS: FormatDefinition[] = [
  {
    id: 'vertical',
    name: 'Vertical',
    platform: 'Instagram',
    surface: 'Reels',
    ratio: '9:16',
    width: 1080,
    height: 1920,
    blurb: 'Full-screen vertical video, the shape Reels is built around.',
  },
]

export const DEFAULT_FORMAT: Format = 'vertical'

export const formatDefinition = (id: Format): FormatDefinition =>
  FORMATS.find((format) => format.id === id) ?? FORMATS[0]

/** Width divided by height — what the Player sizes its stage by. */
export const formatAspectRatio = (id: Format): number => {
  const { width, height } = formatDefinition(id)
  return width / height
}
