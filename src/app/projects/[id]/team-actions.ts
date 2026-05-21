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
  data: { firstName: string; lastName: string; position?: string; department?: string; role: string }
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

    const dept = data.department?.trim() || null
    // Mirror the department onto the User row too so it follows the
    // person across shows. ProjectMember keeps the per-show value as
    // the source of truth for THIS project.
    if (dept) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { department: dept },
      })
    }
    // Add existing user to project
    await prisma.projectMember.create({
      data: {
        userId: existingUser.id,
        projectId,
        role: data.role,
        position: data.position?.trim() || null,
        department: dept,
      },
    })
  } else {
    const dept = data.department?.trim() || null
    // Create new user (empty PIN — they set it when they join/login).
    // Department goes on the User row too as their persisting default.
    const user = await prisma.user.create({
      data: {
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        pin: '',
        department: dept,
      },
    })

    await prisma.projectMember.create({
      data: {
        userId: user.id,
        projectId,
        role: data.role,
        position: data.position?.trim() || null,
        department: dept,
      },
    })
  }

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function updateMember(
  projectId: number,
  memberId: number,
  data: { firstName?: string; lastName?: string; position?: string | null; department?: string | null; role?: string }
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const member = await prisma.projectMember.findUnique({
    where: { id: memberId },
    include: { user: true },
  })
  if (!member) return { error: 'Member not found' }

  // Update user name + global department default if changed. The
  // ProjectMember.department write below still scopes to THIS show, but
  // the User row carries the latest typed value forward to future
  // joins.
  if (data.firstName !== undefined || data.lastName !== undefined || data.department !== undefined) {
    await prisma.user.update({
      where: { id: member.userId },
      data: {
        ...(data.firstName !== undefined ? { firstName: data.firstName.trim() } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName.trim() } : {}),
        ...(data.department !== undefined ? { department: data.department || null } : {}),
      },
    })
  }

  // Update member fields
  await prisma.projectMember.update({
    where: { id: memberId },
    data: {
      ...(data.position !== undefined ? { position: data.position || null } : {}),
      ...(data.department !== undefined ? { department: data.department || null } : {}),
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
    department?: string
    role: string
    quantity: number
    /** Optional starting equipment ID (e.g. "PNL1", "WLBP3"). When set,
     *  each created member is auto-assigned to consecutive equipment
     *  whose name matches the incrementing trailing number. Existing
     *  assignments on those slots are *replaced* — the bumped member
     *  stays on the project but loses that piece of equipment. */
    startEquipmentId?: string
  },
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const fn = data.firstName.trim()
  const ln = data.lastName.trim()
  const position = data.position?.trim() || null
  const department = data.department?.trim() || null

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

  // ─── Equipment slot resolution (Path B: replace existing) ───
  // Parse startEquipmentId into prefix + counter, generate the target
  // equipment names, look them up, hard-fail on missing/non-assignable
  // and capture who's currently in each slot for the toast.
  const ASSIGNABLE_CATEGORIES = ['panels', 'wireless_bp', 'hardwire_bp']
  type Slot = {
    equipmentId: number
    equipmentName: string
    replacedMemberId: number | null
    replacedMemberName: string | null
  }
  let slots: Slot[] = []
  const startId = data.startEquipmentId?.trim()
  if (startId) {
    const m = startId.match(/^(.*?)(\d+)$/)
    if (!m) {
      return { error: `Equipment ID "${startId}" must end with a number (e.g. PNL1, WLBP3).` }
    }
    const prefix = m[1]
    const startN = parseInt(m[2], 10)
    const digitWidth = m[2].length // preserves zero-padding ("PNL01" → "PNL02")
    const targetNames: string[] = []
    for (let i = 0; i < data.quantity; i++) {
      targetNames.push(`${prefix}${String(startN + i).padStart(digitWidth, '0')}`)
    }
    const found = await prisma.equipment.findMany({
      where: { projectId, name: { in: targetNames } },
      select: {
        id: true,
        name: true,
        category: true,
        assignedToId: true,
        assignedTo: {
          select: { id: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
    })
    const foundByName = new Map(found.map((e) => [e.name, e]))

    const missing = targetNames.filter((n) => !foundByName.has(n))
    if (missing.length > 0) {
      return { error: `Equipment doesn't exist: ${missing.join(', ')}` }
    }
    const nonAssignable = found.filter((e) => !ASSIGNABLE_CATEGORIES.includes(e.category))
    if (nonAssignable.length > 0) {
      return {
        error: `Equipment can't be assigned to a person: ${nonAssignable.map((e) => e.name).join(', ')}`,
      }
    }

    slots = targetNames.map((name) => {
      const e = foundByName.get(name)!
      return {
        equipmentId: e.id,
        equipmentName: e.name,
        replacedMemberId: e.assignedTo?.id ?? null,
        replacedMemberName: e.assignedTo
          ? `${e.assignedTo.user.firstName} ${e.assignedTo.user.lastName}`
          : null,
      }
    })
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
  const replacedAssignments: Array<{ equipmentName: string; memberName: string }> = []
  const slotsSkipped: string[] = []

  // Process sequentially. Trying to do this in parallel risks two iterations
  // both creating the same user when the trailing-int generator produces the
  // same name (it shouldn't, but defensive anyway). Sequential keeps the
  // unique check meaningful per insert.
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]
    const slot = slots[i] // undefined when no startEquipmentId
    const key = `${target.firstName.toLowerCase()}|${target.lastName.toLowerCase()}`
    if (existingKeys.has(key)) {
      skipped++
      // The slot stays on its current owner — record so we can tell the user.
      if (slot) slotsSkipped.push(slot.equipmentName)
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
            data: { firstName: target.firstName, lastName: target.lastName, pin: '', department },
          })
        ).id

    // Existing-user path: keep the User's global department in sync with
    // what the admin just typed for this bulk add so the field persists.
    if (existingUser && department) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { department },
      })
    }

    const newMember = await prisma.projectMember.create({
      data: { userId, projectId, role: data.role, position, department },
      select: { id: true },
    })
    created++

    // Equipment assignment for this slot.
    if (slot) {
      await prisma.equipment.update({
        where: { id: slot.equipmentId },
        data: { assignedToId: newMember.id },
      })
      if (slot.replacedMemberName) {
        replacedAssignments.push({
          equipmentName: slot.equipmentName,
          memberName: slot.replacedMemberName,
        })
      }
    }
  }

  revalidatePath(`/projects/${projectId}`)
  return { success: true, created, skipped, replacedAssignments, slotsSkipped }
}
