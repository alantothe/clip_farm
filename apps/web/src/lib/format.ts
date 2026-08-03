export function formatTime(ms: number | null | undefined): string {
  if (ms == null) return '00:00.0'
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  const tenths = Math.floor((ms % 1000) / 100)
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${tenths}`
}

/** A compact editor clock: minutes, seconds, then the frame within that second. */
export function formatTimecode(
  ms: number | null | undefined,
  fps: number | null | undefined = 30,
): string {
  const safeMs = Math.max(0, ms ?? 0)
  const safeFps = Math.max(1, fps ?? 30)
  const nominalFps = Math.max(1, Math.round(safeFps))
  const minutes = Math.floor(safeMs / 60_000)
  const seconds = Math.floor((safeMs % 60_000) / 1000)
  const frames = Math.min(
    nominalFps - 1,
    Math.floor(((safeMs % 1000) / 1000) * safeFps),
  )
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}:${frames.toString().padStart(2, '0')}`
}

export function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
