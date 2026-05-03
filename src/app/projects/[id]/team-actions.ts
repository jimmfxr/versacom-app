'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'

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

export async function createMember(
  projectId: number,
  data: { firstName: string; lastName: string; position?: string; role: string }
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  if (!data.firstName.trim() || !data.lastName.trim()) {
    return { error: 'First and last name are required' }
  }

  if (!['admin', 'manager', 'crew', 'user'].includes(data.role)) {
    return { error: 'Invalid role' }
  }

  // Check if a user with this name already exists
  const existingUser = await prisma.user.findFirst({
    where: {
      firstName: { equals: data.firstName.trim(), mode: 'insensitive' },
      lastName: { equals: data.lastName.trim(), mode: 'insensitive' },
    },
  })

  if (existingUser) {
    // Check if already a member of this project
    const existingMember = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: existingUser.id, projectId } },
    })
    if (existingMember) {
      return { error: `${data.firstName.trim()} ${data.lastName.trim()} is already on this project` }
    }

    // Add existing user to project
    await prisma.projectMember.create({
      data: {
        userId: existingUser.id,
        projectId,
        role: data.role,
        position: data.position?.trim() || null,
      },
    })
  } else {
    // Create new user (empty PIN — they set it when they join/login)
    const user = await prisma.user.create({
      data: {
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        pin: '',
      },
    })

    await prisma.projectMember.create({
      data: {
        userId: user.id,
        projectId,
        role: data.role,
        position: data.position?.trim() || null,
      },
    })
  }

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function updateMember(
  projectId: number,
  memberId: number,
  data: { firstName?: string; lastName?: string; position?: string | null; role?: string }
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const member = await prisma.projectMember.findUnique({
    where: { id: memberId },
    include: { user: true },
  })
  if (!member) return { error: 'Member not found' }

  // Update user name if changed
  if (data.firstName !== undefined || data.lastName !== undefined) {
    await prisma.user.update({
      where: { id: member.userId },
      data: {
        ...(data.firstName !== undefined ? { firstName: data.firstName.trim() } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName.trim() } : {}),
      },
    })
  }

  // Update member fields
  await prisma.projectMember.update({
    where: { id: memberId },
    data: {
      ...(data.position !== undefined ? { position: data.position || null } : {}),
      ...(data.role !== undefined ? { role: data.role } : {}),
    },
  })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function deleteMember(projectId: number, memberId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  // Unassign any equipment assigned to this member
  await prisma.equipment.updateMany({
    where: { assignedToId: memberId },
    data: { assignedToId: null },
  })

  await prisma.projectMember.delete({ where: { id: memberId } })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

/**
 * Bulk-add helper. Reads the trailing integer in `lastName` and increments
 * to generate `quantity` distinct user names. If `lastName` has no trailing
 * integer, it falls back to a numeric suffix starting at 2 ("Spot Tech",
 * "Spot Tech 2", "Spot Tech 3", ...).
 *
 * Skips and continues whenever a generated name is already on the project,
 * just like the equipment auto-IDer does. firstName, position, and role
 * are shared across all created members.
 */
export async function bulkCreateMembers(
  projectId: number,
  data: {
    firstName: string
    lastName: string
    position?: string
    role: string
    quantity: number
  },
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const fn = data.firstName.trim()
  const ln = data.lastName.trim()
  const position = data.position?.trim() || null

  if (!fn || !ln) return { error: 'First and last name are required' }
  if (!['admin', 'manager', 'crew', 'user'].includes(data.role)) {
    return { error: 'Invalid role' }
  }
  if (!Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 200) {
    return { error: 'Quantity must be 1–200' }
  }

  // Generate the sequence of (firstName, lastName) name pairs.
  // - Trailing integer in lastName → increment from there.
  // - No trailing integer + qty 1 → use as-is.
  // - No trailing integer + qty > 1 → first use as-is, then suffix " 2", " 3"...
  const trailing = ln.match(/^(.*?)(\d+)$/)
  const targets: Array<{ firstName: string; lastName: string }> = []
  if (trailing) {
    const prefix = trailing[1]
    const startN = parseInt(trailing[2], 10)
    for (let i = 0; i < data.quantity; i++) {
      targets.push({ firstName: fn, lastName: `${prefix}${startN + i}` })
    }
  } else {
    targets.push({ firstName: fn, lastName: ln })
    for (let i = 2; i <= data.quantity; i++) {
      targets.push({ firstName: fn, lastName: `${ln} ${i}` })
    }
  }

  // Pre-check existing members on this project so we know which ones to skip.
  // We compare case-insensitively to match createMember's behavior.
  const existingMembers = await prisma.projectMember.findMany({
    where: { projectId },
    select: { user: { select: { firstName: true, lastName: true } } },
  })
  const existingKeys = new Set(
    existingMembers.map((m) => `${m.user.firstName.toLowerCase()}|${m.user.lastName.toLowerCase()}`),
  )

  let created = 0
  let skipped = 0

  // Process sequentially. Trying to do this in parallel risks two iterations
  // both creating the same user when the trailing-int generator produces the
  // same name (it shouldn't, but defensive anyway). Sequential keeps the
  // unique check meaningful per insert.
  for (const target of targets) {
    const key = `${target.firstName.toLowerCase()}|${target.lastName.toLowerCase()}`
    if (existingKeys.has(key)) {
      skipped++
      continue
    }
    existingKeys.add(key)

    // Reuse user if exists (by name) so we don't create duplicate User rows.
    const existingUser = await prisma.user.findFirst({
      where: {
        firstName: { equals: target.firstName, mode: 'insensitive' },
        lastName: { equals: target.lastName, mode: 'insensitive' },
      },
      select: { id: true },
    })

    const userId = existingUser
      ? existingUser.id
      : (
          await prisma.user.create({
            data: { firstName: target.firstName, lastName: target.lastName, pin: '' },
          })
        ).id

    await prisma.projectMember.create({
      data: { userId, projectId, role: data.role, position },
    })
    created++
  }

  revalidatePath(`/projects/${projectId}`)
  return { success: true, created, skipped }
}
