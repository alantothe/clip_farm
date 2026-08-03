import '@testing-library/jest-dom/vitest'

/**
 * A media element jsdom can live with.
 *
 * jsdom implements no `HTMLMediaElement` behaviour at all: `play()` and
 * `pause()` throw "Not implemented", and `duration` is always `NaN`. Every
 * `<video>` the Player mounts therefore printed a stack trace into the test
 * output, and nothing about playback could be asserted — which is where the
 * one bug 59 tests missed was living.
 *
 * This is deliberately the smallest thing that makes playback observable: the
 * element remembers whether it is playing, and `duration` can be set per test
 * so a Shot can be driven to its end. It does not simulate a clock — a test
 * moves `currentTime` itself and fires `timeupdate`, which is what the real
 * element does anyway.
 */
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  writable: true,
  value(this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false })
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  },
})

Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  writable: true,
  value(this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true })
    this.dispatchEvent(new Event('pause'))
  },
})

Object.defineProperty(HTMLMediaElement.prototype, 'load', {
  configurable: true,
  writable: true,
  value() {},
})

// Writable so a test can say how long the media is. Left alone it stays NaN,
// which is the value `shotIsOver` reads as "the media has no opinion".
Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
  configurable: true,
  get(this: HTMLMediaElement & { _duration?: number }) {
    return this._duration ?? NaN
  },
  set(this: HTMLMediaElement & { _duration?: number }, value: number) {
    this._duration = value
  },
})
