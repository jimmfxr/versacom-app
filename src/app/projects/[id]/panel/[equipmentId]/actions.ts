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
  'DSP-2312': 12,
  'DKP-3016': 16,
  'KP-3016': 16,
  'DSPK4': 4,
  'Helixnet': 4,
  'DBP4': 4,
  'DBP5': 4,
  'ST-374': 4,
  'ST370': 2,
  'C3': 2,
  'BP325': 2,
  'Bolero 1.9': 6,
  'Bolero 2.4': 6,
  'Freespeak': 4,
  'Pliant': 4,
}

/* ─── Expansion key counts per device ─── */
const EXPANSION_KEY_COUNTS: Record<string, number> = {
  'RSP-1232': 16,
  'RSP-1216': 16,
  'KP-5032': 32,
  'KP32': 32,
  'RSP-2318': 24,
}

/* ─── Devices that support shift pages (panels only) ─── */
const SHIFT_PAGE_DEVICES = new Set([
  'RSP-1232', 'RSP-1216', 'DSP-1216', 'KP-5032', 'KP32', 'RSP-2318', 'DSP-2312',
  'DKP-3016', 'KP-3016', 'DSPK4',
])

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
  // PanelKeys are equipment-scoped now — multi-device members have one
  // row per device per slot, so callers must specify which device the
  // edits belong to.
  equipmentId: number,
  keys: Array<{
    keyIndex: number
    page: string
    expansion: number
    pickListItemId: number | null
    triggerMode: string
    talkMode: string
  }>
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  try {
    for (const key of keys) {
      await prisma.panelKey.upsert({
        where: {
          equipmentId_keyIndex_page_expansion: {
            equipmentId,
            keyIndex: key.keyIndex,
            page: key.page,
            expansion: key.expansion,
          },
        },
        update: {
          pickListItemId: key.pickListItemId,
          triggerMode: key.triggerMode,
          talkMode: key.talkMode,
        },
        create: {
          projectMemberId,
          equipmentId,
          keyIndex: key.keyIndex,
          page: key.page,
          expansion: key.expansion,
          pickListItemId: key.pickListItemId,
          triggerMode: key.triggerMode,
          talkMode: key.talkMode,
        },
      })
    }

    revalidatePath(`/projects`)
    revalidatePath(`/my-equipment`)
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('saveKeys error:', msg, e)
    return { error: `Failed to save keys: ${msg}` }
  }
}

/* ─── Save draft keys (crew/manager — save as drafts) ─── */
export async function saveDraftKeys(
  projectMemberId: number,
  // PanelKey rows are equipment-scoped; the caller passes the device the
  // drafts belong to so multi-device members keep their key state apart.
  equipmentId: number,
  userId: number,
  keys: Array<{
    keyIndex: number
    page: string
    expansion: number
    pickListItemId: number | null
    triggerMode: string
    talkMode: string
  }>
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  try {
    for (const key of keys) {
      // Ensure PanelKey row exists
      const panelKey = await prisma.panelKey.upsert({
        where: {
          equipmentId_keyIndex_page_expansion: {
            equipmentId,
            keyIndex: key.keyIndex,
            page: key.page,
            expansion: key.expansion,
          },
        },
        update: {},
        create: {
          projectMemberId,
          equipmentId,
          keyIndex: key.keyIndex,
          page: key.page,
          expansion: key.expansion,
          pickListItemId: null,
          triggerMode: 'latch',
          talkMode: 'tl',
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
            talkMode: key.talkMode,
          },
        })
      } else {
        await prisma.keyDraft.create({
          data: {
            panelKeyId: panelKey.id,
            editedById: userId,
            pickListItemId: key.pickListItemId,
            triggerMode: key.triggerMode,
            talkMode: key.talkMode,
          },
        })
      }
    }

    revalidatePath(`/projects`)
    revalidatePath(`/my-equipment`)
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('saveDraftKeys error:', msg, e)
    return { error: `Failed to save draft keys: ${msg}` }
  }
}

/* ─── Submit changes (crew/manager — submit drafts as a change request) ─── */
export async function submitChanges(
  projectMemberId: number,
  // ChangeRequests are equipment-scoped — submitting on HWBP 1 produces a
  // separate review card from a submission on PNL 3, even when the same
  // member owns both devices.
  equipmentId: number,
  projectId: number,
  userId: number
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  try {
    // Find draft entries for this user scoped to THIS equipment so
    // multi-device members don't accidentally roll a sibling device's
    // drafts into this submission.
    const drafts = await prisma.keyDraft.findMany({
      where: {
        editedById: userId,
        status: 'draft',
        panelKey: { projectMemberId, equipmentId },
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
        equipmentId,
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
    revalidatePath(`/admin`)
    revalidatePath(`/my-equipment`)
    return { success: true, changeRequestId: changeRequest.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('submitChanges error:', msg, e)
    return { error: `Failed to submit changes: ${msg}` }
  }
}

/* ─── Add expansion panel ─── */
export async function addExpansion(
  projectMemberId: number,
  // Expansions live on a specific device. Scoping by equipmentId keeps
  // PNL 3's expansion separate from HWBP 1's when one member owns both.
  equipmentId: number,
  hardwareType: string
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  // Guard: only expandable devices
  const expansionKeyCount = EXPANSION_KEY_COUNTS[hardwareType]
  if (!expansionKeyCount) {
    return { error: 'This device does not support expansions' }
  }

  try {
    // Find the current highest expansion number on THIS device.
    const maxExpansion = await prisma.panelKey.findFirst({
      where: { equipmentId },
      orderBy: { expansion: 'desc' },
      select: { expansion: true },
    })

    const nextExpansion = (maxExpansion?.expansion ?? 0) + 1
    if (nextExpansion > 6) {
      return { error: 'Maximum 6 expansions allowed' }
    }

    const keyCount = expansionKeyCount
    const hasShift = SHIFT_PAGE_DEVICES.has(hardwareType)
    const pages = hasShift ? ['main', 'shift'] : ['main']

    // Create empty keys for the new expansion
    const keysToCreate: Array<{
      projectMemberId: number
      equipmentId: number
      keyIndex: number
      page: string
      expansion: number
      triggerMode: string
      talkMode: string
    }> = []

    for (const page of pages) {
      for (let i = 0; i < keyCount; i++) {
        keysToCreate.push({
          projectMemberId,
          equipmentId,
          keyIndex: i,
          page,
          expansion: nextExpansion,
          triggerMode: 'latch',
          talkMode: 'tl',
        })
      }
    }

    await prisma.panelKey.createMany({ data: keysToCreate })

    revalidatePath(`/projects`)
    return { success: true, expansion: nextExpansion }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('addExpansion error:', msg, e)
    return { error: `Failed to add expansion: ${msg}` }
  }
}

/* ─── Remove expansion panel ─── */
export async function removeExpansion(
  projectMemberId: number,
  // Scope deletion to the specific device — without this, removing an
  // expansion on PNL 3 would also wipe HWBP 1's keys at the same expansion.
  equipmentId: number,
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
      where: { equipmentId, expansion },
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
      where: { equipmentId, expansion },
    })

    void projectMemberId // accepted for API symmetry; deletion scopes by device
    revalidatePath(`/projects`)
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('removeExpansion error:', msg, e)
    return { error: `Failed to remove expansion: ${msg}` }
  }
}

/* ─── Resolve change requests (admin — approve selected items, deny rejected ones) ─── */
export async function resolveChangeRequests(
  changeRequestIds: number[],
  approvedItemIds: number[],
  deniedItemIds: number[]
) {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated' }

  try {
    const approvedSet = new Set(approvedItemIds)

    for (const crId of changeRequestIds) {
      const cr = await prisma.changeRequest.findUnique({
        where: { id: crId },
        include: { items: true },
      })

      if (!cr) continue
      if (cr.status !== 'submitted' && cr.status !== 'mgr_endorsed') continue

      // Apply only approved items to the actual PanelKeys
      for (const item of cr.items) {
        if (approvedSet.has(item.id) && item.fieldChanged === 'pickListItemId') {
          const newPickId = item.newValue ? parseInt(item.newValue) : null
          await prisma.panelKey.update({
            where: { id: item.panelKeyId },
            data: { pickListItemId: newPickId },
          })
        }
      }

      // Determine final status: if all items denied → rejected, otherwise → applied
      const crItemIds = cr.items.map((i) => i.id)
      const allDenied = crItemIds.every((id) => !approvedSet.has(id))

      await prisma.changeRequest.update({
        where: { id: crId },
        data: {
          status: allDenied ? 'rejected' : 'applied',
          resolvedAt: new Date(),
        },
      })

      // Clean up associated drafts
      const panelKeyIds = cr.items.map((i) => i.panelKeyId)
      await prisma.keyDraft.deleteMany({
        where: {
          panelKeyId: { in: panelKeyIds },
          status: 'submitted',
        },
      })
    }

    revalidatePath(`/projects`)
    revalidatePath(`/admin`)
    revalidatePath(`/my-equipment`)
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('resolveChangeRequests error:', msg, e)
    return { error: `Failed to resolve: ${msg}` }
  }
}
