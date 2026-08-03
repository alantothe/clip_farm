import { useEffect } from 'react'
import type { SequencePlayer } from './useSequencePlayer'

/** Ten seconds is what J and L move in every player anyone has used. */
const JUMP_MS = 10_000

const RATES = [0.5, 1, 1.5, 2]

/**
 * Whether a key press belongs to something the operator is typing into.
 *
 * The Batch page has a name field and two number inputs, and the number inputs
 * use the arrow keys natively. A shortcut layer that did not check this would
 * make renaming a Batch impossible the moment you typed a space.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * The Player's keyboard.
 *
 * Bound to the page rather than to the Player, because focus is almost never
 * on the Player when you want it: editing means clicking the Timeline and the
 * Clip grid, and a shortcut you have to aim at first does not get used.
 *
 * The keys are the ones anyone has already learned from watching video in a
 * browser — comma and full stop step a frame, J and L jump ten seconds — and
 * not the J/K/L shuttle of an editing suite. That shuttle needs reverse
 * playback, and no browser supports a negative `playbackRate`, so J could
 * never do what someone pressing it would expect.
 */
export function usePlayerKeys({
  player,
  enabled,
  onTrimToPlayhead,
  onFullscreen,
}: {
  player: SequencePlayer
  enabled: boolean
  onTrimToPlayhead?: (edge: 'in' | 'out') => void
  onFullscreen?: () => void
}) {
  useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent) {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      // A control that has already acted on this key wins. The scrub bar is a
      // slider and owns the arrows while it holds focus; without this both it
      // and the frame step would run on one press.
      if (event.defaultPrevented) return

      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          player.setPlaying(!player.playing)
          break
        case ',':
          player.stepFrame(-1)
          break
        case '.':
          player.stepFrame(1)
          break
        case 'ArrowLeft':
          if (event.shiftKey) player.jumpCut(-1)
          else player.stepFrame(-1)
          break
        case 'ArrowRight':
          if (event.shiftKey) player.jumpCut(1)
          else player.stepFrame(1)
          break
        case 'j':
        case 'J':
          player.jumpBy(-JUMP_MS)
          break
        case 'l':
        case 'L':
          player.jumpBy(JUMP_MS)
          break
        case 'i':
        case 'I':
          onTrimToPlayhead?.('in')
          break
        case 'o':
        case 'O':
          onTrimToPlayhead?.('out')
          break
        case '[':
          player.markIn()
          break
        case ']':
          player.markOut()
          break
        case 'r':
        case 'R':
          player.setLooping(!player.looping)
          break
        case 'm':
        case 'M':
          player.setMuted(!player.muted)
          break
        case 'f':
        case 'F':
          onFullscreen?.()
          break
        case '1':
        case '2':
        case '3':
        case '4':
          player.setRate(RATES[Number(event.key) - 1])
          break
        default:
          // Everything else belongs to the page, and to the browser.
          return
      }

      // Only after a key was actually handled: space must still scroll, and
      // arrows must still move a caret, everywhere this does not apply.
      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [player, enabled, onTrimToPlayhead, onFullscreen])
}
