'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'

/* ─── Hardware key counts ─── */
const HARDWARE_KEY_COUNTS: Record<string, number> = {
  'RSP-1232': 32,
  'RSP-1216': 16,
  'DSP-1216': 16,
  'KP-5032': 32,
  'KP32': 32,
  'RSP-2318': 18,
  'RSP-2312': 12,
  'Helixnet': 2,
  'DBP': 4,
  'ST-374': 4,
  'ST370': 2,
  'C3': 2,
  'BP325': 2,
  'Bolero': 6,
  'Freespeak': 5,
  'Pliant': 4,
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

/* ─── Save keys (admin — immediate save) ─── */
export async function saveKeys(
  projectMemberId: number,
  keys: Array<{
    keyIndex: number
    page: string
    expansion: number
    pickListItemId: number | null
    triggerMode: string
  }>
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  try {
    for (const key of keys) {
      await prisma.panelKey.upsert({
        where: {
          projectMemberId_keyIndex_page_expansion: {
            projectMemberId,
            keyIndex: key.keyIndex,
            page: key.page,
            expansion: key.expansion,
          },
        },
        update: {
          pickListItemId: key.pickListItemId,
          triggerMode: key.triggerMode,
        },
        create: {
          projectMemberId,
          keyIndex: key.keyIndex,
          page: key.page,
          expansion: key.expansion,
          pickListItemId: key.pickListItemId,
          triggerMode: key.triggerMode,
        },
      })
    }

    revalidatePath(`/projects`)
    return { success: true }
  } catch (e) {
    console.error('saveKeys error:', e)
    return { error: 'Failed to save keys' }
  }
}

/* ─── Save draft keys (crew/manager — save as drafts) ─── */
export async function saveDraftKeys(
  projectMemberId: number,
  userId: number,
  keys: Array<{
    keyIndex: number
    page: string
    expansion: number
    pickListItemId: number | null
    triggerMode: string
  }>
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  try {
    for (const key of keys) {
      // Ensure PanelKey row exists
      const panelKey = await prisma.panelKey.upsert({
        where: {
          projectMemberId_keyIndex_page_expansion: {
            projectMemberId,
            keyIndex: key.keyIndex,
            page: key.page,
            expansion: key.expansion,
          },
        },
        update: {},
        create: {
          projectMemberId,
          keyIndex: key.keyIndex,
          page: key.page,
          expansion: key.expansion,
          pickListItemId: null,
          triggerMode: 'latch',
        },
      })

      // Create or update draft
      const existingDraft = await prisma.keyDraft.findFirst({
        where: {
          panelKeyId: panelKey.id,
          editedById: userId,
          status: 'draft',
        },
      })

      if (existingDraft) {
        await prisma.keyDraft.update({
          where: { id: existingDraft.id },
          data: {
            pickListItemId: key.pickListItemId,
            triggerMode: key.triggerMode,
          },
        })
      } else {
        await prisma.keyDraft.create({
          data: {
            panelKeyId: panelKey.id,
            editedById: userId,
            pickListItemId: key.pickListItemId,
            triggerMode: key.triggerMode,
          },
        })
      }
    }

    revalidatePath(`/projects`)
    return { success: true }
  } catch (e) {
    console.error('saveDraftKeys error:', e)
    return { error: 'Failed to save draft keys' }
  }
}

/* ─── Submit changes (crew/manager — submit drafts as a change request) ─── */
export async function submitChanges(
  projectMemberId: number,
  projectId: number,
  userId: number
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  try {
    // Find all draft entries for this member created by this user
    const drafts = await prisma.keyDraft.findMany({
      where: {
        editedById: userId,
        status: 'draft',
        panelKey: { projectMemberId },
      },
      include: { panelKey: true },
    })

    if (drafts.length === 0) {
      return { error: 'No pending changes to submit' }
    }

    // Create the change request
    const changeRequest = await prisma.changeRequest.create({
      data: {
        projectId,
        submittedById: userId,
        targetMemberId: projectMemberId,
        status: 'submitted',
        items: {
          create: drafts.map((draft) => ({
            panelKeyId: draft.panelKeyId,
            fieldChanged: 'pickListItemId',
            previousValue: draft.panelKey.pickListItemId?.toString() ?? null,
            newValue: draft.pickListItemId?.toString() ?? null,
          })),
        },
      },
    })

    // Mark drafts as submitted
    await prisma.keyDraft.updateMany({
      where: {
        id: { in: drafts.map((d) => d.id) },
      },
      data: { status: 'submitted' },
    })

    revalidatePath(`/projects`)
    return { success: true, changeRequestId: changeRequest.id }
  } catch (e) {
    console.error('submitChanges error:', e)
    return { error: 'Failed to submit changes' }
  }
}

/* ─── Add expansion panel ─── */
export async function addExpansion(
  projectMemberId: number,
  hardwareType: string
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  try {
    // Find the current highest expansion number
    const maxExpansion = await prisma.panelKey.findFirst({
      where: { projectMemberId },
      orderBy: { expansion: 'desc' },
      select: { expansion: true },
    })

    const nextExpansion = (maxExpansion?.expansion ?? 0) + 1
    if (nextExpansion > 6) {
      return { error: 'Maximum 6 expansions allowed' }
    }

    // Expansions always have 1 row worth of keys (e.g. RSP-1232 expansion = 16, not 32)
    const fullKeyCount = HARDWARE_KEY_COUNTS[hardwareType] || 16
    const keysPerRow = fullKeyCount <= 8 ? fullKeyCount : (fullKeyCount <= 18 ? Math.ceil(fullKeyCount / 2) * 2 : 16)
    const keyCount = keysPerRow

    // Create empty keys for the new expansion (both main and shift pages)
    const keysToCreate: Array<{
      projectMemberId: number
      keyIndex: number
      page: string
      expansion: number
      triggerMode: string
    }> = []

    for (const page of ['main', 'shift']) {
      for (let i = 0; i < keyCount; i++) {
        keysToCreate.push({
          projectMemberId,
          keyIndex: i,
          page,
          expansion: nextExpansion,
          triggerMode: 'latch',
        })
      }
    }

    await prisma.panelKey.createMany({ data: keysToCreate })

    revalidatePath(`/projects`)
    return { success: true, expansion: nextExpansion }
  } catch (e) {
    console.error('addExpansion error:', e)
    return { error: 'Failed to add expansion' }
  }
}

/* ─── Remove expansion panel ─── */
export async function removeExpansion(
  projectMemberId: number,
  expansion: number
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  if (expansion < 1) {
    return { error: 'Cannot remove the main panel' }
  }

  try {
    // Delete all drafts associated with these keys first
    const keysToDelete = await prisma.panelKey.findMany({
      where: { projectMemberId, expansion },
      select: { id: true },
    })

    const keyIds = keysToDelete.map((k) => k.id)

    if (keyIds.length > 0) {
      await prisma.keyDraft.deleteMany({
        where: { panelKeyId: { in: keyIds } },
      })
      await prisma.changeRequestItem.deleteMany({
        where: { panelKeyId: { in: keyIds } },
      })
    }

    await prisma.panelKey.deleteMany({
      where: { projectMemberId, expansion },
    })

    revalidatePath(`/projects`)
    return { success: true }
  } catch (e) {
    console.error('removeExpansion error:', e)
    return { error: 'Failed to remove expansion' }
  }
}
