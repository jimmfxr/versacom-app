/**
 * Detect auto-generated placeholder members.
 *
 * Bulk-adding equipment with auto-assign on creates a User per piece
 * of gear so the kiosk PIN-setup flow has something to take over.
 * Those placeholders have a known shape:
 *
 *   firstName = the equipment prefix (PNL, WLBP, HWBP, SW, ANT, AUD,
 *               MULT, FBR, ETH, W1, CPC)
 *   lastName  = the trailing digits (1, 001, 12, …) — or a letter
 *               suffix on mults (A, B, AA, BB)
 *   pin       = '' (never logged in)
 *
 * When a real person joins via the kiosk, their User row gets renamed
 * to the real name AND the PIN is set. So any User with pin='' AND a
 * name matching this pattern is still an unclaimed placeholder.
 *
 * The double check (empty PIN *and* placeholder-shaped name) is
 * intentional — an admin can also hand-add a real "John Smith"
 * member with no PIN yet. That user is NOT a placeholder; their
 * firstName doesn't match any equipment prefix, so the second
 * check guards against accidental deletion.
 */

/** Every prefix the bulk-add equipment flow uses for placeholder
 *  first names. Kept here (not imported from project-page.tsx) so
 *  this lib stays free of UI-only constants. */
const PLACEHOLDER_FIRST_NAMES = new Set([
  'PNL',
  'WLBP',
  'HWBP',
  'SW',
  'ANT',
  'AUD',
  'MULT',
  'FBR',
  'ETH',
  'W1',
  'CPC',
])

export function isPlaceholderUser(user: {
  firstName: string
  lastName: string
  pin: string
}): boolean {
  // Real users always have a PIN by the time auto-cleanup matters.
  if (user.pin !== '') return false
  const fn = user.firstName.trim().toUpperCase()
  if (!PLACEHOLDER_FIRST_NAMES.has(fn)) return false
  const ln = user.lastName.trim().toUpperCase()
  // Equipment placeholders are digits ("1", "001"). Mult placeholders
  // are letter suffixes ("A", "AA", "BB"). Both shapes are auto-gen
  // and safe to clean up.
  return /^\d+$/.test(ln) || /^[A-Z]+$/.test(ln)
}
