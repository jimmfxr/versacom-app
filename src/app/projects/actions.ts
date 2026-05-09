'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'

async function generateUniqueProjectPin(): Promise<string> {
  let pin: string
  let exists = true
  while (exists) {
    pin = String(Math.floor(1000 + Math.random() * 9000))
    const dup = await prisma.project.findUnique({ where: { pin } })
    exists = dup !== null
  }
  return pin!
}

export async function createProject(formData: FormData) {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')

  if (!sessionCookie?.value) {
    return { error: 'Not authenticated' }
  }

  let session: { user: { id: number } }
  try {
    session = JSON.parse(sessionCookie.value)
  } catch {
    return { error: 'Invalid session' }
  }

  const name = formData.get('name') as string | null

  if (!name || name.trim().length === 0) {
    return { error: 'Project name is required' }
  }

  if (name.trim().length > 100) {
    return { error: 'Project name must be 100 characters or less' }
  }

  const existing = await prisma.project.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' } },
  })
  if (existing) {
    return { error: 'A project with that name already exists' }
  }

  const pin = await generateUniqueProjectPin()

  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      pin,
      createdById: session.user.id,
      members: {
        create: { userId: session.user.id, role: 'admin' },
      },
    },
    select: { id: true, name: true },
  })

  revalidatePath('/projects')
  return { success: true, name: project.name }
}

/**
 * Duplicate an existing project. Spawns a brand-new Project with a
 * fresh 4-digit PIN, then copies the requested categories from the
 * source. The toggles are independent — a caller can clone just the
 * pick list, or just the team, etc. The new project always starts
 * with:
 *
 *   - new auto-generated PIN
 *   - status = 'active', returnPhaseActive = false
 *   - the calling user added as admin (in addition to any team
 *     members copied)
 *
 * Things that are NEVER copied:
 *   - PanelKeys / KeyDrafts / ChangeRequests (device + show-specific)
 *   - Equipment.assignedToId (cleared so the new show starts unassigned)
 *   - Equipment.deployStatus (reset to 'na')
 *   - User lockout state (failedAttempts / lockedUntil) — those live
 *     on User and apply across projects, so we don't touch them
 */
export async function cloneProject(formData: FormData) {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')
  if (!sessionCookie?.value) return { error: 'Not authenticated' }
  let session: { user: { id: number } }
  try {
    session = JSON.parse(sessionCookie.value)
  } catch {
    return { error: 'Invalid session' }
  }

  const sourceIdRaw = formData.get('sourceId')
  const name = (formData.get('name') as string | null) ?? ''
  const sourceId = sourceIdRaw ? parseInt(sourceIdRaw.toString(), 10) : NaN

  if (!Number.isFinite(sourceId)) {
    return { error: 'Pick a project to clone' }
  }
  if (!name.trim()) return { error: 'New project name is required' }
  if (name.trim().length > 100) return { error: 'Name must be 100 characters or less' }

  // Toggles — string '1' / '0' from the form. Default to ON if absent
  // so a future UI variant that omits the field still gets the
  // expected "copy everything" behavior.
  const want = (key: string) =>
    formData.get(key) == null ? true : formData.get(key) === '1'
  const wantTeam = want('team')
  const wantEquipment = want('equipment')
  const wantPickList = want('pickList')
  const wantInventory = want('inventory')

  // Verify the actor can read the source project. Same rule as the
  // /projects list — admin (any) or member of the source.
  const isGlobalAdmin = await prisma.projectMember.findFirst({
    where: { userId: session.user.id, role: 'admin' },
    select: { id: true },
  })
  if (!isGlobalAdmin) {
    const sourceMembership = await prisma.projectMember.findFirst({
      where: { userId: session.user.id, projectId: sourceId },
      select: { id: true },
    })
    if (!sourceMembership) return { error: 'Not authorized to clone this project' }
  }

  const source = await prisma.project.findUnique({
    where: { id: sourceId },
    include: {
      members: { include: { user: { select: { id: true } } } },
      pickListItems: true,
      equipment: true,
      headsetInventory: true,
    },
  }) as
    | (null
        | {
            id: number
            name: string
            goosenecksBrought: number
            footswitchesBrought: number
            speakersBrought: number
            quarterXlrmBrought: number
            db9XlrfBrought: number
            rj45XlrmfBrought: number
            members: Array<{
              userId: number
              role: string
              position: string | null
              location: string | null
              hardwareType: string | null
            }>
            pickListItems: Array<{
              code: string | null
              name: string
              type: string
            }>
            equipment: Array<{
              name: string
              category: string
              hardwareType: string | null
              position: string | null
              location: string | null
              headsetType: string | null
              ipAddress: string | null
              patch: string | null
              gooseneck: boolean
              footswitches: number
              speakers: number
              notes: string | null
            }>
            headsetInventory: Array<{ headsetType: string; brought: number }>
          })
  if (!source) return { error: 'Source project not found' }

  // Avoid name collision — same rule as createProject.
  const dupName = await prisma.project.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' } },
    select: { id: true },
  })
  if (dupName) return { error: 'A project with that name already exists' }

  const pin = await generateUniqueProjectPin()

  // Run the whole clone in a single transaction so a partial failure
  // doesn't leave an orphaned new project in the DB.
  const newProject = await prisma.$transaction(async (tx) => {
    // 1) New project — copy "brought to show" totals only when the
    //    inventory toggle is on; otherwise start at 0.
    const created = await tx.project.create({
      data: {
        name: name.trim(),
        pin,
        createdById: session.user.id,
        goosenecksBrought: wantInventory ? source.goosenecksBrought : 0,
        footswitchesBrought: wantInventory ? source.footswitchesBrought : 0,
        speakersBrought: wantInventory ? source.speakersBrought : 0,
        quarterXlrmBrought: wantInventory ? source.quarterXlrmBrought : 0,
        db9XlrfBrought: wantInventory ? source.db9XlrfBrought : 0,
        rj45XlrmfBrought: wantInventory ? source.rj45XlrmfBrought : 0,
      },
      select: { id: true },
    })

    // 2) Team members. Always include the actor as admin so they
    //    can administer the new project even if their source role
    //    was lower OR they're cloning from a project they're a
    //    global admin on but not a member of.
    const memberUserIds = new Set<number>()
    if (wantTeam) {
      for (const m of source.members) {
        if (memberUserIds.has(m.userId)) continue
        memberUserIds.add(m.userId)
        await tx.projectMember.create({
          data: {
            userId: m.userId,
            projectId: created.id,
            role: m.role,
            position: m.position,
            location: m.location,
            hardwareType: m.hardwareType,
          },
        })
      }
    }
    if (!memberUserIds.has(session.user.id)) {
      await tx.projectMember.create({
        data: { userId: session.user.id, projectId: created.id, role: 'admin' },
      })
    }

    // 3) Pick list items. PTPs (auto-managed from members) skipped —
    //    panel/[equipmentId]/page.tsx auto-syncs PTPs for the new
    //    project from its own members.
    if (wantPickList) {
      for (const p of source.pickListItems) {
        if (p.type === 'PTP') continue
        await tx.pickListItem.create({
          data: {
            projectId: created.id,
            code: p.code,
            name: p.name,
            type: p.type,
          },
        })
      }
    }

    // 4) Equipment list — assignments cleared, deploy status reset.
    if (wantEquipment) {
      for (const e of source.equipment) {
        await tx.equipment.create({
          data: {
            projectId: created.id,
            name: e.name,
            category: e.category,
            hardwareType: e.hardwareType,
            position: e.position,
            location: e.location,
            headsetType: e.headsetType,
            ipAddress: e.ipAddress,
            patch: e.patch,
            gooseneck: e.gooseneck,
            footswitches: e.footswitches,
            speakers: e.speakers,
            notes: e.notes,
            // assignedToId intentionally null — new show starts
            // with gear unassigned.
            // deployStatus defaults to 'na'.
          },
        })
      }
    }

    // 5) Headset inventory totals.
    if (wantInventory) {
      for (const h of source.headsetInventory) {
        await tx.projectHeadsetInventory.create({
          data: {
            projectId: created.id,
            headsetType: h.headsetType,
            brought: h.brought,
          },
        })
      }
    }

    return created
  })

  revalidatePath('/projects')
  return { success: true, projectId: newProject.id, name: name.trim() }
}
