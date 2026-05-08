'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { notifyDeployStatusChanged } from '@/lib/notifications'

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

const CATEGORY_PREFIXES: Record<string, string> = {
  panels: 'PNL',
  wireless_bp: 'WLBP',
  hardwire_bp: 'HWBP',
  switches: 'SW',
  antennas: 'ANT',
  audio: 'AUD',
}

/**
 * Parse a user-provided starting name like "P001", "PNL 15", "P1" into
 * a prefix, number, pad width, and whether a space separator was used.
 * The returned pieces let us preserve the user's formatting exactly when
 * generating the sequence (so "P001" yields "P002", not "P 002").
 */
function parseStartingName(name: string): {
  prefix: string
  start: number
  padWidth: number
  separator: string
} | null {
  const match = name.trim().match(/^([A-Za-z]+)(\s*)(\d+)$/)
  if (!match) return null
  return {
    prefix: match[1],
    separator: match[2],
    start: parseInt(match[3], 10),
    padWidth: match[3].length,
  }
}

export async function bulkCreateEquipment(
  projectId: number,
  category: string,
  hardwareType: string,
  quantity: number,
  startingId: string = '',
  /** When true (default), each new piece of assignable equipment also
   *  gets a placeholder team member auto-created and assigned to it.
   *  The placeholder's first name = equipment prefix, last name =
   *  trailing number (e.g. "HWBP 1" → first "HWBP", last "1"). The real
   *  person who eventually checks in via the kiosk replaces them. */
  autoAssign: boolean = true,
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  if (!category || !CATEGORY_PREFIXES[category]) {
    return { error: 'Invalid category' }
  }
  if (quantity < 1 || quantity > 200) {
    return { error: 'Quantity must be between 1 and 200' }
  }

  const trimmedStartingId = startingId.trim()

  // Decide prefix + starting number + pad width + separator based on whether
  // the user typed a starting ID. Blank → category default ("PNL 1", etc.);
  // Filled → literal sequence from the user's value.
  let prefix: string
  let startNum: number
  let padWidth: number
  let separator: string

  if (trimmedStartingId) {
    const parsed = parseStartingName(trimmedStartingId)
    if (!parsed) {
      return { error: 'ID must be letters followed by digits (e.g. PNL 1, P001, P1)' }
    }
    prefix = parsed.prefix
    startNum = parsed.start
    padWidth = parsed.padWidth
    separator = parsed.separator
  } else {
    prefix = CATEGORY_PREFIXES[category]
    separator = ' ' // Default format is "PNL 1" with a space.
    padWidth = 1 // No zero-padding for auto-generated names.
    // Find the highest existing number for this category prefix in this project.
    const existing = await prisma.equipment.findMany({
      where: { projectId, category },
      select: { name: true },
    })
    let maxNum = 0
    for (const e of existing) {
      const m = e.name.match(new RegExp(`^${prefix}\\s+(\\d+)$`))
      if (m) {
        const num = parseInt(m[1], 10)
        if (num > maxNum) maxNum = num
      }
    }
    startNum = maxNum + 1
  }

  // Pull every existing equipment name across the project so we can skip
  // collisions when the user's chosen range overlaps existing items.
  const existingNames = new Set<string>()
  const allExisting = await prisma.equipment.findMany({
    where: { projectId },
    select: { name: true },
  })
  for (const e of allExisting) existingNames.add(e.name)

  // Auto-assign default headset for panels, wireless BP, and hardwire BP
  const LWHS_5_TYPES = ['KP-5032', 'KP32', 'ST-374', 'ST370', 'DBP5']
  const HEADSET_CATEGORIES = ['panels', 'wireless_bp', 'hardwire_bp']
  let defaultHeadset: string | null = null
  if (HEADSET_CATEGORIES.includes(category)) {
    defaultHeadset = LWHS_5_TYPES.includes(hardwareType) ? 'LWHS 5' : 'LWHS 4'
  }

  const records: {
    projectId: number
    name: string
    category: string
    hardwareType: string | null
    headsetType: string | null
  }[] = []
  let n = startNum
  const maxIterations = quantity * 10 + 10
  let iterations = 0
  while (records.length < quantity && iterations < maxIterations) {
    const name = `${prefix}${separator}${String(n).padStart(padWidth, '0')}`
    if (!existingNames.has(name)) {
      records.push({
        projectId,
        name,
        category,
        hardwareType: hardwareType || null,
        headsetType: defaultHeadset,
      })
      existingNames.add(name)
    }
    n++
    iterations++
  }

  if (records.length < quantity) {
    return { error: 'Too many collisions in the requested range. Pick a different starting ID.' }
  }

  await prisma.equipment.createMany({ data: records })

  // ─── Auto-assign placeholder members ───
  // Only run when the caller asked for it AND the category is one we
  // can actually assign to (chargers, switches, antennas don't take a
  // person). Each piece of new equipment gets a placeholder member
  // whose name mirrors the equipment ID; if a real user with the same
  // name already exists on the project we reuse them instead of
  // creating duplicates.
  const ASSIGNABLE_CATEGORIES = ['panels', 'wireless_bp', 'hardwire_bp']
  let placeholdersCreated = 0
  if (autoAssign && ASSIGNABLE_CATEGORIES.includes(category) && records.length > 0) {
    const createdNames = records.map((r) => r.name)
    const created = await prisma.equipment.findMany({
      where: { projectId, name: { in: createdNames } },
      select: { id: true, name: true },
    })

    // Snapshot existing members on the project so we can reuse instead
    // of creating new placeholder rows when names collide.
    const existingMembers = await prisma.projectMember.findMany({
      where: { projectId },
      select: {
        id: true,
        user: { select: { firstName: true, lastName: true } },
      },
    })
    const memberByName = new Map<string, number>(
      existingMembers.map((m) => [
        `${m.user.firstName.toLowerCase()}|${m.user.lastName.toLowerCase()}`,
        m.id,
      ]),
    )

    for (const eq of created) {
      // Parse equipment name into placeholder first + last.
      // Accepts "HWBP 1", "HWBP1", "P001", etc. Anything before the
      // trailing digit run becomes the first name; the digits become
      // the last name (preserving zero-padding so "P001" → "001").
      const m = eq.name.match(/^(.*?)\s*(\d+)$/)
      if (!m) continue
      const fn = m[1].trim()
      const ln = m[2]
      if (!fn) continue

      const memberKey = `${fn.toLowerCase()}|${ln.toLowerCase()}`
      let memberId = memberByName.get(memberKey)
      if (!memberId) {
        // No existing member — find/create the user and the project membership.
        const existingUser = await prisma.user.findFirst({
          where: {
            firstName: { equals: fn, mode: 'insensitive' },
            lastName: { equals: ln, mode: 'insensitive' },
          },
          select: { id: true },
        })
        const userId = existingUser
          ? existingUser.id
          : (
              await prisma.user.create({
                data: { firstName: fn, lastName: ln, pin: '' },
              })
            ).id
        const newMember = await prisma.projectMember.create({
          data: { userId, projectId, role: 'user' },
          select: { id: true },
        })
        memberId = newMember.id
        memberByName.set(memberKey, memberId)
        placeholdersCreated++
      }

      await prisma.equipment.update({
        where: { id: eq.id },
        data: { assignedToId: memberId },
      })
    }
  }

  revalidatePath(`/projects/${projectId}`)
  return { success: true, count: records.length, placeholdersCreated }
}

export async function updateEquipment(
  projectId: number,
  equipmentId: number,
  data: {
    name?: string
    hardwareType?: string | null
    position?: string | null
    location?: string | null
    headsetType?: string | null
    ipAddress?: string | null
    patch?: string | null
    deployStatus?: string
    assignedToId?: number | null
    gooseneck?: boolean
    footswitches?: number
    speakers?: number
  }
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  // Read the previous deployStatus before the update so we only fire
  // a push when the status actually changed (not when a name / location
  // edit happens to be saved with the same status alongside).
  const before = data.deployStatus !== undefined
    ? await prisma.equipment.findUnique({
        where: { id: equipmentId },
        select: { deployStatus: true },
      })
    : null

  await prisma.equipment.update({
    where: { id: equipmentId },
    data,
  })

  if (data.deployStatus && before && before.deployStatus !== data.deployStatus) {
    void notifyDeployStatusChanged({
      equipmentId,
      newStatus: data.deployStatus,
      actorUserId: session.user.id,
    })
  }

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function deleteEquipment(projectId: number, equipmentId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  await prisma.equipment.delete({ where: { id: equipmentId } })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}
