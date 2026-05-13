/**
 * Shared metadata for the `mults` equipment category. Single source of
 * truth for hardware-type → strand count, color codes, ID prefixes,
 * and which gear categories a strand can attach to. Used by both the
 * Add Equipment form and the per-mult card.
 */

export type MultHardwareType = 'Fiber' | 'Ethernet' | 'W1' | 'CPC'

export const MULT_HARDWARE_TYPES: MultHardwareType[] = ['Fiber', 'Ethernet', 'W1', 'CPC']

/** Fixed pair count for Ethernet / W1 / CPC. Fiber is variable. */
export const FIXED_STRAND_COUNT: Record<Exclude<MultHardwareType, 'Fiber'>, number> = {
  Ethernet: 5,
  W1: 16,
  CPC: 4,
}

/** Allowed strand counts when creating a Fiber mult. */
export const FIBER_STRAND_OPTIONS = [2, 4, 12, 24, 48, 76] as const

/** Default strand count for a Fiber mult at creation. */
export const FIBER_DEFAULT_STRANDS = 12

/** Standard physical mult lengths in feet. Same set across all mult
 *  types. Stored as int, rendered with a trailing apostrophe in the UI. */
export const MULT_LENGTH_OPTIONS = [25, 50, 100, 150, 300, 500, 1000] as const

/** Default length at create-time. */
export const MULT_DEFAULT_LENGTH = 100

/** Auto-ID prefix per hardware type. Names look like "FBR A", "ETH AA". */
export const MULT_ID_PREFIX: Record<MultHardwareType, string> = {
  Fiber: 'FBR',
  Ethernet: 'ETH',
  W1: 'W1',
  CPC: 'CPC',
}

/** Whether a mult of this hardware type attaches its strands to OTHER
 *  equipment. W1 and CPC are documentation only — channel name input
 *  but no FK to gear. */
export function attachableMult(type: MultHardwareType): boolean {
  return type === 'Fiber' || type === 'Ethernet'
}

/** Which gear categories show up in the strand-attach dropdown,
 *  per mult hardware type. W1 / CPC return empty (no dropdown). */
export const STRAND_ATTACH_CATEGORIES: Record<MultHardwareType, string[]> = {
  Fiber: ['switches', 'antennas'], // antennas filtered further to Pliant only
  Ethernet: ['switches', 'panels', 'antennas', 'hardwire_bp'],
  W1: [],
  CPC: [],
}

/** Trunk end (parent device the mult plugs into) is always a switch
 *  or Pliant antenna — same across all mult types. */
export const MULT_TRUNK_CATEGORIES = ['switches', 'antennas'] as const

/** Returns true when an Equipment row qualifies as a trunk-end target.
 *  Antennas only qualify when their hardwareType is 'Pliant'. */
export function isTrunkTarget(category: string, hardwareType: string | null): boolean {
  if (category === 'switches') return true
  if (category === 'antennas' && hardwareType === 'Pliant') return true
  return false
}

/**
 * TIA-598-C fiber color sequence — 12 colors. For 24/48/76 strand mults
 * the sequence repeats (only the position number disambiguates beyond 12).
 */
const FIBER_COLORS_BASE = [
  { label: 'Blue', tw: 'bg-blue-500' },
  { label: 'Orange', tw: 'bg-orange-500' },
  { label: 'Green', tw: 'bg-green-500' },
  { label: 'Brown', tw: 'bg-yellow-900' },
  { label: 'Slate', tw: 'bg-slate-400' },
  { label: 'White', tw: 'bg-gray-100' },
  { label: 'Red', tw: 'bg-red-500' },
  { label: 'Black', tw: 'bg-black border border-white/20' },
  { label: 'Yellow', tw: 'bg-yellow-400' },
  { label: 'Violet', tw: 'bg-violet-500' },
  { label: 'Rose', tw: 'bg-pink-400' },
  { label: 'Aqua', tw: 'bg-cyan-300' },
]

/**
 * Resistor color sequence — 10 colors. For W1 (16 pairs) and any
 * longer mult, the sequence wraps to the beginning.
 */
const RESISTOR_COLORS_BASE = [
  { label: 'Brown', tw: 'bg-yellow-900' },
  { label: 'Red', tw: 'bg-red-500' },
  { label: 'Orange', tw: 'bg-orange-500' },
  { label: 'Yellow', tw: 'bg-yellow-400' },
  { label: 'Green', tw: 'bg-green-500' },
  { label: 'Blue', tw: 'bg-blue-500' },
  { label: 'Violet', tw: 'bg-violet-500' },
  { label: 'Gray', tw: 'bg-gray-400' },
  { label: 'White', tw: 'bg-gray-100' },
  { label: 'Black', tw: 'bg-black border border-white/20' },
]

export type StrandColor = { label: string; tw: string }

/** Color for a 1-based strand index. Wraps when index exceeds the
 *  palette length. */
export function strandColor(type: MultHardwareType, index: number): StrandColor {
  const palette = type === 'Fiber' ? FIBER_COLORS_BASE : RESISTOR_COLORS_BASE
  const i = ((index - 1) % palette.length + palette.length) % palette.length
  return palette[i]
}

/**
 * Generate a letter suffix from a 0-based count.
 *   0..25  -> A..Z
 *   26..51 -> AA..ZZ (doubled letters per user preference)
 *   52+    -> falls back to triple letters (AAA..) which shouldn't happen
 *
 * Note: user explicitly wanted "AA, BB, CC" past Z (doubled letters)
 * rather than Excel-style "AA, AB, AC". Keeping it predictable: each
 * step past Z is a doubled letter.
 */
export function letterSuffix(n: number): string {
  if (n < 0) return 'A'
  if (n < 26) return String.fromCharCode(65 + n)
  if (n < 52) {
    const c = String.fromCharCode(65 + (n - 26))
    return c + c
  }
  // Fallback for the 53rd mult of a single type on a single project —
  // unlikely, but don't crash. Triple letters: AAA, BBB, ...
  const c = String.fromCharCode(65 + ((n - 52) % 26))
  return c + c + c
}

/** Build the auto-name for the next mult of a given hardware type. */
export function nextMultName(type: MultHardwareType, existingNames: string[]): string {
  const prefix = MULT_ID_PREFIX[type]
  const suffixSet = new Set<string>()
  for (const name of existingNames) {
    // Match "<prefix> <suffix>" exactly — e.g. "FBR A", "W1 BB".
    const match = name.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s+([A-Z]+)$`))
    if (match) suffixSet.add(match[1])
  }
  let i = 0
  while (suffixSet.has(letterSuffix(i))) i++
  return `${prefix} ${letterSuffix(i)}`
}

/** Strand-count getter that resolves Fiber's variable count from the
 *  Equipment row's stored `strandCount`. Falls back to a sensible
 *  default when the row is malformed. */
export function strandCountFor(type: MultHardwareType, stored: number | null): number {
  if (type === 'Fiber') return stored && stored > 0 ? stored : FIBER_DEFAULT_STRANDS
  return FIXED_STRAND_COUNT[type]
}
