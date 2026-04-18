'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'

const VALID_TYPES = ['CONF', 'IFB', 'Audio_IO', 'GRP'] as const
type ValidType = (typeof VALID_TYPES)[number]

const TYPE_PREFIXES: Record<ValidType, string> = {
  CONF: 'C',
  IFB: 'IF',
  GRP: 'G',
  Audio_IO: 'A',
}

async function getSession() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')
  if (!sessionCookie?.value) return null
  try {
    return JSON.parse(sessionCookie.value) as { user: { id: number } }
  } catch {
    return null
  }
}

/**
 * Parse a user-provided starting ID like "C100", "VW001", "IF42" into its
 * alphabetic prefix, starting number, and pad width (so we preserve the
 * user's zero-padding style — "C001" pads to 3, "C1" doesn't pad).
 */
function parseStartingId(id: string): { prefix: string; start: number; padWidth: number } | null {
  const match = id.trim().match(/^([A-Za-z]+)(\d+)$/)
  if (!match) return null
  return {
    prefix: match[1],
    start: parseInt(match[2], 10),
    padWidth: match[2].length,
  }
}

/** Format a code at the caller's chosen pad width. */
function formatAtWidth(prefix: string, n: number, padWidth: number): string {
  return `${prefix}${String(n).padStart(padWidth, '0')}`
}

/** Highest sequential number used by any code whose prefix matches (case-insensitive). */
async function findMaxNumForPrefix(projectId: number, prefix: string): Promise<number> {
  const existing = await prisma.pickListItem.findMany({
    where: { projectId },
    select: { code: true },
  })
  let max = 0
  const prefixLower = prefix.toLowerCase()
  for (const { code } of existing) {
    if (!code) continue
    const m = code.match(/^([A-Za-z]+)(\d+)$/)
    if (!m) continue
    if (m[1].toLowerCase() !== prefixLower) continue
    const n = parseInt(m[2], 10)
    if (n > max) max = n
  }
  return max
}

/** All codes matching the prefix (case-insensitive) — for collision skipping. */
async function findExistingCodesForPrefix(projectId: number, prefix: string): Promise<Set<string>> {
  const existing = await prisma.pickListItem.findMany({
    where: { projectId },
    select: { code: true },
  })
  const set = new Set<string>()
  const prefixLower = prefix.toLowerCase()
  for (const { code } of existing) {
    if (!code) continue
    const m = code.match(/^([A-Za-z]+)(\d+)$/)
    if (!m) continue
    if (m[1].toLowerCase() === prefixLower) set.add(code)
  }
  return set
}

export async function createPickListItem(
  projectId: number,
  data: { name: string; type: string; code?: string; quantity?: number }
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  if (!VALID_TYPES.includes(data.type as ValidType)) {
    return { error: 'Invalid function type' }
  }
  const type = data.type as ValidType
  const trimmedName = data.name.trim()
  const trimmedCode = data.code?.trim() ?? ''
  const quantity = Math.max(1, Math.floor(data.quantity ?? 1))

  if (quantity > 200) return { error: 'Quantity must be at most 200' }

  // ─── Named single-item mode ─────────────────────────────────────
  // If the user typed a Name, we create exactly one item — Quantity
  // is forced to 1 on the client but enforce here too. ID is either
  // the user's or auto-generated with type prefix.
  if (trimmedName) {
    let code = trimmedCode
    if (!code) {
      const prefix = TYPE_PREFIXES[type]
      const max = await findMaxNumForPrefix(projectId, prefix)
      code = formatAtWidth(prefix, max + 1, 1)
    }
    await prisma.pickListItem.create({
      data: { projectId, code, name: trimmedName, type },
    })
    revalidatePath(`/projects/${projectId}`)
    return { success: true, count: 1 }
  }

  // ─── Bulk placeholder mode (Name is blank) ──────────────────────
  // Figure out starting point based on whether the user typed an ID.
  let prefix: string
  let startNum: number
  let padWidth: number

  if (trimmedCode) {
    // User-specified starting ID like "C100" or "VW001".
    const parsed = parseStartingId(trimmedCode)
    if (!parsed) {
      return { error: 'ID must be letters followed by digits (e.g. C100, VW001)' }
    }
    prefix = parsed.prefix
    startNum = parsed.start
    padWidth = parsed.padWidth
  } else {
    // Auto mode — type prefix, continue past highest, no padding.
    prefix = TYPE_PREFIXES[type]
    const max = await findMaxNumForPrefix(projectId, prefix)
    startNum = max + 1
    padWidth = 1
  }

  // Generate N codes, skipping collisions. Pre-load existing codes so we
  // don't need a round-trip per check. Also dedupe within the batch itself.
  const existing = await findExistingCodesForPrefix(projectId, prefix)
  const records: { projectId: number; code: string; name: string; type: ValidType }[] = []
  let n = startNum
  const maxIterations = quantity * 10 + 10
  let iterations = 0
  while (records.length < quantity && iterations < maxIterations) {
    const code = formatAtWidth(prefix, n, padWidth)
    if (!existing.has(code)) {
      // Name defaults to the code — user can rename later via edit.
      records.push({ projectId, code, name: code, type })
      existing.add(code)
    }
    n++
    iterations++
  }

  if (records.length < quantity) {
    return { error: 'Too many collisions in the requested range. Pick a different starting ID.' }
  }

  await prisma.pickListItem.createMany({ data: records })
  revalidatePath(`/projects/${projectId}`)
  return { success: true, count: records.length }
}

export async function updatePickListItem(
  projectId: number,
  itemId: number,
  data: { name?: string; type?: string; code?: string | null }
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  if (data.name !== undefined && !data.name.trim()) {
    return { error: 'Name is required' }
  }
  if (data.type !== undefined && !VALID_TYPES.includes(data.type as ValidType)) {
    return { error: 'Invalid function type' }
  }

  await prisma.pickListItem.update({
    where: { id: itemId },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.code !== undefined
        ? { code: data.code === null ? null : data.code.trim() || null }
        : {}),
    },
  })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function deletePickListItem(projectId: number, itemId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  await prisma.pickListItem.delete({ where: { id: itemId } })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}
