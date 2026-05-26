/**
 * Cross-platform haptic feedback for nav taps.
 *
 * Android Chrome + most desktop browsers expose `navigator.vibrate`,
 * which the AppShell already wires up globally on pointerdown. But
 * iOS / iPadOS Safari (and the iPad Pro with Magic Keyboard) have
 * NO web-haptics API — `navigator.vibrate` is a no-op, and there's
 * no way to drive the Taptic Engine from the browser. To give the
 * user *some* "I tapped something" confirmation, this module plays
 * a very brief, low-volume Web Audio click instead. The audio cue
 * is short enough (~30ms, 800 Hz square wave with a sharp envelope)
 * to read as a tactile-like click rather than a tone.
 *
 * Usage: attach to `onClick` (or `onMouseDown`) on the elements you
 * specifically want acknowledged — typically nav, top-level chrome.
 * Don't blanket-apply or every form click becomes a soundboard.
 */

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (audioContext) return audioContext
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctor) return null
    audioContext = new Ctor()
  } catch {
    return null
  }
  return audioContext
}

/**
 * Fire a short tactile-feeling click. Tries vibrate first (Android),
 * then falls back to a Web Audio click (iPad / iPadOS / desktop).
 *
 * Safe to call on every tap — bails silently if no API is available
 * or the user hasn't yet unlocked AudioContext.
 */
export function triggerHaptic(): void {
  // 1) Native vibrate — Android Chrome, some desktop browsers.
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      const ok = navigator.vibrate(10)
      // If vibrate returned a truthy value, the device actually
      // buzzed — no need for the audio click on top of it.
      if (ok) return
    }
  } catch {
    // ignore; fall through to audio click
  }

  // 2) Web Audio click — iPadOS / desktop fallback.
  const ctx = getAudioContext()
  if (!ctx) return
  // iOS gates AudioContext until a user gesture unlocks it. The
  // click handler IS a user gesture, so resume() will succeed.
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  try {
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = 880
    // Sharp attack + quick decay so it reads as a tick, not a tone.
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.04)
  } catch {
    // Some browsers/iframes block audio entirely — silent fail.
  }
}
