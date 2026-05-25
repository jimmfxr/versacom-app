// Shared starting-ID parser used by the Equipment + Radio bulk-add
// flows. Returns a generator that produces the i-th name in the
// sequence (i = 0 is the starting name).
//
// Three trailing patterns are recognised, in order:
//   1. Dotted-integer suffix — "MIC.001", "A 4.01". Increments the
//      digits AFTER the last dot, preserving zero-padding. The piece
//      before the dot never carries — `A 4.99` → `A 4.100`,
//      NOT `A 5.00`.
//   2. Plain integer suffix — "PNL 1", "P001", "100". Increments the
//      trailing digits, preserving zero-padding.
//   3. Letter suffix — "A", "FOH A", "Z". Bijective base-26 letter
//      increment so A→B→…→Z→AA→AB. Same scheme nextMultName() uses for
//      mults so letter sequences read identically across both flows.
//
// Returns null when none of the three apply (e.g. an empty or
// symbol-only input) so the caller can surface a clean error.

export function parseStartingName(
  name: string,
): { at: (i: number) => string } | null {
  const trimmed = name.trim()
  if (!trimmed) return null

  // Rule 1: trailing dotted-integer.
  const dotMatch = trimmed.match(/^(.+)\.(\d+)$/)
  if (dotMatch) {
    const prefix = `${dotMatch[1]}.`
    const start = parseInt(dotMatch[2], 10)
    const padWidth = dotMatch[2].length
    return {
      at: (i) => `${prefix}${String(start + i).padStart(padWidth, '0')}`,
    }
  }

  // Rule 2: trailing plain integer.
  const intMatch = trimmed.match(/^(.*?)(\d+)$/)
  if (intMatch) {
    const prefix = intMatch[1]
    const start = parseInt(intMatch[2], 10)
    const padWidth = intMatch[2].length
    return {
      at: (i) => `${prefix}${String(start + i).padStart(padWidth, '0')}`,
    }
  }

  // Rule 3: trailing letters.
  const letMatch = trimmed.match(/^(.*?)([A-Za-z]+)$/)
  if (letMatch) {
    const prefix = letMatch[1]
    const startLetters = letMatch[2].toUpperCase()
    return {
      at: (i) => `${prefix}${incrementLetters(startLetters, i)}`,
    }
  }

  return null
}

/**
 * Bijective base-26 increment. "A" + 1 = "B", "Z" + 1 = "AA",
 * "AA" + 1 = "AB", "AZ" + 1 = "BA".
 */
export function incrementLetters(start: string, offset: number): string {
  let value = 0
  for (const ch of start.toUpperCase()) {
    value = value * 26 + (ch.charCodeAt(0) - 64)
  }
  value += offset
  if (value < 1) return start
  let result = ''
  while (value > 0) {
    const rem = (value - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}
