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

export async function updateProject(projectId: number, formData: FormData) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const name = (formData.get('name') as string)?.trim()
  const status = formData.get('status') as string
  const managerId = formData.get('managerId') as string

  if (!name || name.length === 0) {
    return { error: 'Project name is required' }
  }
  if (name.length > 100) {
    return { error: 'Project name must be 100 characters or less' }
  }
  if (status !== 'active' && status !== 'archived') {
    return { error: 'Invalid status' }
  }

  // Check for duplicate name (excluding this project)
  const existing = await prisma.project.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      id: { not: projectId },
    },
  })
  if (existing) {
    return { error: 'A project with that name already exists' }
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { name, status },
  })

  // Update manager role if set
  if (managerId) {
    const mgrId = parseInt(managerId, 10)
    if (!isNaN(mgrId)) {
      // Remove manager role from current manager(s)
      await prisma.projectMember.updateMany({
        where: { projectId, role: 'manager' },
        data: { role: 'crew' },
      })
      // Set new manager
      await prisma.projectMember.updateMany({
        where: { projectId, userId: mgrId },
        data: { role: 'manager' },
      })
    }
  }

  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/projects')
  return { success: true }
}

export async function removeMember(projectId: number, memberId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  await prisma.projectMember.delete({
    where: { id: memberId },
  })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

/**
 * Flip status between 'active' and 'archived' in a single call. Used by
 * the Restore button on archived project cards and the status dropdown
 * in project settings. Fresh revalidation on every view that lists
 * projects so the card instantly moves between buckets.
 */
export async function setProjectStatus(projectId: number, status: 'active' | 'archived') {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }
  if (status !== 'active' && status !== 'archived') {
    return { error: 'Invalid status' }
  }

  try {
    await prisma.project.update({
      where: { id: projectId },
      data: { status },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('setProjectStatus error:', msg, e)
    return { error: `Failed to update status: ${msg}` }
  }

  revalidatePath('/projects')
  revalidatePath('/')
  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function deleteProject(projectId: number) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  // A Project has a web of foreign-key children. Prisma won't let us delete
  // the Project row until every child is gone, so we wipe them in FK-safe
  // order inside a transaction — either everything dies or nothing does.
  //
  // Previously this only deleted ProjectMembers before calling
  // prisma.project.delete, which would silently fail if any other child
  // (PickListItem, Equipment, ChangeRequest, ...) existed, leaving an
  // orphan Project row with 0 members in the list.
  try {
    await prisma.$transaction([
      prisma.keyDraft.deleteMany({
        where: { panelKey: { projectMember: { projectId } } },
      }),
      prisma.changeRequestItem.deleteMany({
        where: { changeRequest: { projectId } },
      }),
      prisma.changeRequest.deleteMany({ where: { projectId } }),
      // NfgReports reference Equipment — delete them before Equipment.
      prisma.nfgReport.deleteMany({
        where: { equipment: { projectId } },
      }),
      prisma.panelKey.deleteMany({
        where: { projectMember: { projectId } },
      }),
      prisma.pickListItem.deleteMany({ where: { projectId } }),
      prisma.equipment.deleteMany({ where: { projectId } }),
      prisma.accessRequest.deleteMany({ where: { projectId } }),
      prisma.rackSlot.deleteMany({
        where: { rackTemplate: { projectId } },
      }),
      prisma.rackTemplate.deleteMany({ where: { projectId } }),
      prisma.projectMember.deleteMany({ where: { projectId } }),
      prisma.project.delete({ where: { id: projectId } }),
    ])
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('deleteProject error:', msg, e)
    return { error: `Failed to delete project: ${msg}` }
  }

  revalidatePath('/projects')
  revalidatePath('/')
  revalidatePath('/admin')
  revalidatePath('/my-equipment')
  return { success: true }
}

const HEADSET_TYPES = new Set([
  'LWHS 4', 'LWHS 5', 'PH 88', 'Shure Single', 'Shure Double',
  'Pliant Single', 'Pliant Double', 'Max D2', 'DT 200', 'DT 280',
  'DT 290', 'Dave Clark', 'Peltor', 'Dalcom',
])

/**
 * Save the "brought to the show" inventory counts for headset types on a project.
 * Manager-or-admin only. Pass the full set of types you want to persist;
 * any type set to 0 (or omitted) is removed from the inventory table so the
 * "no record" state reads as "not tracked yet".
 */
export async function setHeadsetInventory(
  projectId: number,
  inventory: Array<{ headsetType: string; brought: number }>,
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  // Authorization: admin only — globally or on this project.
  const membership = await prisma.projectMember.findFirst({
    where: { projectId, userId: session.user.id },
    select: { role: true },
  })
  const globalAdmin = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, role: 'admin' },
    select: { id: true },
  })
  const canEdit = !!globalAdmin || membership?.role === 'admin'
  if (!canEdit) return { error: 'Not authorized to edit inventory on this project' }

  // Validate input
  for (const row of inventory) {
    if (!HEADSET_TYPES.has(row.headsetType)) {
      return { error: `Unknown headset type: ${row.headsetType}` }
    }
    if (!Number.isInteger(row.brought) || row.brought < 0 || row.brought > 9999) {
      return { error: `Invalid count for ${row.headsetType}` }
    }
  }

  // Upsert non-zero rows, delete zero rows in a single transaction.
  const toUpsert = inventory.filter((r) => r.brought > 0)
  const toDelete = inventory.filter((r) => r.brought === 0).map((r) => r.headsetType)

  await prisma.$transaction([
    ...toUpsert.map((r) =>
      prisma.projectHeadsetInventory.upsert({
        where: {
          projectId_headsetType: { projectId, headsetType: r.headsetType },
        },
        update: { brought: r.brought },
        create: { projectId, headsetType: r.headsetType, brought: r.brought },
      }),
    ),
    ...(toDelete.length > 0
      ? [
          prisma.projectHeadsetInventory.deleteMany({
            where: { projectId, headsetType: { in: toDelete } },
          }),
        ]
      : []),
  ])

  revalidatePath('/')
  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

/**
 * Save the per-project totals for panel-only misc accessories
 * (goosenecks / footswitches / speakers brought to the show).
 * Admin-only — same authorization as setHeadsetInventory.
 */
export async function setMiscInventory(
  projectId: number,
  misc: {
    goosenecksBrought: number
    footswitchesBrought: number
    speakersBrought: number
  },
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const membership = await prisma.projectMember.findFirst({
    where: { projectId, userId: session.user.id },
    select: { role: true },
  })
  const globalAdmin = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, role: 'admin' },
    select: { id: true },
  })
  const canEdit = !!globalAdmin || membership?.role === 'admin'
  if (!canEdit) return { error: 'Not authorized to edit inventory on this project' }

  // Validate ranges (each field 0–9999, integers).
  for (const [field, value] of Object.entries(misc)) {
    if (!Number.isInteger(value) || value < 0 || value > 9999) {
      return { error: `Invalid count for ${field}` }
    }
  }

  await prisma.project.update({
    where: { id: projectId },
    data: {
      goosenecksBrought: misc.goosenecksBrought,
      footswitchesBrought: misc.footswitchesBrought,
      speakersBrought: misc.speakersBrought,
    },
  })

  revalidatePath('/')
  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

/**
 * Toggle Return Phase on/off for a project. While active, crew see
 * "done" equipment as Return tasks on /tasks alongside the existing
 * deploy tasks. Admin/manager only.
 */
export async function setReturnPhase(projectId: number, active: boolean) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  const membership = await prisma.projectMember.findFirst({
    where: { projectId, userId: session.user.id },
    select: { role: true },
  })
  const globalAdmin = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, role: 'admin' },
    select: { id: true },
  })
  const canEdit =
    !!globalAdmin || membership?.role === 'admin' || membership?.role === 'manager'
  if (!canEdit) return { error: 'Not authorized to change return phase' }

  await prisma.project.update({
    where: { id: projectId },
    data: { returnPhaseActive: active },
  })

  revalidatePath('/')
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/tasks')
  return { success: true }
}
