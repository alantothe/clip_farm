import type { CSSProperties } from 'react'
import { API_BASE } from '../api'
import type { FontCatalog, FontFace as CatalogFace, Title, TitleLook } from '../types'

/**
 * Drawing a Title on the stage the way the export will burn it in.
 *
 * This module is the browser half of an agreement with `create_ass_titles`.
 * Both work in the same units — a percent of the frame for anything measured
 * against it, a fraction of the font size for anything that scales with the
 * type — so neither has to know the other's pixel dimensions (ADR 0008).
 *
 * That is why nothing here measures the stage. Sizes are written in container
 * query units, so `font_size_percent: 6` becomes `6cqh`, which is 6% of the
 * stage's height whatever size the stage happens to be — the same 6% of 1920
 * the renderer uses. A resized window, a fullscreen stage and the finished file
 * all land in the same place without a ResizeObserver in the path.
 */

/** The CSS family name a vendored face is registered under. */
export const faceFamily = (faceId: string) => `cf-${faceId}`

/**
 * The one vendored file a family-and-weight choice means.
 *
 * The same nearest-weight rule the server applies, so the stage never shows a
 * weight the export cannot produce — Bebas Neue asked for at 900 is its single
 * 400 face on both sides.
 */
export function resolveFace(
  catalog: FontCatalog | null,
  family: string,
  weight: number,
): CatalogFace | null {
  if (!catalog) return null
  const faces = catalog.faces.filter((face) => face.family === family)
  const candidates = faces.length
    ? faces
    : catalog.faces.filter((face) => face.family === 'inter')
  if (!candidates.length) return null
  return candidates.reduce((best, face) =>
    Math.abs(face.weight - weight) < Math.abs(best.weight - weight) ? face : best,
  )
}

const loaded = new Map<string, Promise<void>>()

/**
 * Load one vendored face into the document, once.
 *
 * The browser fetches the same TTF the renderer opens, rather than a webfont
 * from a CDN: a face that failed to load would fall back silently and show the
 * operator a Title that is not the one being exported.
 */
export function loadFace(face: CatalogFace): Promise<void> {
  const cached = loaded.get(face.id)
  if (cached) return cached
  // jsdom has no FontFace, and the tests do not depend on one.
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve()
  }
  const url = `${API_BASE}${face.url}`
  const font = new FontFace(faceFamily(face.id), `url("${url}")`)
  const pending = font
    .load()
    .then((ready) => {
      document.fonts.add(ready)
    })
    .catch(() => {
      // Leave the fallback in place rather than breaking the editor. The
      // catalog came from the same server as the file, so this is a transport
      // failure, not a missing face.
      loaded.delete(face.id)
    })
  loaded.set(face.id, pending)
  return pending
}

/** `#RRGGBB` at an opacity, as CSS wants it. */
export function rgba(hex: string, opacity: number): string {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16))
  return `rgba(${channels.join(', ')}, ${opacity})`
}

/** Whether a Title is on screen at a point in the Sequence. */
export const titleIsVisible = (title: Title, ms: number) =>
  ms >= title.start_ms && ms < title.end_ms

export type TitleCss = { box: CSSProperties; text: CSSProperties }

/**
 * A Title as two CSS rules: the box it wraps inside, and the text itself.
 *
 * The split is not cosmetic. `background` has to sit on an inline text span
 * with `box-decoration-break: clone` so it hugs each line the way libass's
 * opaque box does, rather than filling the whole wrap box — a block-level
 * background would draw a panel the export never produces.
 */
export function titleCss(look: TitleLook, face: CatalogFace | null): TitleCss {
  const boxed = look.background === 'box'
  const box: CSSProperties = {
    left: `${look.center_x}%`,
    top: `${look.center_y}%`,
    width: `${look.width_percent}cqw`,
    transform: `translate(-50%, -50%) rotate(${look.rotation_deg}deg)`,
    fontSize: `${look.font_size_percent}cqh`,
    fontFamily: face ? `"${faceFamily(face.id)}", sans-serif` : 'sans-serif',
    fontStyle: look.italic ? 'italic' : 'normal',
    textAlign: look.align,
    // The vendored file already *is* the weight; asking for another would only
    // invite the browser to synthesise a bolder one on top of it.
    fontWeight: 400,
  }

  const text: CSSProperties = {
    color: rgba(look.color, look.opacity),
    letterSpacing: `${look.letter_spacing}em`,
    textTransform: look.uppercase ? 'uppercase' : 'none',
  }

  if (!boxed && look.outline_width > 0) {
    // ASS draws its outline outward from the glyph; a CSS text stroke straddles
    // the path, half of it inside. Doubling the width and painting the stroke
    // behind the fill leaves exactly the outward half showing.
    text.WebkitTextStrokeWidth = `${look.outline_width * 2}em`
    text.WebkitTextStrokeColor = rgba(look.outline_color, look.opacity)
    text.paintOrder = 'stroke fill'
  }
  if (look.shadow_offset > 0) {
    const offset = `${look.shadow_offset}em`
    text.textShadow = `${offset} ${offset} 0 ${rgba(look.shadow_color, look.opacity)}`
  }
  if (boxed) {
    text.background = rgba(look.background_color, look.background_opacity)
    text.padding = `${look.background_padding * 0.4}em ${look.background_padding}em`
    text.boxDecorationBreak = 'clone'
    text.WebkitBoxDecorationBreak = 'clone'
  }
  return { box, text }
}
