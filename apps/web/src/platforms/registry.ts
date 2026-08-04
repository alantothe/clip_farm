/**
 * The Platforms a Sequence Render can be published to.
 *
 * A destination is listed here whether or not Clip Farm can post to it yet, so
 * the publish dialog can show the whole shelf and say plainly which doors are
 * open. `ready` tracks the backend: a Platform is ready once a Publisher is
 * registered for it, and until then picking it would only earn a 404.
 *
 * Adding a destination means an entry here, a Publisher on the API side, and
 * whatever settings that Platform wants in `PublishOptions` — the dialog's
 * shape does not change (ADR 0012).
 */
export interface PlatformDefinition {
  /** The value the API knows it by, e.g. `instagram`. */
  id: string
  name: string
  /** The surface a video lands on there, e.g. "Reels". */
  surface: string
  blurb: string
  /** Whether Clip Farm can post to it today. */
  ready: boolean
}

export const PLATFORMS: PlatformDefinition[] = [
  {
    id: 'instagram',
    name: 'Instagram',
    surface: 'Reels',
    blurb: 'Vertical video, 3 seconds to 15 minutes.',
    ready: true,
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    surface: 'Post',
    blurb: 'Not wired up yet.',
    ready: false,
  },
  {
    id: 'youtube',
    name: 'YouTube',
    surface: 'Shorts',
    blurb: 'Not wired up yet.',
    ready: false,
  },
]

export const platformDefinition = (id: string): PlatformDefinition =>
  PLATFORMS.find((platform) => platform.id === id) ?? {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    surface: '',
    blurb: '',
    ready: false,
  }
