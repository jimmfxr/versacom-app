/**
 * Display-only formatting for user names. The DB stores whatever the
 * user typed when they signed up (`john`, `JOHN`, `John`, `JoHn`, …),
 * but everywhere a name is rendered the app should normalize to
 * `John` — first letter uppercase, the rest lowercase. Hyphenated
 * and O'-prefixed names (`mary-jane`, `o'brien`) get each segment
 * capitalized too: `Mary-Jane`, `O'Brien`.
 *
 * No DB writes are involved; this is purely a display helper. Pass
 * raw strings from Prisma into these functions before rendering.
 */
export function capitalizeName(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
}

/** Convenience for rendering "First Last" in one shot. */
export function formatFullName(first: string | null | undefined, last: string | null | undefined): string {
  const f = capitalizeName(first)
  const l = capitalizeName(last)
  if (f && l) return `${f} ${l}`
  return f || l
}
